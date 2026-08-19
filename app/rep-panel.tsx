/**
 * GBTVON — Painel do Representante
 * Acessado pela tela inicial via "Área do Representante"
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Modal, ActivityIndicator, Alert, Dimensions, KeyboardAvoidingView,
  Platform, RefreshControl, Clipboard,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';
import {
  repLogin, getRepDevices, getRepSources, activateRepDevice, activateRepTest,
  deactivateRepDevice, blockRepDevice, unblockRepDevice, deleteRepDevice, renewRepDevice,
  lookupDeviceByMac,
  Representative, Source, RepDevice,
} from '@/services/repApiService';

const { width } = Dimensions.get('window');

type Tab = 'dashboard' | 'devices' | 'add' | 'test';

function formatLastSeen(v: string | null | undefined): string {
  if (!v) return 'Nunca';
  const diff = Date.now() - new Date(v).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(v).toLocaleDateString('pt-BR');
}
function isOnline(v: string | null | undefined): boolean {
  if (!v) return false;
  return Date.now() - new Date(v).getTime() < 5 * 60 * 1000;
}
function formatExpiry(v: string | null | undefined): string {
  if (!v) return 'Sem prazo';
  const d = new Date(v);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return 'Expirado';
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return `Expira em ${hrs}h`;
  const days = Math.floor(diff / 86400000);
  return `Expira em ${days}d`;
}

/** Format a Date to DD/MM/YYYY string */
function formatDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Parse DD/MM/YYYY to Date */
function parseDateBR(s: string): Date | null {
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || y < 2024) return null;
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
}

/** Compute days between today and a future date (min 1) */
function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
}

export default function RepPanelScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loggedIn, setLoggedIn] = useState(false);
  const [rep, setRep] = useState<Representative | null>(null);
  const [repNumber, setRepNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [devices, setDevices] = useState<RepDevice[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [devicesSearch, setDevicesSearch] = useState('');
  const [devicesFilter, setDevicesFilter] = useState<'all' | 'active' | 'blocked' | 'online'>('all');

  // Add device form — expiresDateStr is DD/MM/YYYY
  const [addForm, setAddForm] = useState({
    mac: '', clientName: '', sourceId: '',
    packageType: 'iptv' as 'iptv' | 'p2p',
    expiresDateStr: '',   // custom date chosen by rep
    days: '30',           // derived from date or preset
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addLookingUp, setAddLookingUp] = useState(false);

  // Test activation form
  const [testForm, setTestForm] = useState({
    mac: '', clientName: '', sourceId: '',
    packageType: 'iptv' as 'iptv' | 'p2p', hours: '2',
  });
  const [testLoading, setTestLoading] = useState(false);
  const [testLookingUp, setTestLookingUp] = useState(false);

  // Detail modal
  const [detailModal, setDetailModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<RepDevice | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Block modal
  const [blockModal, setBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  // Renew modal
  const [renewModal, setRenewModal] = useState(false);
  const [renewDays, setRenewDays] = useState('30');
  const [renewLoading, setRenewLoading] = useState(false);

  // MAC lookup debounce timers
  const addMacTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testMacTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth ───────────────────────────────────────────────────────────────────
  async function handleLogin() {
    if (!repNumber.trim() || !password.trim()) {
      setLoginError('Preencha o código e a senha');
      return;
    }
    setLoginLoading(true);
    setLoginError('');
    const result = await repLogin(repNumber.trim(), password.trim());
    setLoginLoading(false);
    if (!result.ok || !result.rep) {
      setLoginError(result.error || 'Código ou senha incorretos');
      return;
    }
    setRep(result.rep);
    setLoggedIn(true);
    loadData(true);
  }

  const loadData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const [d, s] = await Promise.all([getRepDevices(), getRepSources()]);
      setDevices(d);
      setSources(s);
    } catch (e: any) {
      if (showLoader) Alert.alert('Erro', e.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (loggedIn) {
      refreshIntervalRef.current = setInterval(() => loadData(false), 30000);
      return () => { if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current); };
    }
  }, [loggedIn, loadData]);

  // ── MAC auto-lookup ────────────────────────────────────────────────────────
  function handleAddMacChange(mac: string) {
    setAddForm(f => ({ ...f, mac }));
    if (addMacTimer.current) clearTimeout(addMacTimer.current);
    const cleaned = mac.replace(/[^A-Fa-f0-9:]/g, '').toUpperCase();
    if (cleaned.length >= 17) {
      addMacTimer.current = setTimeout(() => lookupAddMac(cleaned), 600);
    }
  }

  async function lookupAddMac(mac: string) {
    setAddLookingUp(true);
    const result = await lookupDeviceByMac(mac);
    setAddLookingUp(false);
    if (result.found && result.client_name) {
      setAddForm(f => ({ ...f, clientName: result.client_name || '' }));
    }
  }

  function handleTestMacChange(mac: string) {
    setTestForm(f => ({ ...f, mac }));
    if (testMacTimer.current) clearTimeout(testMacTimer.current);
    const cleaned = mac.replace(/[^A-Fa-f0-9:]/g, '').toUpperCase();
    if (cleaned.length >= 17) {
      testMacTimer.current = setTimeout(() => lookupTestMac(cleaned), 600);
    }
  }

  async function lookupTestMac(mac: string) {
    setTestLookingUp(true);
    const result = await lookupDeviceByMac(mac);
    setTestLookingUp(false);
    if (result.found && result.client_name) {
      setTestForm(f => ({ ...f, clientName: result.client_name || '' }));
    }
  }

  // ── Date / days helpers ────────────────────────────────────────────────────
  function handleAddDateChange(dateStr: string) {
    // Allow only digits and slashes, auto-insert slashes
    let v = dateStr.replace(/[^\d/]/g, '');
    if (v.length === 2 && addForm.expiresDateStr.length === 1) v = v + '/';
    if (v.length === 5 && addForm.expiresDateStr.length === 4) v = v + '/';
    setAddForm(f => {
      const parsed = parseDateBR(v);
      const days = parsed ? String(daysBetween(new Date(), parsed)) : f.days;
      return { ...f, expiresDateStr: v, days };
    });
  }

  function applyPresetDays(preset: string) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(preset));
    setAddForm(f => ({ ...f, days: preset, expiresDateStr: formatDateBR(d) }));
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleAddDevice() {
    const { mac, clientName, sourceId, packageType, days, expiresDateStr } = addForm;
    if (!mac.trim() || !sourceId || !days) {
      Alert.alert('Atenção', 'Preencha MAC, fonte e prazo');
      return;
    }
    const daysNum = parseInt(days);
    if (isNaN(daysNum) || daysNum < 1) { Alert.alert('Atenção', 'Dias inválidos'); return; }
    const creditCost = Math.round((daysNum / 30) * 100) / 100;
    if ((rep?.credits ?? 0) < creditCost) {
      Alert.alert('Créditos insuficientes', `Você tem ${rep?.credits ?? 0} crédito(s). Esta ativação custa ${creditCost.toFixed(2)}.`);
      return;
    }

    // Parse custom date if provided
    let expiresAtDate: string | undefined;
    if (expiresDateStr) {
      const parsed = parseDateBR(expiresDateStr);
      if (parsed && parsed > new Date()) {
        expiresAtDate = parsed.toISOString();
      }
    }

    setAddLoading(true);
    try {
      await activateRepDevice({
        mac: mac.trim().toUpperCase(),
        clientName: clientName.trim() || undefined,
        sourceId,
        packageType,
        days: daysNum,
        expiresAtDate,
      });
      setRep(prev => prev ? { ...prev, credits: Math.round((prev.credits - creditCost) * 100) / 100 } : prev);
      setAddForm({ mac: '', clientName: '', sourceId: '', packageType: 'iptv', expiresDateStr: '', days: '30' });
      await loadData(false);
      Alert.alert('Ativado!', `MAC ${mac.trim().toUpperCase()} ativado com sucesso.`);
    } catch (e: any) { Alert.alert('Erro', e.message); }
    setAddLoading(false);
  }

  async function handleTestActivation() {
    const { mac, clientName, sourceId, packageType, hours } = testForm;
    if (!mac.trim() || !sourceId) {
      Alert.alert('Atenção', 'Preencha MAC e fonte');
      return;
    }
    const hoursNum = parseInt(hours);
    if (isNaN(hoursNum) || hoursNum < 1 || hoursNum > 6) {
      Alert.alert('Atenção', 'Horas deve ser entre 1 e 6');
      return;
    }
    setTestLoading(true);
    try {
      await activateRepTest({
        mac: mac.trim().toUpperCase(),
        clientName: clientName.trim() || undefined,
        sourceId,
        packageType,
        hours: hoursNum,
      });
      setTestForm({ mac: '', clientName: '', sourceId: '', packageType: 'iptv', hours: '2' });
      await loadData(false);
      Alert.alert('Teste ativado!', `Acesso de ${hoursNum}h liberado para ${mac.trim().toUpperCase()}.`);
    } catch (e: any) { Alert.alert('Erro', e.message); }
    setTestLoading(false);
  }

  async function handleDeactivate() {
    if (!selectedDevice) return;
    Alert.alert('Desativar', `Desativar ${selectedDevice.client_name || selectedDevice.mac_address}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desativar', style: 'destructive', onPress: async () => {
          setActionLoading(true);
          try { await deactivateRepDevice(selectedDevice.id); setDetailModal(false); await loadData(false); }
          catch (e: any) { Alert.alert('Erro', e.message); }
          setActionLoading(false);
        }
      }
    ]);
  }

  async function handleBlock() {
    if (!selectedDevice) return;
    setBlockModal(false);
    setActionLoading(true);
    try {
      await blockRepDevice(selectedDevice.id, blockReason.trim() || 'Bloqueado pelo representante');
      setDetailModal(false);
      setBlockReason('');
      await loadData(false);
    } catch (e: any) { Alert.alert('Erro', e.message); }
    setActionLoading(false);
  }

  async function handleDelete() {
    if (!selectedDevice) return;
    Alert.alert('Excluir dispositivo', `Remover ${selectedDevice.client_name || selectedDevice.mac_address} permanentemente?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir', style: 'destructive', onPress: async () => {
          setActionLoading(true);
          try { await deleteRepDevice(selectedDevice.id); setDetailModal(false); await loadData(false); }
          catch (e: any) { Alert.alert('Erro', e.message); }
          setActionLoading(false);
        }
      }
    ]);
  }

  async function handleRenew() {
    if (!selectedDevice) return;
    const daysNum = parseInt(renewDays);
    if (isNaN(daysNum) || daysNum < 1) { Alert.alert('Dias inválidos'); return; }
    const creditCost = Math.round((daysNum / 30) * 100) / 100;
    if ((rep?.credits ?? 0) < creditCost) {
      Alert.alert('Créditos insuficientes', `Você tem ${rep?.credits ?? 0} crédito(s). Esta renovação custa ${creditCost.toFixed(2)}.`);
      return;
    }
    setRenewLoading(true);
    try {
      const result = await renewRepDevice(selectedDevice.id, daysNum);
      setRep(prev => prev ? { ...prev, credits: Math.round((prev.credits - (result.credit_cost || creditCost)) * 100) / 100 } : prev);
      setRenewModal(false);
      setDetailModal(false);
      await loadData(false);
      Alert.alert('Renovado!', `MAC renovado por mais ${daysNum} dias.`);
    } catch (e: any) { Alert.alert('Erro', e.message); }
    setRenewLoading(false);
  }

  async function handleUnblock() {
    if (!selectedDevice) return;
    setActionLoading(true);
    try {
      await unblockRepDevice(selectedDevice.id);
      setDetailModal(false);
      await loadData(false);
    } catch (e: any) { Alert.alert('Erro', e.message); }
    setActionLoading(false);
  }

  // ── Computed ───────────────────────────────────────────────────────────────
  const filteredDevices = devices.filter(d => {
    const q = devicesSearch.toLowerCase();
    const matchSearch = !q ||
      (d.client_name || '').toLowerCase().includes(q) ||
      d.mac_address.toLowerCase().includes(q);
    const matchFilter =
      devicesFilter === 'all' ? true :
      devicesFilter === 'online' ? isOnline(d.last_seen_at) :
      devicesFilter === 'active' ? (d.activated && !d.blocked_reason) :
      devicesFilter === 'blocked' ? !!d.blocked_reason : true;
    return matchSearch && matchFilter;
  });

  const activeDevices = devices.filter(d => d.activated && !d.blocked_reason).length;
  const onlineDevices = devices.filter(d => isOnline(d.last_seen_at)).length;
  const expiredSoon = devices.filter(d => {
    if (!d.expires_at) return false;
    const diff = new Date(d.expires_at).getTime() - Date.now();
    return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
  }).length;

  // ── Renew expiry preview helper ────────────────────────────────────────────
  function computeNewExpiry(device: RepDevice | null, days: string): string {
    if (!device) return '';
    const daysNum = parseInt(days);
    if (isNaN(daysNum) || daysNum < 1) return '';
    const base = device.expires_at && new Date(device.expires_at) > new Date()
      ? new Date(device.expires_at)
      : new Date();
    base.setDate(base.getDate() + daysNum);
    return base.toLocaleDateString('pt-BR');
  }

  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <View style={[styles.container, styles.loginBg, { paddingTop: insets.top + 20 }]}>
        <Pressable style={styles.backBtnTop} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>

        <View style={styles.loginCenter}>
          <View style={styles.loginIconWrap}>
            <Ionicons name="headset" size={48} color={Colors.primary} />
          </View>
          <Text style={styles.loginTitle}>Área do Representante</Text>
          <Text style={styles.loginSub}>Digite seu código e senha de acesso</Text>

          <View style={styles.loginCard}>
            <Text style={styles.fieldLabel}>Código do representante</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="id-card-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Ex: 01, 02, 03..."
                placeholderTextColor={Colors.textMuted}
                value={repNumber}
                onChangeText={v => { setRepNumber(v); setLoginError(''); }}
                keyboardType="number-pad"
                returnKeyType="next"
              />
            </View>

            <Text style={styles.fieldLabel}>Senha</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Senha de acesso"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={v => { setPassword(v); setLoginError(''); }}
                secureTextEntry={!showPassword}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={16} color={Colors.textMuted} />
              </Pressable>
            </View>

            {loginError ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color={Colors.error} />
                <Text style={styles.errorText}> {loginError}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.loginBtn, loginLoading && { opacity: 0.6 }]}
              onPress={handleLogin}
              disabled={loginLoading}
            >
              {loginLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="enter-outline" size={20} color="#fff" /><Text style={styles.loginBtnText}>  Entrar</Text></>
              }
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── PANEL ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBack} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={styles.headerIconWrap}>
          <Ionicons name="headset" size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{rep?.name}</Text>
          <Text style={styles.headerSub}>Rep. #{rep?.rep_number}</Text>
        </View>
        {onlineDevices > 0 && (
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>{onlineDevices} online</Text>
          </View>
        )}
        <View style={styles.creditsBadge}>
          <Ionicons name="wallet-outline" size={14} color="#FFD700" />
          <Text style={styles.creditsText}> {rep?.credits ?? 0}</Text>
        </View>
        <Pressable onPress={() => loadData(true)} hitSlop={8} style={{ padding: 4 }} disabled={loading}>
          {loading
            ? <ActivityIndicator color={Colors.primary} size="small" />
            : <Ionicons name="refresh" size={20} color={Colors.primary} />}
        </Pressable>
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarScroll}>
        <View style={styles.tabBar}>
          {([
            { key: 'dashboard', label: 'Painel', icon: 'grid-outline' },
            { key: 'devices', label: 'Clientes', icon: 'phone-portrait-outline' },
            { key: 'add', label: 'Ativar MAC', icon: 'add-circle-outline' },
            { key: 'test', label: 'Teste Grátis', icon: 'time-outline' },
          ] as { key: Tab; label: string; icon: string }[]).map(tab => (
            <Pressable
              key={tab.key}
              style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons name={tab.icon as any} size={18} color={activeTab === tab.key ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(false); }} tintColor={Colors.primary} />}
      >
        {/* ── DASHBOARD ── */}
        {activeTab === 'dashboard' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Resumo</Text>
            <View style={styles.statsGrid}>
              <StatCard icon="wallet" label="Créditos" value={String(rep?.credits ?? 0)} color="#FFD700" />
              <StatCard icon="phone-portrait" label="Total" value={String(devices.length)} color="#4FC3F7" />
              <StatCard icon="radio-button-on" label="Online" value={String(onlineDevices)} color="#4CAF50" />
              <StatCard icon="checkmark-circle" label="Ativos" value={String(activeDevices)} color="#8BC34A" />
              <StatCard icon="warning" label="Vence 7d" value={String(expiredSoon)} color="#FF9800" />
              <StatCard icon="ban" label="Bloqueados" value={String(devices.filter(d => !!d.blocked_reason).length)} color={Colors.error} />
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Minhas Fontes</Text>
            {sources.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="server-outline" size={36} color={Colors.textMuted} />
                <Text style={styles.emptyText}>Nenhuma fonte atribuída</Text>
                <Text style={styles.emptySubText}>Solicite ao administrador</Text>
              </View>
            ) : (
              sources.map(s => (
                <View key={s.id} style={styles.sourceCard}>
                  <View style={styles.sourceCardHeader}>
                    <View style={[styles.sourceIconWrap, { backgroundColor: s.active ? 'rgba(76,175,80,0.12)' : 'rgba(255,255,255,0.05)' }]}>
                      <Ionicons name="server-outline" size={20} color={s.active ? '#4CAF50' : Colors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sourceName}>{s.name}</Text>
                      {/* DNS ocultado do representante por segurança */}
                      <Text style={[styles.sourceUrl, { color: s.active ? '#4CAF50' : Colors.textMuted }]}>
                        {s.active ? 'Ativa' : 'Inativa'} • {s.max_connections} conexões máx.
                      </Text>
                    </View>
                    <View style={styles.sourceConnBadge}>
                      <Text style={styles.sourceConnText}>{s.active_macs ?? 0}/{s.max_connections}</Text>
                      <Text style={[styles.sourceConnLabel, { fontSize: 9 }]}> MACs</Text>
                    </View>
                  </View>
                  <View style={styles.sourcePackageRow}>
                    <View style={styles.pkgBadge}><Ionicons name="tv-outline" size={11} color={Colors.primary} /><Text style={styles.pkgBadgeText}> IPTV</Text></View>
                    <View style={[styles.pkgBadge, { borderColor: 'rgba(76,175,80,0.4)' }]}><Ionicons name="wifi-outline" size={11} color="#4CAF50" /><Text style={[styles.pkgBadgeText, { color: '#4CAF50' }]}> P2P</Text></View>
                  </View>
                </View>
              ))
            )}

            <View style={styles.creditsInfoCard}>
              <Ionicons name="information-circle-outline" size={16} color="#FFD700" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.creditsInfoTitle}>Como funcionam os créditos?</Text>
                <Text style={styles.creditsInfoText}>
                  1 crédito = 30 dias de acesso.{'\n'}
                  Ativações e renovações consomem créditos proporcionalmente.{'\n'}
                  Testes gratuitos (1–6h) não consomem créditos.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── DEVICES / CLIENTES ── */}
        {activeTab === 'devices' && (
          <View style={styles.section}>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={14} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar nome ou MAC..."
                placeholderTextColor={Colors.textMuted}
                value={devicesSearch}
                onChangeText={setDevicesSearch}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  { key: 'all', label: `Todos (${devices.length})` },
                  { key: 'online', label: `Online (${onlineDevices})` },
                  { key: 'active', label: `Ativos (${activeDevices})` },
                  { key: 'blocked', label: `Bloqueados (${devices.filter(d => !!d.blocked_reason).length})` },
                ] as const).map(f => (
                  <Pressable
                    key={f.key}
                    style={[styles.filterChip, devicesFilter === f.key && styles.filterChipActive]}
                    onPress={() => setDevicesFilter(f.key)}
                  >
                    <Text style={[styles.filterChipText, devicesFilter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {filteredDevices.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="phone-portrait-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>Nenhum cliente cadastrado</Text>
                <Pressable style={styles.emptyAddBtn} onPress={() => setActiveTab('add')}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.emptyAddBtnText}> Ativar primeiro MAC</Text>
                </Pressable>
              </View>
            ) : (
              filteredDevices.map(d => (
                <Pressable
                  key={d.id}
                  style={styles.deviceCard}
                  onPress={() => { setSelectedDevice(d); setDetailModal(true); }}
                >
                  <View style={[styles.statusDot, {
                    backgroundColor: isOnline(d.last_seen_at) ? '#4CAF50' : d.activated && !d.blocked_reason ? '#8BC34A' : d.blocked_reason ? Colors.error : '#FF9800'
                  }]} />
                  <View style={{ flex: 1 }}>
                    {/* Client name prominent */}
                    <Text style={styles.deviceClientName} numberOfLines={1}>
                      {d.client_name || 'Cliente sem nome'}
                    </Text>
                    {/* MAC with copy button */}
                    <View style={styles.deviceMacRow}>
                      <Text style={styles.deviceMac}>{d.mac_address}</Text>
                      <Pressable
                        style={styles.macCopyBtn}
                        hitSlop={8}
                        onPress={(e) => {
                          e.stopPropagation();
                          Clipboard.setString(d.mac_address);
                          Alert.alert('MAC copiado!', d.mac_address);
                        }}
                      >
                        <Ionicons name="copy-outline" size={12} color={Colors.primary} />
                      </Pressable>
                    </View>
                    {/* Status and expiry */}
                    <View style={styles.deviceMeta}>
                      <Text style={[styles.deviceMetaText, { color: isOnline(d.last_seen_at) ? '#4CAF50' : Colors.textMuted }]}>
                        {isOnline(d.last_seen_at) ? '● Online' : d.blocked_reason ? '⛔ Bloqueado' : d.activated ? '✓ Ativo' : '⏳ Pendente'}
                      </Text>
                      {d.activated && !d.blocked_reason && d.expires_at ? (
                        <Text style={[styles.deviceMetaText, { color: new Date(d.expires_at) < new Date() ? Colors.error : '#4CAF50', fontWeight: '600' }]}>
                          {new Date(d.expires_at) < new Date()
                            ? 'Expirado'
                            : `Vence ${new Date(d.expires_at).toLocaleDateString('pt-BR')}`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </Pressable>
              ))
            )}
          </View>
        )}

        {/* ── ADD / ACTIVATE ── */}
        {activeTab === 'add' && (
          <View style={styles.section}>
            <View style={styles.addCard}>
              <Ionicons name="add-circle" size={36} color={Colors.primary} style={{ marginBottom: 8 }} />
              <Text style={styles.addCardTitle}>Ativar novo MAC</Text>
              <Text style={styles.addCardSub}>
                Você tem <Text style={{ color: '#FFD700', fontWeight: '700' }}>{rep?.credits ?? 0} crédito(s)</Text> disponíveis
              </Text>

              {/* MAC */}
              <Text style={styles.fieldLabel}>MAC do dispositivo *</Text>
              <View style={[styles.inputWrap, { borderColor: addForm.mac.length >= 17 ? 'rgba(76,175,80,0.5)' : 'rgba(255,255,255,0.08)' }]}>
                <Ionicons name="hardware-chip-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="XX:XX:XX:XX:XX:XX"
                  placeholderTextColor={Colors.textMuted}
                  value={addForm.mac}
                  onChangeText={handleAddMacChange}
                  autoCapitalize="characters"
                />
                {addLookingUp ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
              </View>
              {addForm.mac.length >= 17 && !addLookingUp && (
                <Text style={styles.lookupHint}>
                  {addForm.clientName ? `✓ Cliente encontrado: ${addForm.clientName}` : 'MAC não cadastrado — novo cliente'}
                </Text>
              )}

              {/* Client name */}
              <Text style={styles.fieldLabel}>Nome do cliente</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Nome do cliente (opcional)"
                  placeholderTextColor={Colors.textMuted}
                  value={addForm.clientName}
                  onChangeText={v => setAddForm(f => ({ ...f, clientName: v }))}
                />
              </View>

              {/* Source */}
              <Text style={styles.fieldLabel}>Fonte de conteúdo *</Text>
              {sources.length === 0 ? (
                <View style={styles.noSourcesWarn}>
                  <Ionicons name="warning-outline" size={16} color="#FF9800" />
                  <Text style={styles.noSourcesText}> Sem fontes disponíveis. Solicite ao administrador.</Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {sources.map((s: Source) => (
                      <Pressable
                        key={s.id}
                        style={[styles.sourceChip, addForm.sourceId === s.id && styles.sourceChipActive]}
                        onPress={() => setAddForm(f => ({ ...f, sourceId: s.id }))}
                      >
                        <Text style={[styles.sourceChipText, addForm.sourceId === s.id && { color: '#fff' }]}>{s.name}</Text>
                        <Text style={[styles.sourceChipSub, addForm.sourceId === s.id && { color: 'rgba(255,255,255,0.7)' }]}>{s.active_macs ?? 0}/{s.max_connections}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* Package type */}
              <Text style={styles.fieldLabel}>Tipo de pacote *</Text>
              <View style={styles.pkgRow}>
                {(['iptv', 'p2p'] as const).map(pkg => (
                  <Pressable
                    key={pkg}
                    style={[styles.pkgBtn, addForm.packageType === pkg && styles.pkgBtnActive]}
                    onPress={() => setAddForm(f => ({ ...f, packageType: pkg }))}
                  >
                    <Ionicons name={pkg === 'iptv' ? 'tv-outline' : 'wifi-outline'} size={18} color={addForm.packageType === pkg ? '#fff' : Colors.textMuted} />
                    <Text style={[styles.pkgBtnText, addForm.packageType === pkg && { color: '#fff' }]}>{pkg.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Access period — presets + custom date */}
              <Text style={styles.fieldLabel}>Prazo de acesso *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { label: '30d', days: '30', credits: 1 },
                    { label: '60d', days: '60', credits: 2 },
                    { label: '90d', days: '90', credits: 3 },
                    { label: '180d', days: '180', credits: 6 },
                    { label: '1 ano', days: '365', credits: 13 },
                  ].map(opt => (
                    <Pressable
                      key={opt.days}
                      style={[styles.daysBtn, addForm.days === opt.days && styles.daysBtnActive]}
                      onPress={() => applyPresetDays(opt.days)}
                    >
                      <Text style={[styles.daysBtnLabel, addForm.days === opt.days && { color: '#fff' }]}>{opt.label}</Text>
                      <Text style={[styles.daysBtnCredits, addForm.days === opt.days && { color: 'rgba(255,255,255,0.75)' }]}>{opt.credits} cr.</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {/* Custom date input */}
              <View style={styles.dateRow}>
                <View style={[styles.inputWrap, { flex: 1, marginBottom: 0 }]}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="Data (DD/MM/AAAA)"
                    placeholderTextColor={Colors.textMuted}
                    value={addForm.expiresDateStr}
                    onChangeText={handleAddDateChange}
                    keyboardType="numeric"
                    maxLength={10}
                  />
                </View>
                <View style={styles.daysCountBadge}>
                  <Text style={styles.daysCountText}>{addForm.days || '—'}</Text>
                  <Text style={styles.daysCountLabel}>dias</Text>
                </View>
              </View>

              {addForm.days && parseInt(addForm.days) > 0 ? (
                <View style={styles.creditsCostRow}>
                  <Ionicons name="wallet-outline" size={14} color="#FFD700" />
                  <Text style={styles.creditsCostText}>
                    Custo: {(Math.round((parseInt(addForm.days) / 30) * 100) / 100).toFixed(2)} cr. para {addForm.days} dias
                  </Text>
                </View>
              ) : null}

              <Pressable
                style={[styles.activateBtn, (addLoading || sources.length === 0) && { opacity: 0.5 }]}
                onPress={handleAddDevice}
                disabled={addLoading || sources.length === 0}
              >
                {addLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Ionicons name="checkmark-circle-outline" size={20} color="#fff" /><Text style={styles.activateBtnText}>  Ativar Dispositivo</Text></>
                }
              </Pressable>
            </View>
          </View>
        )}

        {/* ── TEST ── */}
        {activeTab === 'test' && (
          <View style={styles.section}>
            <View style={styles.addCard}>
              <Ionicons name="time" size={36} color="#FF9800" style={{ marginBottom: 8 }} />
              <Text style={styles.addCardTitle}>Teste Gratuito</Text>
              <Text style={styles.addCardSub}>
                Libere acesso de 1 a 6 horas sem consumir créditos.{'\n'}
                <Text style={{ color: Colors.error }}>Após o prazo, o acesso é bloqueado automaticamente.</Text>
              </Text>

              {/* MAC */}
              <Text style={styles.fieldLabel}>MAC do dispositivo *</Text>
              <View style={[styles.inputWrap, { borderColor: testForm.mac.length >= 17 ? 'rgba(76,175,80,0.5)' : 'rgba(255,255,255,0.08)' }]}>
                <Ionicons name="hardware-chip-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="XX:XX:XX:XX:XX:XX"
                  placeholderTextColor={Colors.textMuted}
                  value={testForm.mac}
                  onChangeText={handleTestMacChange}
                  autoCapitalize="characters"
                />
                {testLookingUp ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
              </View>
              {testForm.mac.length >= 17 && !testLookingUp && (
                <Text style={styles.lookupHint}>
                  {testForm.clientName ? `✓ Cliente encontrado: ${testForm.clientName}` : 'MAC não cadastrado — novo cliente'}
                </Text>
              )}

              {/* Client name */}
              <Text style={styles.fieldLabel}>Nome do cliente</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Nome do cliente (opcional)"
                  placeholderTextColor={Colors.textMuted}
                  value={testForm.clientName}
                  onChangeText={v => setTestForm(f => ({ ...f, clientName: v }))}
                />
              </View>

              {/* Source */}
              <Text style={styles.fieldLabel}>Fonte de conteúdo *</Text>
              {sources.length === 0 ? (
                <View style={styles.noSourcesWarn}>
                  <Ionicons name="warning-outline" size={16} color="#FF9800" />
                  <Text style={styles.noSourcesText}> Sem fontes disponíveis. Solicite ao administrador.</Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {sources.map((s: Source) => (
                      <Pressable
                        key={s.id}
                        style={[styles.sourceChip, testForm.sourceId === s.id && styles.sourceChipActive]}
                        onPress={() => setTestForm(f => ({ ...f, sourceId: s.id }))}
                      >
                        <Text style={[styles.sourceChipText, testForm.sourceId === s.id && { color: '#fff' }]}>{s.name}</Text>
                        <Text style={[styles.sourceChipSub, testForm.sourceId === s.id && { color: 'rgba(255,255,255,0.7)' }]}>{s.active_macs ?? 0}/{s.max_connections}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* Package type */}
              <Text style={styles.fieldLabel}>Tipo de pacote *</Text>
              <View style={styles.pkgRow}>
                {(['iptv', 'p2p'] as const).map(pkg => (
                  <Pressable
                    key={pkg}
                    style={[styles.pkgBtn, testForm.packageType === pkg && styles.pkgBtnActive]}
                    onPress={() => setTestForm(f => ({ ...f, packageType: pkg }))}
                  >
                    <Ionicons name={pkg === 'iptv' ? 'tv-outline' : 'wifi-outline'} size={18} color={testForm.packageType === pkg ? '#fff' : Colors.textMuted} />
                    <Text style={[styles.pkgBtnText, testForm.packageType === pkg && { color: '#fff' }]}>{pkg.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Hours */}
              <Text style={styles.fieldLabel}>Horas de teste (1–6h) *</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                {['1', '2', '3', '4', '6'].map(h => (
                  <Pressable
                    key={h}
                    style={[styles.daysBtn, testForm.hours === h && styles.daysBtnActive, { minWidth: 52 }]}
                    onPress={() => setTestForm(f => ({ ...f, hours: h }))}
                  >
                    <Text style={[styles.daysBtnLabel, testForm.hours === h && { color: '#fff' }]}>{h}h</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.inputWrap}>
                <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Ou digite as horas (1-6)"
                  placeholderTextColor={Colors.textMuted}
                  value={testForm.hours}
                  onChangeText={v => setTestForm(f => ({ ...f, hours: v.replace(/\D/g, '') }))}
                  keyboardType="number-pad"
                />
              </View>

              <Pressable
                style={[styles.activateBtn, { backgroundColor: '#FF9800' }, (testLoading || sources.length === 0) && { opacity: 0.5 }]}
                onPress={handleTestActivation}
                disabled={testLoading || sources.length === 0}
              >
                {testLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Ionicons name="time-outline" size={20} color="#fff" /><Text style={styles.activateBtnText}>  Liberar Teste</Text></>
                }
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── DEVICE DETAIL MODAL ── */}
      <Modal visible={detailModal} transparent animationType="slide" onRequestClose={() => !actionLoading && setDetailModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false}>
                {selectedDevice && (
                  <>
                    <Text style={styles.modalTitle}>Detalhes do Cliente</Text>

                    {isOnline(selectedDevice.last_seen_at) && (
                      <View style={styles.onlineBannerRow}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' }} />
                        <Text style={styles.onlineBannerText}>Dispositivo ONLINE agora</Text>
                      </View>
                    )}

                    {/* Client name prominent */}
                    <View style={styles.clientNameBanner}>
                      <Ionicons name="person-circle-outline" size={20} color={Colors.primary} />
                      <Text style={styles.clientNameBannerText}>
                        {selectedDevice.client_name || 'Cliente sem nome'}
                      </Text>
                    </View>

                    {[
                      { icon: 'tv-outline', label: 'Pacote', value: (selectedDevice.package_type ?? 'iptv').toUpperCase() },
                      { icon: 'server-outline', label: 'Fonte', value: selectedDevice.sources?.name ?? '—' },
                      { icon: 'time-outline', label: 'Último acesso', value: formatLastSeen(selectedDevice.last_seen_at) },
                    ].map(row => (
                      <View key={row.label} style={styles.detailRow}>
                        <Ionicons name={row.icon as any} size={14} color={Colors.textMuted} />
                        <Text style={styles.detailLabel}>{row.label}</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>{row.value}</Text>
                      </View>
                    ))}

                    {/* Current content — what the client is watching */}
                    {selectedDevice.current_content ? (
                      <View style={[styles.onlineBannerRow, { backgroundColor: 'rgba(156,39,176,0.08)', borderColor: 'rgba(156,39,176,0.25)' }]}>
                        <Ionicons name="play-circle-outline" size={14} color="#9C27B0" />
                        <Text style={[styles.onlineBannerText, { color: '#CE93D8' }]} numberOfLines={2}>Assistindo: {selectedDevice.current_content}</Text>
                      </View>
                    ) : null}

                    {/* MAC row with copy button */}
                    <Pressable
                      style={styles.detailRow}
                      onPress={() => {
                        Clipboard.setString(selectedDevice.mac_address);
                        Alert.alert('Copiado!', selectedDevice.mac_address);
                      }}
                    >
                      <Ionicons name="hardware-chip-outline" size={14} color={Colors.textMuted} />
                      <Text style={styles.detailLabel}>MAC</Text>
                      <Text style={[styles.detailValue, { fontFamily: 'monospace', fontSize: 11, flex: 1 }]} numberOfLines={1}>{selectedDevice.mac_address}</Text>
                      <View style={styles.copyIconBtn}>
                        <Ionicons name="copy-outline" size={14} color={Colors.primary} />
                        <Text style={styles.copyIconLabel}>Copiar</Text>
                      </View>
                    </Pressable>

                    {/* Status */}
                    <View style={styles.detailRow}>
                      <View style={[styles.statusDot, {
                        backgroundColor: isOnline(selectedDevice.last_seen_at) ? '#4CAF50' : selectedDevice.activated ? '#8BC34A' : selectedDevice.blocked_reason ? Colors.error : '#FF9800'
                      }]} />
                      <Text style={styles.detailLabel}>Status</Text>
                      <Text style={[styles.detailValue, { fontWeight: '700', color: isOnline(selectedDevice.last_seen_at) ? '#4CAF50' : selectedDevice.activated ? '#8BC34A' : selectedDevice.blocked_reason ? Colors.error : '#FF9800' }]}>
                        {isOnline(selectedDevice.last_seen_at) ? 'ONLINE' : selectedDevice.activated ? 'ATIVO' : selectedDevice.blocked_reason ? 'BLOQUEADO' : 'INATIVO'}
                      </Text>
                    </View>

                    {/* Expiry */}
                    {selectedDevice.expires_at && (
                      <View style={styles.detailRow}>
                        <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
                        <Text style={styles.detailLabel}>Vencimento</Text>
                        <Text style={[styles.detailValue, { color: new Date(selectedDevice.expires_at) < new Date() ? Colors.error : '#4CAF50', fontWeight: '700' }]}>
                          {new Date(selectedDevice.expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </Text>
                      </View>
                    )}

                    {/* Renew button */}
                    <Pressable
                      style={[styles.renewBtn, actionLoading && { opacity: 0.5 }]}
                      onPress={() => { setRenewDays('30'); setRenewModal(true); }}
                      disabled={actionLoading}
                    >
                      <Ionicons name="refresh-circle-outline" size={20} color="#fff" />
                      <Text style={styles.renewBtnText}> Renovar Acesso</Text>
                      <View style={styles.renewCreditBadge}>
                        <Ionicons name="wallet-outline" size={11} color="#FFD700" />
                        <Text style={styles.renewCreditBadgeText}> {rep?.credits ?? 0} cr.</Text>
                      </View>
                    </Pressable>

                    {/* Current content (what client is watching) */}
                    {selectedDevice.current_content ? (
                      <View style={[styles.clientNameBanner, { backgroundColor: 'rgba(156,39,176,0.08)', borderColor: 'rgba(156,39,176,0.25)', marginTop: 4 }]}>
                        <Ionicons name="play-circle-outline" size={16} color="#9C27B0" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: Colors.textMuted, fontSize: 10, fontWeight: '600' }}>ASSISTINDO AGORA</Text>
                          <Text style={[styles.clientNameBannerText, { color: '#CE93D8', fontSize: 13 }]} numberOfLines={2}>{selectedDevice.current_content}</Text>
                        </View>
                      </View>
                    ) : null}

                    {/* Secondary actions */}
                    <View style={[styles.modalActions, { marginTop: 8 }]}>
                      <Pressable style={[styles.modalActionBtn, { backgroundColor: '#FF9800' }]} onPress={handleDeactivate} disabled={actionLoading}>
                        <Ionicons name="pause-circle-outline" size={16} color="#fff" />
                        <Text style={styles.modalActionText}> Desativar</Text>
                      </Pressable>
                      {selectedDevice.blocked_reason ? (
                        <Pressable style={[styles.modalActionBtn, { backgroundColor: '#4CAF50' }]} onPress={handleUnblock} disabled={actionLoading}>
                          <Ionicons name="lock-open-outline" size={16} color="#fff" />
                          <Text style={styles.modalActionText}> Desbloquear</Text>
                        </Pressable>
                      ) : (
                        <Pressable style={[styles.modalActionBtn, { backgroundColor: Colors.error }]} onPress={() => { setBlockReason(''); setBlockModal(true); }} disabled={actionLoading}>
                          <Ionicons name="ban-outline" size={16} color="#fff" />
                          <Text style={styles.modalActionText}> Bloquear</Text>
                        </Pressable>
                      )}
                    </View>

                    <Pressable
                      style={[styles.modalActionBtn, { backgroundColor: 'rgba(244,67,54,0.15)', borderWidth: 1, borderColor: 'rgba(244,67,54,0.4)', marginTop: 6 }]}
                      onPress={handleDelete}
                      disabled={actionLoading}
                    >
                      <Ionicons name="trash-outline" size={16} color={Colors.error} />
                      <Text style={[styles.modalActionText, { color: Colors.error }]}> Excluir da minha rede</Text>
                    </Pressable>

                    <Pressable style={styles.modalClose} onPress={() => !actionLoading && setDetailModal(false)}>
                      <Text style={styles.modalCloseText}>Fechar</Text>
                    </Pressable>
                  </>
                )}
                {actionLoading && (
                  <View style={{ alignItems: 'center', padding: 16 }}>
                    <ActivityIndicator color={Colors.primary} />
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── RENEW MODAL ── */}
      <Modal visible={renewModal} transparent animationType="fade" onRequestClose={() => !renewLoading && setRenewModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={[styles.modalBackdrop, { justifyContent: 'center' }]}>
            <View style={[styles.modalSheet, { borderRadius: 16, height: undefined, paddingBottom: 24 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Renovar Acesso</Text>
              {selectedDevice && (
                <View style={styles.renewDeviceInfo}>
                  <Ionicons name="person-circle-outline" size={13} color={Colors.textMuted} />
                  <Text style={styles.renewDeviceInfoText} numberOfLines={1}>
                    {selectedDevice.client_name || selectedDevice.mac_address}
                  </Text>
                </View>
              )}
              {selectedDevice?.expires_at && (
                <View style={[styles.renewCurrentExpiry, { backgroundColor: new Date(selectedDevice.expires_at) < new Date() ? 'rgba(229,0,0,0.08)' : 'rgba(76,175,80,0.08)' }]}>
                  <Ionicons name="calendar-outline" size={13} color={new Date(selectedDevice.expires_at) < new Date() ? Colors.error : '#4CAF50'} />
                  <Text style={[styles.renewCurrentExpiryText, { color: new Date(selectedDevice.expires_at) < new Date() ? Colors.error : '#4CAF50' }]}>
                    {new Date(selectedDevice.expires_at) < new Date() ? 'Expirado em ' : 'Vencimento atual: '}
                    {new Date(selectedDevice.expires_at).toLocaleDateString('pt-BR')}
                  </Text>
                </View>
              )}
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Dias a adicionar *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { label: '30d', days: '30', credits: 1 },
                    { label: '60d', days: '60', credits: 2 },
                    { label: '90d', days: '90', credits: 3 },
                    { label: '180d', days: '180', credits: 6 },
                    { label: '1 ano', days: '365', credits: 13 },
                  ].map(opt => (
                    <Pressable
                      key={opt.days}
                      style={[styles.daysBtn, renewDays === opt.days && styles.daysBtnActive]}
                      onPress={() => setRenewDays(opt.days)}
                    >
                      <Text style={[styles.daysBtnLabel, renewDays === opt.days && { color: '#fff' }]}>{opt.label}</Text>
                      <Text style={[styles.daysBtnCredits, renewDays === opt.days && { color: 'rgba(255,255,255,0.75)' }]}>{opt.credits} cr.</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.inputWrap}>
                <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Ou digite o número de dias"
                  placeholderTextColor={Colors.textMuted}
                  value={renewDays}
                  onChangeText={v => setRenewDays(v.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                />
              </View>
              {renewDays && parseInt(renewDays) > 0 ? (
                <View style={styles.creditsCostRow}>
                  <Ionicons name="wallet-outline" size={14} color="#FFD700" />
                  <Text style={styles.creditsCostText}>
                    {(() => { const cost = Math.round((parseInt(renewDays) / 30) * 100) / 100; return `Custo: ${cost.toFixed(2)} cr. — Saldo após: ${Math.round(((rep?.credits ?? 0) - cost) * 100) / 100} cr.`; })()}
                  </Text>
                </View>
              ) : null}
              {renewDays && parseInt(renewDays) > 0 ? (
                <View style={styles.renewExpiryPreview}>
                  <Ionicons name="checkmark-circle-outline" size={14} color="#4CAF50" />
                  <Text style={styles.renewExpiryPreviewText}>
                    Novo vencimento: {computeNewExpiry(selectedDevice, renewDays)}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.modalActions, { marginTop: 14 }]}>
                <Pressable style={[styles.modalActionBtn, { backgroundColor: 'rgba(255,255,255,0.07)', flex: 1 }]} onPress={() => { if (!renewLoading) setRenewModal(false); }}>
                  <Text style={[styles.modalActionText, { color: Colors.textSecondary }]}>Cancelar</Text>
                </Pressable>
                <Pressable style={[styles.modalActionBtn, { flex: 1, backgroundColor: '#4CAF50' }, renewLoading && { opacity: 0.6 }]} onPress={handleRenew} disabled={renewLoading}>
                  {renewLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Ionicons name="refresh-circle-outline" size={16} color="#fff" /><Text style={styles.modalActionText}> Renovar</Text></>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── BLOCK REASON MODAL ── */}
      <Modal visible={blockModal} transparent animationType="fade" onRequestClose={() => setBlockModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={[styles.modalBackdrop, { justifyContent: 'center' }]}>
            <View style={[styles.modalSheet, { borderRadius: 16, height: undefined, paddingBottom: 20 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Bloquear Dispositivo</Text>
              <Text style={{ color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>Motivo do bloqueio (opcional):</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {['Falta de pagamento', 'Teste expirado', 'Uso indevido', 'Conta suspensa'].map(reason => (
                    <Pressable
                      key={reason}
                      style={[styles.reasonChip, blockReason === reason && styles.reasonChipActive]}
                      onPress={() => setBlockReason(reason)}
                    >
                      <Text style={[styles.reasonChipText, blockReason === reason && { color: Colors.primary }]}>{reason}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.inputWrap}>
                <Ionicons name="create-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Ou escreva o motivo..."
                  placeholderTextColor={Colors.textMuted}
                  value={blockReason}
                  onChangeText={setBlockReason}
                />
              </View>
              <View style={styles.modalActions}>
                <Pressable style={[styles.modalActionBtn, { backgroundColor: 'rgba(255,255,255,0.07)', flex: 1 }]} onPress={() => setBlockModal(false)}>
                  <Text style={[styles.modalActionText, { color: Colors.textSecondary }]}>Cancelar</Text>
                </Pressable>
                <Pressable style={[styles.modalActionBtn, { flex: 1, backgroundColor: Colors.error }]} onPress={handleBlock}>
                  <Ionicons name="ban-outline" size={16} color="#fff" />
                  <Text style={styles.modalActionText}> Confirmar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderColor: `${color}30` }]}>
      <Ionicons name={icon as any} size={22} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  loginBg: { alignItems: 'center' },
  backBtnTop: {
    position: 'absolute', top: 16, left: 16, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  loginCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, width: '100%', maxWidth: 400 },
  loginIconWrap: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(229,0,0,0.1)',
    borderWidth: 2, borderColor: 'rgba(229,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  loginTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  loginSub: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  loginCard: { width: '100%', backgroundColor: '#141414', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: 12, height: 52, marginTop: 4 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  errorText: { color: Colors.error, fontSize: 12, flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', gap: 8, backgroundColor: '#111' },
  headerBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)' },
  headerIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  headerSub: { color: Colors.textMuted, fontSize: 10 },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },
  onlineText: { color: '#4CAF50', fontSize: 11, fontWeight: '700' },
  creditsBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.1)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)' },
  creditsText: { color: '#FFD700', fontSize: 12, fontWeight: '700' },
  tabBarScroll: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', backgroundColor: '#111', flexGrow: 0 },
  tabBar: { flexDirection: 'row' },
  tabItem: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 18, gap: 3, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: Colors.primary },
  tabLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '500' },
  tabLabelActive: { color: Colors.primary, fontWeight: '700' },
  section: { padding: 16 },
  sectionTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: (width - 56) / 3, backgroundColor: '#141414', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
  sourceCard: { backgroundColor: '#141414', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  sourceCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  sourceIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  sourceName: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  sourceUrl: { color: Colors.primary, fontSize: 11 },
  sourceConnBadge: { flexDirection: 'row', alignItems: 'baseline', backgroundColor: 'rgba(229,0,0,0.1)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  sourceConnText: { color: Colors.primary, fontSize: 14, fontWeight: '800' },
  sourceConnLabel: { color: Colors.textMuted },
  sourcePackageRow: { flexDirection: 'row', gap: 8 },
  pkgBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(229,0,0,0.3)', backgroundColor: 'rgba(229,0,0,0.06)' },
  pkgBadgeText: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
  creditsInfoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(255,215,0,0.06)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)', marginTop: 16 },
  creditsInfoTitle: { color: '#FFD700', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  creditsInfoText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  filterChipActive: { backgroundColor: 'rgba(229,0,0,0.15)', borderColor: Colors.primary },
  filterChipText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  filterChipTextActive: { color: Colors.primary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, color: '#fff', fontSize: 13 },
  deviceCard: { backgroundColor: '#141414', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  deviceClientName: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  deviceMacRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  deviceMac: { color: Colors.textMuted, fontSize: 10, fontFamily: 'monospace', flex: 1 },
  macCopyBtn: { width: 22, height: 22, borderRadius: 5, backgroundColor: 'rgba(229,0,0,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  deviceMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  deviceMetaText: { color: Colors.textMuted, fontSize: 10 },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 10 },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
  emptySubText: { color: Colors.textMuted, fontSize: 12 },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 8 },
  emptyAddBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  addCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)', alignItems: 'center' },
  addCardTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  addCardSub: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  fieldLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 6, alignSelf: 'flex-start', width: '100%' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 12, height: 48, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 8, marginBottom: 10, width: '100%' },
  input: { flex: 1, color: '#fff', fontSize: 14 },
  lookupHint: { color: '#4CAF50', fontSize: 11, marginBottom: 8, alignSelf: 'flex-start', paddingHorizontal: 2 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, width: '100%' },
  daysCountBadge: { alignItems: 'center', backgroundColor: 'rgba(229,0,0,0.1)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)', minWidth: 60 },
  daysCountText: { color: Colors.primary, fontSize: 16, fontWeight: '800' },
  daysCountLabel: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
  sourceChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  sourceChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  sourceChipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  sourceChipSub: { color: Colors.textMuted, fontSize: 10, marginTop: 2 },
  pkgRow: { flexDirection: 'row', gap: 10, marginBottom: 10, width: '100%' },
  pkgBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  pkgBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pkgBtnText: { color: Colors.textMuted, fontSize: 14, fontWeight: '700' },
  daysBtn: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', minWidth: 72 },
  daysBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  daysBtnLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  daysBtnCredits: { color: Colors.textMuted, fontSize: 9, marginTop: 2 },
  creditsCostRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,215,0,0.06)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)', marginBottom: 10, width: '100%' },
  creditsCostText: { color: '#FFD700', fontSize: 12, fontWeight: '600', flex: 1 },
  noSourcesWarn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,152,0,0.08)', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: 'rgba(255,152,0,0.25)', marginBottom: 10, width: '100%' },
  noSourcesText: { color: '#FF9800', fontSize: 12, flex: 1 },
  activateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#4CAF50', borderRadius: 12, height: 52, width: '100%', marginTop: 4, shadowColor: '#4CAF50', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 },
  activateBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  renewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#4CAF50', borderRadius: 12, height: 52, marginTop: 16, marginBottom: 4, paddingHorizontal: 16, shadowColor: '#4CAF50', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6 },
  renewBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
  renewCreditBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  renewCreditBadgeText: { color: '#FFD700', fontSize: 10, fontWeight: '700' },
  renewDeviceInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 10, marginBottom: 8 },
  renewDeviceInfoText: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
  renewCurrentExpiry: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  renewCurrentExpiryText: { fontSize: 12, fontWeight: '600' },
  renewExpiryPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(76,175,80,0.08)', borderRadius: 8, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: 'rgba(76,175,80,0.25)' },
  renewExpiryPreviewText: { color: '#4CAF50', fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#141414', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34, maxHeight: '90%', borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(229,0,0,0.2)' },
  modalHandle: { width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  onlineBannerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)' },
  onlineBannerText: { color: '#4CAF50', fontSize: 12, fontWeight: '700' },
  clientNameBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(229,0,0,0.08)', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  clientNameBannerText: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 8 },
  detailLabel: { color: Colors.textMuted, fontSize: 12, width: 80 },
  detailValue: { color: '#fff', fontSize: 12, flex: 1, textAlign: 'right' },
  copyIconBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(229,0,0,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)' },
  copyIconLabel: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modalActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 10, height: 44 },
  modalActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  modalClose: { alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', marginTop: 8 },
  modalCloseText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  reasonChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  reasonChipActive: { backgroundColor: 'rgba(229,0,0,0.15)', borderColor: Colors.primary },
  reasonChipText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
});
