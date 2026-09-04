import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Modal, ActivityIndicator, Alert, Dimensions, KeyboardAvoidingView,
  Platform, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';
import {
  getDevices, getPlans, getStats, getNotifications, getWatchingNow,
  activateDevice, deactivateDevice, blockDevice, deleteDevice, deleteDevicesBulk,
  deleteInactiveDevices, grantGracePeriod, updateDeviceNotes, setDeviceExpiry,
  setDevicePrice, createPlan, updatePlan, deletePlan, preAuthorizeEmail,
  sendNotification, deleteNotification, setAdminPassword,
  getSubAdmins, createSubAdmin, updateSubAdmin, deleteSubAdmin, subAdminLogin,
  setSubAdminCredentials, clearSubAdminCredentials, isSubAdminSession,
  Device, Plan, AdminStats, Notification, WatchingDevice, SubAdmin,
} from '@/services/adminApiService';
import {
  getRepresentatives, createRepresentative, updateRepresentative, deleteRepresentative,
  addCredits, removeCredits, getSources, createSource, updateSource, deleteSource,
  setRepAdminPassword, setRepSubAdminCredentials, clearRepSubAdminCredentials,
  Representative, Source,
} from '@/services/repApiService';

const { width } = Dimensions.get('window');

type Tab = 'dashboard' | 'devices' | 'plans' | 'notifications' | 'watching' | 'add' | 'reps' | 'sources' | 'financial' | 'subadmins';

function isOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return 'Nunca';
  const diff = Date.now() - new Date(lastSeen).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Agora';
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return new Date(lastSeen).toLocaleDateString('pt-BR');
}

function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseDateInput(value: string): string | null {
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length < 4) return null;
  const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T23:59:59.000Z`);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState(false);
  const [isSubAdmin, setIsSubAdmin] = useState(false);
  const [currentSubAdmin, setCurrentSubAdmin] = useState<SubAdmin | null>(null);
  const [loginMode, setLoginMode] = useState<'root' | 'subadmin'>('root');
  const [subAdminUsername, setSubAdminUsername] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [watchingNow, setWatchingNow] = useState<WatchingDevice[]>([]);
  const [devicesFilter, setDevicesFilter] = useState<'all' | 'active' | 'pending' | 'blocked' | 'online'>('all');
  const [devicesSearch, setDevicesSearch] = useState('');

  // Block pending — open blockReasonModal only after deviceModal fully closes (Android dual-modal fix)
  const pendingBlockRef = useRef(false);

  // Bulk
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  // Device modal
  const [deviceModal, setDeviceModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [deviceNotesInput, setDeviceNotesInput] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [deviceExpiryInput, setDeviceExpiryInput] = useState('');
  const [devicePriceInput, setDevicePriceInput] = useState('');
  const [deviceActionLoading, setDeviceActionLoading] = useState(false);
  const [blockReasonModal, setBlockReasonModal] = useState(false);
  const [blockReasonInput, setBlockReasonInput] = useState('');

  // Plan modal
  const [planModal, setPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({ name: '', server_url: 'https://odira.sbs', xtream_username: '', xtream_password: '', max_macs: '5', notes: '' });
  const [planFormLoading, setPlanFormLoading] = useState(false);

  // Notification modal
  const [notifModal, setNotifModal] = useState(false);
  const [notifForm, setNotifForm] = useState({ title: '', message: '', targetEmail: '', isBroadcast: true });
  const [notifLoading, setNotifLoading] = useState(false);

  // Pre-authorize
  const [preAuthEmail, setPreAuthEmail] = useState('');
  const [preAuthMac, setPreAuthMac] = useState('');
  const [preAuthPlanId, setPreAuthPlanId] = useState('');
  const [preAuthLoading, setPreAuthLoading] = useState(false);

  // Representatives
  const [reps, setReps] = useState<Representative[]>([]);
  const [repModal, setRepModal] = useState(false);
  const [editingRep, setEditingRep] = useState<Representative | null>(null);
  const [repForm, setRepForm] = useState({ name: '', rep_number: '', password: '', credits: '0', notes: '' });
  const [repFormLoading, setRepFormLoading] = useState(false);
  const [creditsModal, setCreditsModal] = useState(false);
  const [creditsRep, setCreditsRep] = useState<Representative | null>(null);
  const [creditsInput, setCreditsInput] = useState('');
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [creditsMode, setCreditsMode] = useState<'add' | 'remove'>('add');
  const [creditsDescription, setCreditsDescription] = useState('');

  // Sub-admins
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [subAdminModal, setSubAdminModal] = useState(false);
  const [editingSubAdmin, setEditingSubAdmin] = useState<SubAdmin | null>(null);
  const [subAdminForm, setSubAdminForm] = useState({ username: '', password: '', name: '', notes: '' });
  const [subAdminFormLoading, setSubAdminFormLoading] = useState(false);

  // Sources
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceModal, setSourceModal] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [sourceForm, setSourceForm] = useState({ name: '', server_url: 'https://odira.sbs', xtream_username: '', xtream_password: '', max_connections: '5', rep_id: '', notes: '' });
  const [sourceFormLoading, setSourceFormLoading] = useState(false);
  const [expandedSourceReps, setExpandedSourceReps] = useState<Set<string>>(new Set());

  // Devices — rep grouping
  // null = show rep list; string repId = show that rep's devices; 'admin' = admin direct; 'all' = show all flat
  const [devicesRepFilter, setDevicesRepFilter] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Android fix: open blockReasonModal only after deviceModal is fully closed
  useEffect(() => {
    if (!deviceModal && pendingBlockRef.current) {
      pendingBlockRef.current = false;
      const t = setTimeout(() => setBlockReasonModal(true), 320);
      return () => clearTimeout(t);
    }
  }, [deviceModal]);

  async function handlePasswordSubmit() {
    if (!passwordInput.trim()) { setPasswordError('Digite a senha de acesso'); return; }
    setLoading(true);
    setPasswordError('');
    try {
      if (loginMode === 'subadmin') {
        if (!subAdminUsername.trim()) { setPasswordError('Digite o usuário'); setLoading(false); return; }
        const result = await subAdminLogin(subAdminUsername.trim(), passwordInput.trim());
        if (!result.ok || !result.admin) { setPasswordError(result.error || 'Credenciais inválidas'); setLoading(false); return; }
        // Set credentials BEFORE any data fetching
        setSubAdminCredentials(result.admin.id, passwordInput.trim());
        setRepSubAdminCredentials(result.admin.id, passwordInput.trim());
        setCurrentSubAdmin(result.admin);
        setIsSubAdmin(true);
        setAuthenticated(true);
        await loadAllForSubAdmin();
      } else {
        // Set password BEFORE calling getStats so auth header is populated
        setAdminPassword(passwordInput.trim());
        setRepAdminPassword(passwordInput.trim());
        // Verify password by calling getStats
        const statsData = await getStats();
        setStats(statsData);
        setAuthenticated(true);
        // Load all data after successful auth
        await loadAll(true);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('401') || msg.toLowerCase().includes('senha') || msg.toLowerCase().includes('incorreta')) {
        setPasswordError('Senha incorreta');
      } else {
        setPasswordError('Erro de conexão. Tente novamente.');
      }
      // Clear credentials on failure
      setAdminPassword('');
      setRepAdminPassword('');
      clearSubAdminCredentials();
      clearRepSubAdminCredentials();
    }
    setLoading(false);
  }

  /** Load for sub-admin — called immediately after sub-admin login (isSubAdmin state not yet committed) */
  async function loadAllForSubAdmin(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [s, d, p, n, repsList, sourcesList] = await Promise.all([
        getStats(), getDevices(), getPlans(), getNotifications(), getRepresentatives(), getSources()
      ]);
      setStats(s); setDevices(d); setPlans(p); setNotifications(n);
      setReps(repsList); setSources(sourcesList);
    } catch (err: any) {
      if (!silent) Alert.alert('Erro', err.message);
    }
    if (!silent) setLoading(false);
    setRefreshing(false);
  }

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const promises: Promise<any>[] = [
        getStats(), getDevices(), getPlans(), getNotifications(), getRepresentatives(), getSources()
      ];
      if (!isSubAdmin) promises.push(getSubAdmins());
      const results = await Promise.all(promises);
      const [s, d, p, n, repsList, sourcesList, subAdminsList] = results;
      setStats(s); setDevices(d); setPlans(p); setNotifications(n);
      setReps(repsList); setSources(sourcesList);
      if (!isSubAdmin && subAdminsList) setSubAdmins(subAdminsList);
    } catch (err: any) {
      if (!silent) Alert.alert('Erro', err.message);
    }
    if (!silent) setLoading(false);
    setRefreshing(false);
  }, [isSubAdmin]);

  const loadWatching = useCallback(async () => {
    try { const w = await getWatchingNow(); setWatchingNow(w); } catch {}
  }, []);

  useEffect(() => {
    if (authenticated) {
      intervalRef.current = setInterval(() => loadAll(true), 30000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
  }, [authenticated, loadAll]);

  useEffect(() => {
    if (authenticated && activeTab === 'watching') {
      loadWatching();
      watchingIntervalRef.current = setInterval(loadWatching, 15000);
      return () => { if (watchingIntervalRef.current) clearInterval(watchingIntervalRef.current); };
    }
  }, [authenticated, activeTab, loadWatching]);

  const filteredDevices = devices.filter(d => {
    const matchFilter =
      devicesFilter === 'all' ? true :
      devicesFilter === 'active' ? (d.activated && !d.blocked_reason) :
      devicesFilter === 'pending' ? (!d.activated && !d.blocked_reason) :
      devicesFilter === 'blocked' ? !!d.blocked_reason :
      devicesFilter === 'online' ? isOnline(d.last_seen_at) : true;
    const q = devicesSearch.toLowerCase();
    const matchSearch = !q || d.email.toLowerCase().includes(q) || d.mac_address.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  function toggleSelectMode() { setSelectMode(s => !s); setSelectedIds(new Set()); }
  function toggleSelect(id: string) { setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function selectAll() { setSelectedIds(new Set(filteredDevices.map(d => d.id))); }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    Alert.alert('Excluir selecionados', `Excluir ${selectedIds.size} dispositivo(s)?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        setBulkDeleteLoading(true);
        try {
          await deleteDevicesBulk(Array.from(selectedIds));
          setSelectMode(false); setSelectedIds(new Set());
          await loadAll(true);
          Alert.alert('Pronto', `${selectedIds.size} dispositivo(s) excluídos.`);
        } catch (err: any) { Alert.alert('Erro', err.message); }
        setBulkDeleteLoading(false);
      }}
    ]);
  }

  function openDeviceModal(device: Device) {
    setSelectedDevice(device);
    setDeviceNotesInput(device.notes || '');
    setSelectedPlanId(device.plan_id || (plans[0]?.id || ''));
    setDeviceExpiryInput(isoToDisplay(device.expires_at));
    setDevicePriceInput(device.price != null ? String(device.price) : '');
    setDeviceModal(true);
  }

  async function handleSaveDevice() {
    if (!selectedDevice || !selectedPlanId) { Alert.alert('Selecione um plano'); return; }
    let expiresAt: string | null = null;
    if (deviceExpiryInput.trim()) {
      expiresAt = parseDateInput(deviceExpiryInput.trim());
      if (!expiresAt) { Alert.alert('Data inválida', 'Use o formato DD/MM/AAAA'); return; }
    }
    const price = devicePriceInput.trim() ? parseFloat(devicePriceInput.trim()) : null;
    setDeviceActionLoading(true);
    try {
      const actions: Promise<any>[] = [
        activateDevice(selectedDevice.id, selectedPlanId),
        setDeviceExpiry(selectedDevice.id, expiresAt),
        updateDeviceNotes(selectedDevice.id, deviceNotesInput),
      ];
      if (devicePriceInput !== (selectedDevice.price != null ? String(selectedDevice.price) : '')) {
        actions.push(setDevicePrice(selectedDevice.id, price) as any);
      }
      await Promise.all(actions);
      setDeviceModal(false);
      await loadAll(true);
    } catch (err: any) { Alert.alert('Erro ao salvar', err.message); }
    setDeviceActionLoading(false);
  }

  async function handleConfirmBlock() {
    if (!selectedDevice) return;
    setBlockReasonModal(false); setDeviceActionLoading(true);
    try {
      await blockDevice(selectedDevice.id, blockReasonInput.trim() || undefined);
      setDeviceModal(false); await loadAll(true);
    } catch (err: any) { Alert.alert('Erro ao bloquear', err.message); }
    setDeviceActionLoading(false);
  }

  async function handleDeactivateDevice() {
    if (!selectedDevice) return;
    Alert.alert('Desativar', `Desativar ${selectedDevice.email}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desativar', style: 'destructive', onPress: async () => {
        setDeviceActionLoading(true);
        try { await deactivateDevice(selectedDevice.id); setDeviceModal(false); await loadAll(true); }
        catch (err: any) { Alert.alert('Erro', err.message); }
        setDeviceActionLoading(false);
      }}
    ]);
  }

  async function handleDeleteDevice() {
    if (!selectedDevice) return;
    Alert.alert('Excluir dispositivo', `Remover ${selectedDevice.email}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        setDeviceActionLoading(true);
        try { await deleteDevice(selectedDevice.id); setDeviceModal(false); await loadAll(true); }
        catch (err: any) { Alert.alert('Erro', err.message); }
        setDeviceActionLoading(false);
      }}
    ]);
  }

  async function handleDeleteInactive() {
    Alert.alert('Excluir pendentes', 'Remover todos os dispositivos nunca ativados?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir todos', style: 'destructive', onPress: async () => {
        try { await deleteInactiveDevices(); Alert.alert('Pronto', 'Removidos!'); await loadAll(true); }
        catch (err: any) { Alert.alert('Erro', err.message); }
      }}
    ]);
  }

  async function handleGrantGrace() {
    if (!selectedDevice) return;
    Alert.alert('Conceder 3 dias', `Liberar 3 dias para ${selectedDevice.email}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Conceder', onPress: async () => {
        setDeviceActionLoading(true);
        try { await grantGracePeriod(selectedDevice.id); setDeviceModal(false); await loadAll(true); Alert.alert('Pronto', '3 dias concedidos!'); }
        catch (err: any) { Alert.alert('Erro', err.message); }
        setDeviceActionLoading(false);
      }}
    ]);
  }

  function openCreatePlan() { setEditingPlan(null); setPlanForm({ name: '', server_url: 'https://odira.sbs', xtream_username: '', xtream_password: '', max_macs: '5', notes: '' }); setPlanModal(true); }
  function openEditPlan(plan: Plan) { setEditingPlan(plan); setPlanForm({ name: plan.name, server_url: plan.server_url, xtream_username: plan.xtream_username, xtream_password: plan.xtream_password, max_macs: String(plan.max_macs), notes: plan.notes || '' }); setPlanModal(true); }

  async function handleSavePlan() {
    if (!planForm.name || !planForm.server_url || !planForm.xtream_username || !planForm.xtream_password) { Alert.alert('Preencha todos os campos obrigatórios'); return; }
    setPlanFormLoading(true);
    try {
      if (editingPlan) {
        await updatePlan(editingPlan.id, { name: planForm.name, server_url: planForm.server_url, xtream_username: planForm.xtream_username, xtream_password: planForm.xtream_password, max_macs: parseInt(planForm.max_macs) || 5, notes: planForm.notes || null } as any);
      } else {
        await createPlan({ name: planForm.name, server_url: planForm.server_url, xtream_username: planForm.xtream_username, xtream_password: planForm.xtream_password, max_macs: parseInt(planForm.max_macs) || 5, notes: planForm.notes });
      }
      setPlanModal(false); await loadAll(true);
    } catch (err: any) { Alert.alert('Erro', err.message); }
    setPlanFormLoading(false);
  }

  async function handleDeletePlan(plan: Plan) {
    Alert.alert('Excluir Plano', `Excluir "${plan.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { try { await deletePlan(plan.id); await loadAll(true); } catch (err: any) { Alert.alert('Erro', err.message); } } }
    ]);
  }

  async function handleDeleteNotification(notificationId: string) {
    try { await deleteNotification(notificationId); await loadAll(true); } catch (err: any) { Alert.alert('Erro ao excluir', err.message); }
  }

  async function handleSendNotification() {
    if (!notifForm.title || !notifForm.message) { Alert.alert('Preencha título e mensagem'); return; }
    setNotifLoading(true);
    try {
      await sendNotification({ title: notifForm.title, message: notifForm.message, targetEmail: notifForm.isBroadcast ? undefined : notifForm.targetEmail || undefined });
      Alert.alert('Aviso enviado!'); setNotifModal(false); setNotifForm({ title: '', message: '', targetEmail: '', isBroadcast: true }); await loadAll(true);
    } catch (err: any) { Alert.alert('Erro', err.message); }
    setNotifLoading(false);
  }

  async function handlePreAuthorize() {
    if (!preAuthEmail || !preAuthMac || !preAuthPlanId) { Alert.alert('Preencha todos os campos'); return; }
    setPreAuthLoading(true);
    try {
      await preAuthorizeEmail(preAuthEmail, preAuthPlanId, preAuthMac);
      Alert.alert('Sucesso', `${preAuthEmail} pré-autorizado!`);
      setPreAuthEmail(''); setPreAuthMac(''); setPreAuthPlanId(''); await loadAll(true);
    } catch (err: any) { Alert.alert('Erro', err.message); }
    setPreAuthLoading(false);
  }

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <View style={[styles.container, styles.loginScreen, { paddingTop: insets.top + 40 }]}>
        <Image source={require('@/assets/images/icon.png')} style={styles.loginLogo} contentFit="contain" />
        <Text style={styles.loginTitle}>Painel Administrativo</Text>
        <Text style={styles.loginSubtitle}>GBTVON — Acesso Restrito</Text>

        {/* Login mode toggle */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, width: '100%', maxWidth: 360 }}>
          <Pressable
            style={[styles.loginBtn, { flex: 1, height: 38, backgroundColor: loginMode === 'root' ? Colors.primary : '#1a1a1a', borderWidth: 1, borderColor: loginMode === 'root' ? Colors.primary : 'rgba(255,255,255,0.1)' }]}
            onPress={() => { setLoginMode('root'); setPasswordInput(''); setSubAdminUsername(''); setPasswordError(''); }}
          >
            <Ionicons name="shield-checkmark-outline" size={14} color={loginMode === 'root' ? '#fff' : Colors.textMuted} />
            <Text style={[styles.loginBtnText, { fontSize: 12, color: loginMode === 'root' ? '#fff' : Colors.textMuted }]}>  Admin Raiz</Text>
          </Pressable>
          <Pressable
            style={[styles.loginBtn, { flex: 1, height: 38, backgroundColor: loginMode === 'subadmin' ? '#1565C0' : '#1a1a1a', borderWidth: 1, borderColor: loginMode === 'subadmin' ? '#1565C0' : 'rgba(255,255,255,0.1)' }]}
            onPress={() => { setLoginMode('subadmin'); setPasswordInput(''); setSubAdminUsername(''); setPasswordError(''); }}
          >
            <Ionicons name="person-circle-outline" size={14} color={loginMode === 'subadmin' ? '#fff' : Colors.textMuted} />
            <Text style={[styles.loginBtnText, { fontSize: 12, color: loginMode === 'subadmin' ? '#fff' : Colors.textMuted }]}>  Sub-Admin</Text>
          </Pressable>
        </View>

        <View style={styles.loginCard}>
          {loginMode === 'subadmin' && (
            <View style={[styles.inputWrap, { marginBottom: 8 }]}>
              <Ionicons name="person-outline" size={18} color={Colors.textMuted} />
              <TextInput style={styles.input} placeholder="Usuário do sub-admin" placeholderTextColor={Colors.textMuted} value={subAdminUsername} onChangeText={t => { setSubAdminUsername(t); setPasswordError(''); }} autoCapitalize="none" returnKeyType="next" />
            </View>
          )}
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />
            <TextInput style={styles.input} placeholder={loginMode === 'root' ? 'Senha de acesso' : 'Senha do sub-admin'} placeholderTextColor={Colors.textMuted} value={passwordInput} onChangeText={t => { setPasswordInput(t); setPasswordError(''); }} secureTextEntry returnKeyType="go" onSubmitEditing={handlePasswordSubmit} />
          </View>
          {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          <Pressable style={[styles.loginBtn, { backgroundColor: loginMode === 'subadmin' ? '#1565C0' : Colors.primary }]} onPress={handlePasswordSubmit}>
            <Ionicons name={loginMode === 'subadmin' ? 'person-circle-outline' : 'shield-checkmark-outline'} size={18} color="#fff" />
            <Text style={styles.loginBtnText}>  Entrar</Text>
          </Pressable>
        </View>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={16} color={Colors.textMuted} />
          <Text style={styles.backLinkText}> Voltar ao app</Text>
        </Pressable>
      </View>
    );
  }

  const onlineCount = devices.filter(d => isOnline(d.last_seen_at)).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.adminHeader}>
        <Pressable onPress={() => router.back()} style={styles.headerBack} hitSlop={8}><Ionicons name="arrow-back" size={20} color="#fff" /></Pressable>
        <Image source={require('@/assets/images/icon.png')} style={styles.headerLogo} contentFit="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{isSubAdmin ? `Sub-Admin: ${currentSubAdmin?.name}` : 'Painel Admin'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' }} />
            <Text style={styles.headerSub}>{onlineCount} online • {watchingNow.length} assistindo</Text>
          </View>
        </View>
        <Pressable onPress={() => loadAll()} style={styles.headerRefresh} hitSlop={8} disabled={loading}>
          {loading ? <ActivityIndicator color={Colors.primary} size="small" /> : <Ionicons name="refresh" size={20} color={Colors.primary} />}
        </Pressable>
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarScroll}>
        <View style={styles.tabBar}>
          {([
            { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline' },
            { key: 'devices', label: 'Dispositivos', icon: 'phone-portrait-outline' },
            { key: 'plans', label: 'Planos', icon: 'layers-outline' },
            { key: 'reps', label: 'Representantes', icon: 'people-outline' },
            { key: 'sources', label: 'Fontes', icon: 'server-outline' },
            { key: 'notifications', label: 'Avisos', icon: 'notifications-outline' },
            { key: 'watching', label: 'Assistindo', icon: 'eye-outline' },
            { key: 'add', label: 'Pré-ativar', icon: 'person-add-outline' },
            { key: 'financial', label: 'Financeiro', icon: 'cash-outline' },
            ...(!isSubAdmin ? [{ key: 'subadmins' as Tab, label: 'Sub-Admins', icon: 'shield-half-outline' }] : []),
          ] as { key: Tab; label: string; icon: string }[]).map(tab => (
            <Pressable key={tab.key} style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]} onPress={() => setActiveTab(tab.key)}>
              <Ionicons name={tab.icon as any} size={18} color={activeTab === tab.key ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
              {tab.key === 'watching' && watchingNow.length > 0 && (
                <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{watchingNow.length}</Text></View>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} tintColor={Colors.primary} />}>

        {/* ── DASHBOARD ── */}
        {activeTab === 'dashboard' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Visão Geral</Text>
            <View style={styles.statsGrid}>
              <StatCard icon="phone-portrait" label="Total" value={String(stats?.total ?? '—')} color="#4FC3F7" />
              <StatCard icon="radio-button-on" label="Online" value={String(stats?.online ?? onlineCount)} color="#4CAF50" />
              <StatCard icon="checkmark-circle" label="Ativos" value={String(stats?.active ?? '—')} color="#8BC34A" />
              <StatCard icon="time" label="Pendentes" value={String(stats?.pending ?? '—')} color="#FF9800" />
              <StatCard icon="ban" label="Bloqueados" value={String(stats?.blocked ?? '—')} color={Colors.error} />
              <StatCard icon="eye" label="Assistindo" value={String(stats?.watching ?? watchingNow.length)} color="#9C27B0" />
            </View>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Online Agora</Text>
            {devices.filter(d => isOnline(d.last_seen_at)).length === 0 ? (
              <Text style={styles.emptyText}>Nenhum dispositivo online</Text>
            ) : devices.filter(d => isOnline(d.last_seen_at)).map(d => (
              <View key={d.id} style={styles.onlineRow}>
                <View style={styles.onlineDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceEmail} numberOfLines={1}>{d.email}</Text>
                  <Text style={styles.deviceMac}>{d.mac_address}</Text>
                </View>
                {d.current_content ? (
                  <View style={styles.watchingBadge}>
                    <Ionicons name={d.current_content_type === 'live' ? 'tv' : d.current_content_type === 'movie' ? 'film' : 'videocam'} size={10} color="#9C27B0" />
                    <Text style={styles.watchingBadgeText} numberOfLines={1}>{d.current_content}</Text>
                  </View>
                ) : <Text style={styles.lastSeenText}>{formatLastSeen(d.last_seen_at)}</Text>}
              </View>
            ))}
          </View>
        )}

        {/* ── DEVICES ── */}
        {activeTab === 'devices' && (() => {
          // Build rep groups
          const repGroups: { repId: string | null; repLabel: string; repNumber: string; count: number; online: number; active: number }[] = [];
          const repMap: Record<string, { repLabel: string; repNumber: string }> = {};
          for (const d of devices) {
            const key = d.rep_id ?? '__admin__';
            if (!repMap[key]) {
              repMap[key] = {
                repLabel: d.representatives ? `#${d.representatives.rep_number} — ${d.representatives.name}` : 'Admin Direto',
                repNumber: d.representatives ? d.representatives.rep_number : '—',
              };
            }
          }
          const uniqueKeys = Array.from(new Set(devices.map(d => d.rep_id ?? '__admin__')));
          for (const key of uniqueKeys) {
            const group = devices.filter(d => (d.rep_id ?? '__admin__') === key);
            repGroups.push({
              repId: key === '__admin__' ? null : key,
              repLabel: repMap[key].repLabel,
              repNumber: repMap[key].repNumber,
              count: group.length,
              online: group.filter(d => isOnline(d.last_seen_at)).length,
              active: group.filter(d => d.activated && !d.blocked_reason).length,
            });
          }
          repGroups.sort((a, b) => b.count - a.count);

          // Devices for current rep filter
          const repFilteredDevices = devicesRepFilter === null
            ? devices
            : devicesRepFilter === '__admin__'
              ? devices.filter(d => !d.rep_id)
              : devices.filter(d => d.rep_id === devicesRepFilter);

          const scopedFiltered = repFilteredDevices.filter(d => {
            const matchFilter =
              devicesFilter === 'all' ? true :
              devicesFilter === 'active' ? (d.activated && !d.blocked_reason) :
              devicesFilter === 'pending' ? (!d.activated && !d.blocked_reason) :
              devicesFilter === 'blocked' ? !!d.blocked_reason :
              devicesFilter === 'online' ? isOnline(d.last_seen_at) : true;
            const q = devicesSearch.toLowerCase();
            const matchSearch = !q || d.email.toLowerCase().includes(q) || d.mac_address.toLowerCase().includes(q) || (d.client_name || '').toLowerCase().includes(q);
            return matchFilter && matchSearch;
          });

          return (
            <View style={styles.section}>
              {/* ── REP SELECTOR — shown when no rep is drilled into ── */}
              {devicesRepFilter === null && !devicesSearch.trim() ? (
                <>
                  <Text style={styles.sectionTitle}>Filtrar por Representante</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 8, marginBottom: 14 }}>
                    <Ionicons name="search" size={14} color={Colors.textMuted} />
                    <TextInput style={{ flex: 1, color: '#fff', fontSize: 13 }} placeholder="Busca rápida (e-mail / MAC)..." placeholderTextColor={Colors.textMuted} value={devicesSearch} onChangeText={setDevicesSearch} />
                  </View>
                  {/* All flat */}
                  <Pressable
                    style={[styles.repGroupCard, { borderColor: 'rgba(229,0,0,0.3)', marginBottom: 8 }]}
                    onPress={() => setDevicesRepFilter('__all__')}
                  >
                    <View style={styles.repGroupIcon}><Ionicons name="apps-outline" size={20} color={Colors.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.repGroupLabel}>Todos os dispositivos</Text>
                      <Text style={styles.repGroupMeta}>{devices.length} MACs • {devices.filter(d => isOnline(d.last_seen_at)).length} online</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                  </Pressable>
                  {repGroups.map(g => (
                    <Pressable
                      key={g.repId ?? '__admin__'}
                      style={styles.repGroupCard}
                      onPress={() => setDevicesRepFilter(g.repId ?? '__admin__')}
                    >
                      <View style={[styles.repGroupIcon, { backgroundColor: g.repId ? 'rgba(255,215,0,0.08)' : 'rgba(229,0,0,0.08)' }]}>
                        <Ionicons name={g.repId ? 'headset-outline' : 'shield-outline'} size={20} color={g.repId ? '#FFD700' : Colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.repGroupLabel}>{g.repLabel}</Text>
                        <Text style={styles.repGroupMeta}>{g.count} MAC(s) • {g.active} ativo(s) • {g.online} online</Text>
                      </View>
                      <View style={[styles.planMacBadge, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' }]}>
                        <Text style={[styles.planMacText, { color: '#fff' }]}>{g.count}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={{ marginLeft: 6 }} />
                    </Pressable>
                  ))}
                </>
              ) : (
                /* ── DRILLED-IN VIEW ── */
                <>
                  {/* Back + header */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>
                    <Pressable
                      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => { setDevicesRepFilter(null); setDevicesSearch(''); setSelectMode(false); setSelectedIds(new Set()); }}
                      hitSlop={8}
                    >
                      <Ionicons name="arrow-back" size={18} color="#fff" />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      {devicesRepFilter === '__all__' ? (
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Todos os dispositivos</Text>
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                          {repGroups.find(g => (g.repId ?? '__admin__') === devicesRepFilter)?.repLabel ?? 'Dispositivos'}
                        </Text>
                      )}
                      <Text style={{ color: Colors.textMuted, fontSize: 10 }}>{scopedFiltered.length} dispositivo(s)</Text>
                    </View>
                  </View>

                  <View style={styles.searchWrap}>
                    <Ionicons name="search" size={14} color={Colors.textMuted} />
                    <TextInput style={styles.searchInput} placeholder="Buscar e-mail ou MAC..." placeholderTextColor={Colors.textMuted} value={devicesSearch} onChangeText={setDevicesSearch} />
                    <Pressable onPress={toggleSelectMode} hitSlop={8} style={[styles.selectModeBtn, selectMode && styles.selectModeBtnActive]}>
                      <Ionicons name={selectMode ? 'checkmark-circle' : 'checkbox-outline'} size={18} color={selectMode ? Colors.primary : Colors.textMuted} />
                    </Pressable>
                  </View>
                  {selectMode && (
                    <View style={styles.bulkBar}>
                      <Text style={styles.bulkBarText}>{selectedIds.size} selecionado(s)</Text>
                      <Pressable onPress={selectAll} style={styles.bulkBtn}><Text style={styles.bulkBtnText}>Todos ({scopedFiltered.length})</Text></Pressable>
                      <Pressable onPress={handleBulkDelete} style={[styles.bulkBtn, styles.bulkBtnDanger, selectedIds.size === 0 && { opacity: 0.4 }]} disabled={selectedIds.size === 0 || bulkDeleteLoading}>
                        {bulkDeleteLoading ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="trash-outline" size={14} color="#fff" /><Text style={[styles.bulkBtnText, { color: '#fff' }]}> Excluir</Text></>}
                      </Pressable>
                    </View>
                  )}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    <View style={styles.filterRow}>
                      {([
                        { key: 'all', label: `Todos (${repFilteredDevices.length})` },
                        { key: 'online', label: `Online (${repFilteredDevices.filter(d => isOnline(d.last_seen_at)).length})` },
                        { key: 'active', label: `Ativos (${repFilteredDevices.filter(d => d.activated && !d.blocked_reason).length})` },
                        { key: 'pending', label: `Pendentes (${repFilteredDevices.filter(d => !d.activated && !d.blocked_reason).length})` },
                        { key: 'blocked', label: `Bloqueados (${repFilteredDevices.filter(d => !!d.blocked_reason).length})` },
                      ] as const).map(f => (
                        <Pressable key={f.key} style={[styles.filterChip, devicesFilter === f.key && styles.filterChipActive]} onPress={() => setDevicesFilter(f.key)}>
                          <Text style={[styles.filterChipText, devicesFilter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                  {repFilteredDevices.filter(d => !d.activated && !d.blocked_reason).length > 0 && (
                    <Pressable style={styles.deleteInactiveBtn} onPress={handleDeleteInactive}>
                      <Ionicons name="trash-outline" size={14} color={Colors.error} />
                      <Text style={styles.deleteInactiveText}>Excluir {repFilteredDevices.filter(d => !d.activated && !d.blocked_reason).length} inativo(s)</Text>
                    </Pressable>
                  )}
                  {scopedFiltered.length === 0 ? (
                    <View style={styles.emptyState}><Ionicons name="phone-portrait-outline" size={40} color={Colors.textMuted} /><Text style={styles.emptyText}>Nenhum dispositivo encontrado</Text></View>
                  ) : scopedFiltered.map(d => {
                    const isSelected = selectedIds.has(d.id);
                    return (
                      <Pressable key={d.id} style={[styles.deviceCard, isSelected && styles.deviceCardSelected]} onPress={() => selectMode ? toggleSelect(d.id) : openDeviceModal(d)} onLongPress={() => { if (!selectMode) { setSelectMode(true); toggleSelect(d.id); } }}>
                        {selectMode && <View style={styles.checkboxWrap}><Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={20} color={isSelected ? Colors.primary : Colors.textMuted} /></View>}
                        <View style={{ flex: 1 }}>
                          <View style={styles.deviceCardHeader}>
                            <View style={[styles.statusIndicator, { backgroundColor: isOnline(d.last_seen_at) ? '#4CAF50' : d.activated ? '#8BC34A' : d.blocked_reason ? Colors.error : '#FF9800' }]} />
                            <View style={{ flex: 1 }}>
                              {d.client_name ? <Text style={[styles.deviceCardEmail, { fontWeight: '800' }]} numberOfLines={1}>{d.client_name}</Text> : null}
                              <Text style={d.client_name ? [styles.deviceCardMac, { color: 'rgba(255,255,255,0.6)', fontSize: 11 }] : styles.deviceCardEmail} numberOfLines={1}>{d.email}</Text>
                              <Text style={styles.deviceCardMac}>{d.mac_address}</Text>
                            </View>
                            <View style={styles.deviceCardRight}>
                              <Text style={[styles.deviceCardStatus, { color: isOnline(d.last_seen_at) ? '#4CAF50' : d.activated ? '#8BC34A' : d.blocked_reason ? Colors.error : '#FF9800' }]}>
                                {isOnline(d.last_seen_at) ? 'ONLINE' : d.activated ? 'ATIVO' : d.blocked_reason === 'manual' ? 'BLOQUEADO' : d.blocked_reason === 'expired' ? 'EXPIRADO' : 'PENDENTE'}
                              </Text>
                              {d.plans ? <Text style={styles.deviceCardPlan} numberOfLines={1}>{d.plans.name}</Text> : null}
                            </View>
                            {!selectMode && <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />}
                          </View>
                          <View style={styles.deviceCardMeta}>
                            <Text style={styles.deviceCardMetaText}>{d.platform || 'N/A'} • {d.device_name || '—'}</Text>
                            <Text style={styles.deviceCardMetaText}>Visto: {formatLastSeen(d.last_seen_at)}</Text>
                          </View>
                          {devicesRepFilter === '__all__' && d.representatives ? <View style={styles.currentContentBar}><Ionicons name="headset-outline" size={11} color="#FFD700" /><Text style={[styles.currentContentText, { color: '#FFD700' }]} numberOfLines={1}> Rep #{d.representatives.rep_number} {d.representatives.name}</Text></View> : null}
                          {d.current_content ? <View style={styles.currentContentBar}><Ionicons name="play-circle-outline" size={11} color="#9C27B0" /><Text style={styles.currentContentText} numberOfLines={1}> {d.current_content}</Text></View> : null}
                          {d.expires_at ? (
                            <View style={[styles.expiryBar, new Date(d.expires_at) < new Date() ? { backgroundColor: 'rgba(229,0,0,0.08)' } : { backgroundColor: 'rgba(76,175,80,0.08)' }]}>
                              <Ionicons name="calendar-outline" size={11} color={new Date(d.expires_at) < new Date() ? Colors.error : '#4CAF50'} />
                              <Text style={[styles.expiryBarText, { color: new Date(d.expires_at) < new Date() ? Colors.error : '#4CAF50' }]}>Expira: {new Date(d.expires_at).toLocaleDateString('pt-BR')}</Text>
                              {d.price ? <Text style={[styles.expiryBarText, { color: Colors.primary, marginLeft: 8 }]}>R$ {d.price.toFixed(2)}</Text> : null}
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </View>
          );
        })()}

        {/* ── PLANS ── */}
        {activeTab === 'plans' && (
          <View style={styles.section}>
            <Pressable style={styles.createBtn} onPress={openCreatePlan}><Ionicons name="add-circle-outline" size={18} color="#fff" /><Text style={styles.createBtnText}>  Criar novo plano</Text></Pressable>
            {plans.length === 0 ? <View style={styles.emptyState}><Ionicons name="layers-outline" size={40} color={Colors.textMuted} /><Text style={styles.emptyText}>Nenhum plano criado</Text></View>
              : plans.map(plan => (
                <View key={plan.id} style={styles.planCard}>
                  <View style={styles.planCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planName}>{plan.name}</Text>
                      <Text style={styles.planServer} numberOfLines={1}>{plan.server_url}</Text>
                    </View>
                    <View style={styles.planMacBadge}><Ionicons name="phone-portrait" size={11} color={Colors.primary} /><Text style={styles.planMacText}> {plan.active_macs || 0}/{plan.max_macs}</Text></View>
                  </View>
                  <View style={styles.planCardBody}>
                    <View style={styles.planCredRow}><Ionicons name="person-outline" size={13} color={Colors.textMuted} /><Text style={styles.planCred}> {plan.xtream_username}</Text></View>
                    <View style={styles.planCredRow}><Ionicons name="lock-closed-outline" size={13} color={Colors.textMuted} /><Text style={styles.planCred}> {'•'.repeat(Math.min(plan.xtream_password.length, 10))}</Text></View>
                  </View>
                  <View style={styles.planCardActions}>
                    <Pressable style={styles.planActionBtn} onPress={() => openEditPlan(plan)}><Ionicons name="create-outline" size={16} color={Colors.primary} /><Text style={[styles.planActionText, { color: Colors.primary }]}>Editar</Text></Pressable>
                    <Pressable style={[styles.planActionBtn, { borderColor: 'rgba(244,67,54,0.3)' }]} onPress={() => handleDeletePlan(plan)}><Ionicons name="trash-outline" size={16} color={Colors.error} /><Text style={[styles.planActionText, { color: Colors.error }]}>Excluir</Text></Pressable>
                  </View>
                </View>
              ))}
          </View>
        )}

        {/* ── REPRESENTATIVES ── */}
        {activeTab === 'reps' && (
          <View style={styles.section}>
            <Pressable style={styles.createBtn} onPress={() => { setEditingRep(null); setRepForm({ name: '', rep_number: '', password: '', credits: '0', notes: '' }); setRepModal(true); }}>
              <Ionicons name="person-add-outline" size={18} color="#fff" /><Text style={styles.createBtnText}>  Novo Representante</Text>
            </Pressable>
            {reps.length === 0 ? (
              <View style={styles.emptyState}><Ionicons name="people-outline" size={40} color={Colors.textMuted} /><Text style={styles.emptyText}>Nenhum representante cadastrado</Text></View>
            ) : reps.map(r => (
              <View key={r.id} style={styles.planCard}>
                <View style={styles.planCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>#{r.rep_number} — {r.name}</Text>
                    <Text style={styles.planServer}>{r.active ? 'Ativo' : 'Inativo'} • {r.active_devices ?? 0} MACs ativos • {r.total_consumed ?? 0} créditos usados</Text>
                  </View>
                  <View style={[styles.planMacBadge, { backgroundColor: 'rgba(255,215,0,0.1)', borderColor: 'rgba(255,215,0,0.3)' }]}>
                    <Ionicons name="wallet-outline" size={11} color="#FFD700" />
                    <Text style={[styles.planMacText, { color: '#FFD700' }]}> {r.credits}</Text>
                  </View>
                </View>
                <View style={styles.planCardActions}>
                  <Pressable style={styles.planActionBtn} onPress={() => { setEditingRep(r); setRepForm({ name: r.name, rep_number: r.rep_number, password: '', credits: String(r.credits), notes: r.notes || '' }); setRepModal(true); }}>
                    <Ionicons name="create-outline" size={16} color={Colors.primary} /><Text style={[styles.planActionText, { color: Colors.primary }]}>Editar</Text>
                  </Pressable>
                  <Pressable style={[styles.planActionBtn, { borderColor: 'rgba(255,215,0,0.3)' }]} onPress={() => { setCreditsRep(r); setCreditsInput(''); setCreditsDescription(''); setCreditsMode('add'); setCreditsModal(true); }}>
                    <Ionicons name="wallet-outline" size={16} color="#FFD700" /><Text style={[styles.planActionText, { color: '#FFD700' }]}>Créditos</Text>
                  </Pressable>
                  <Pressable style={[styles.planActionBtn, { borderColor: 'rgba(244,67,54,0.3)' }]} onPress={() => Alert.alert('Excluir', `Excluir ${r.name}?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: async () => { try { await deleteRepresentative(r.id); await loadAll(true); } catch (e: any) { Alert.alert('Erro', e.message); } } }])}>
                    <Ionicons name="trash-outline" size={16} color={Colors.error} /><Text style={[styles.planActionText, { color: Colors.error }]}>Excluir</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── SOURCES (FONTES) — grouped by rep ── */}
        {activeTab === 'sources' && (() => {
          // Build grouped map: repKey -> { label, color, sources[] }
          const groupMap: Record<string, { label: string; repId: string | null; color: string; sources: Source[] }> = {};
          for (const s of sources) {
            const key = s.rep_id ?? '__none__';
            if (!groupMap[key]) {
              const rep = reps.find(r => r.id === s.rep_id);
              groupMap[key] = {
                label: rep ? `#${rep.rep_number} — ${rep.name}` : 'Sem Representante',
                repId: s.rep_id,
                color: rep ? '#FFD700' : Colors.textMuted,
                sources: [],
              };
            }
            groupMap[key].sources.push(s);
          }
          // Sort: reps first, then unassigned
          const groups = Object.entries(groupMap).sort(([a], [b]) => {
            if (a === '__none__') return 1;
            if (b === '__none__') return -1;
            return 0;
          });

          return (
            <View style={styles.section}>
              <Pressable style={styles.createBtn} onPress={() => { setEditingSource(null); setSourceForm({ name: '', server_url: 'https://odira.sbs', xtream_username: '', xtream_password: '', max_connections: '5', rep_id: '', notes: '' }); setSourceModal(true); }}>
                <Ionicons name="add-circle-outline" size={18} color="#fff" /><Text style={styles.createBtnText}>  Nova Fonte</Text>
              </Pressable>
              {sources.length === 0 ? (
                <View style={styles.emptyState}><Ionicons name="server-outline" size={40} color={Colors.textMuted} /><Text style={styles.emptyText}>Nenhuma fonte criada</Text></View>
              ) : groups.map(([key, group]) => {
                const isExpanded = expandedSourceReps.has(key);
                const totalMacs = group.sources.reduce((s, src) => s + (src.active_macs ?? 0), 0);
                const totalMax = group.sources.reduce((s, src) => s + src.max_connections, 0);
                return (
                  <View key={key} style={{ marginBottom: 12 }}>
                    {/* Group header — tap to expand/collapse */}
                    <Pressable
                      style={styles.sourceGroupHeader}
                      onPress={() => setExpandedSourceReps(prev => {
                        const next = new Set(prev);
                        next.has(key) ? next.delete(key) : next.add(key);
                        return next;
                      })}
                    >
                      <View style={[styles.repGroupIcon, { backgroundColor: group.repId ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.05)', width: 34, height: 34, borderRadius: 10 }]}>
                        <Ionicons name={group.repId ? 'headset-outline' : 'server-outline'} size={16} color={group.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: group.color, fontSize: 13, fontWeight: '700' }}>{group.label}</Text>
                        <Text style={{ color: Colors.textMuted, fontSize: 10 }}>{group.sources.length} fonte(s) • {totalMacs}/{totalMax} MACs</Text>
                      </View>
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
                    </Pressable>

                    {/* Source cards — shown when expanded */}
                    {isExpanded && group.sources.map(s => (
                      <View key={s.id} style={[styles.planCard, { marginBottom: 8, marginTop: 4, borderColor: group.repId ? 'rgba(255,215,0,0.12)' : 'rgba(255,255,255,0.07)' }]}>
                        <View style={styles.planCardHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.planName}>{s.name}</Text>
                            <Text style={styles.planServer} numberOfLines={1}>{s.server_url}</Text>
                          </View>
                          <View style={styles.planMacBadge}><Ionicons name="people-outline" size={11} color={Colors.primary} /><Text style={styles.planMacText}> {s.active_macs ?? 0}/{s.max_connections}</Text></View>
                        </View>
                        <View style={styles.planCardBody}>
                          <View style={styles.planCredRow}><Ionicons name="person-outline" size={13} color={Colors.textMuted} /><Text style={styles.planCred}> {s.xtream_username}</Text></View>
                          <View style={styles.planCredRow}><Ionicons name={s.active ? 'radio-button-on' : 'radio-button-off'} size={13} color={s.active ? '#4CAF50' : Colors.textMuted} /><Text style={[styles.planCred, { color: s.active ? '#4CAF50' : Colors.textMuted }]}> {s.active ? 'Ativa' : 'Inativa'}</Text></View>
                        </View>
                        <View style={styles.planCardActions}>
                          <Pressable style={styles.planActionBtn} onPress={() => { setEditingSource(s); setSourceForm({ name: s.name, server_url: s.server_url, xtream_username: s.xtream_username, xtream_password: s.xtream_password, max_connections: String(s.max_connections), rep_id: s.rep_id || '', notes: s.notes || '' }); setSourceModal(true); }}>
                            <Ionicons name="create-outline" size={16} color={Colors.primary} /><Text style={[styles.planActionText, { color: Colors.primary }]}>Editar</Text>
                          </Pressable>
                          <Pressable style={[styles.planActionBtn, { borderColor: 'rgba(244,67,54,0.3)' }]} onPress={() => Alert.alert('Excluir Fonte', `Excluir "${s.name}"?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: async () => { try { await deleteSource(s.id); await loadAll(true); } catch (e: any) { Alert.alert('Erro', e.message); } } }])}>
                            <Ionicons name="trash-outline" size={16} color={Colors.error} /><Text style={[styles.planActionText, { color: Colors.error }]}>Excluir</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* ── NOTIFICATIONS ── */}
        {activeTab === 'notifications' && (
          <View style={styles.section}>
            <Pressable style={styles.createBtn} onPress={() => setNotifModal(true)}><Ionicons name="notifications-outline" size={18} color="#fff" /><Text style={styles.createBtnText}>  Enviar novo aviso</Text></Pressable>
            {notifications.length === 0 ? <View style={styles.emptyState}><Ionicons name="notifications-off-outline" size={40} color={Colors.textMuted} /><Text style={styles.emptyText}>Nenhum aviso enviado</Text></View>
              : notifications.map(n => (
                <View key={n.id} style={styles.notifCard}>
                  <View style={styles.notifHeader}>
                    <View style={{ flex: 1 }}><Text style={styles.notifTitle}>{n.title}</Text><Text style={styles.notifTarget}>{n.target_email ? `Para: ${n.target_email}` : 'Para: Todos'}</Text></View>
                    <Pressable onPress={() => handleDeleteNotification(n.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color={Colors.error} /></Pressable>
                  </View>
                  <Text style={styles.notifMessage}>{n.message}</Text>
                  <Text style={styles.notifDate}>{new Date(n.created_at).toLocaleString('pt-BR')}</Text>
                </View>
              ))}
          </View>
        )}

        {/* ── WATCHING NOW ── */}
        {activeTab === 'watching' && (
          <View style={styles.section}>
            <View style={styles.watchingHeader}>
              <Ionicons name="eye-outline" size={18} color="#9C27B0" />
              <Text style={styles.watchingTitle}>Assistindo Agora</Text>
              <View style={styles.watchingLiveDot} />
              <Text style={styles.watchingLiveText}>Tempo real (atualiza 15s)</Text>
              <Pressable onPress={loadWatching} hitSlop={8} style={{ marginLeft: 'auto' }}><Ionicons name="refresh" size={18} color={Colors.primary} /></Pressable>
            </View>
            {watchingNow.length === 0 ? (
              <View style={styles.emptyState}><Ionicons name="tv-outline" size={40} color={Colors.textMuted} /><Text style={styles.emptyText}>Nenhum usuário assistindo agora</Text><Text style={styles.emptySubText}>O app reporta conteúdo durante a reprodução</Text></View>
            ) : watchingNow.map(w => (
              <View key={w.id} style={styles.watchingCard}>
                <View style={styles.watchingCardIcon}><Ionicons name={w.current_content_type === 'live' ? 'tv' : w.current_content_type === 'movie' ? 'film' : 'videocam'} size={22} color="#9C27B0" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.watchingContent} numberOfLines={1}>{w.current_content}</Text>
                  <Text style={styles.watchingEmail} numberOfLines={1}>{w.email}</Text>
                  <View style={styles.watchingMeta}>
                    <Text style={styles.watchingMetaText}>{w.device_name || w.platform || 'Dispositivo'}</Text>
                    <Text style={styles.watchingMetaText}>•</Text>
                    <Text style={styles.watchingMetaText}>{w.current_content_type === 'live' ? 'Ao Vivo' : w.current_content_type === 'movie' ? 'Filme' : 'Série'}</Text>
                    <Text style={styles.watchingMetaText}>•</Text>
                    <Text style={styles.watchingMetaText}>{formatLastSeen(w.current_content_at)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── FINANCIAL ── */}
        {activeTab === 'financial' && (() => {
          // Admin-direct only: devices without rep_id
          const adminActive = devices.filter(d => !d.rep_id && d.activated && !d.blocked_reason);
          const adminPriced = adminActive.filter(d => d.price != null && d.price > 0);
          const adminNoPrice = adminActive.filter(d => !d.price || d.price <= 0);
          const adminMonthly = adminPriced.reduce((s, d) => s + (d.price ?? 0), 0);
          const adminAnnual = adminMonthly * 12;

          // Rep breakdown (separate, collapsible)
          const repGroups: Record<string, { repName: string; repNumber: string; priced: Device[]; total: number }> = {};
          for (const d of devices.filter(d => d.rep_id && d.activated && !d.blocked_reason && d.price != null && d.price > 0)) {
            const key = d.representatives ? d.representatives.rep_number : d.rep_id!;
            if (!repGroups[key]) repGroups[key] = {
              repName: d.representatives?.name ?? '—',
              repNumber: d.representatives?.rep_number ?? '—',
              priced: [], total: 0,
            };
            repGroups[key].priced.push(d);
            repGroups[key].total += d.price ?? 0;
          }
          const repKeys = Object.keys(repGroups);

          return (
            <View style={styles.section}>
              {/* Admin-direct summary */}
              <Text style={styles.sectionTitle}>Meu Financeiro (Admin Direto)</Text>
              <View style={[styles.creditsInfoCard, { marginBottom: 14, backgroundColor: 'rgba(229,0,0,0.06)', borderColor: 'rgba(229,0,0,0.2)' }]}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.primary} />
                <Text style={[styles.planCred, { marginLeft: 8, fontSize: 11, flex: 1 }]}>
                  Exibe apenas dispositivos ativados diretamente pelo admin (sem representante).
                </Text>
              </View>
              <View style={styles.statsGrid}>
                <StatCard icon="cash" label="Mensal" value={`R$ ${adminMonthly.toFixed(2)}`} color="#4CAF50" />
                <StatCard icon="trending-up" label="Anual" value={`R$ ${adminAnnual.toFixed(2)}`} color="#2196F3" />
                <StatCard icon="checkmark-circle" label="Com Valor" value={String(adminPriced.length)} color="#8BC34A" />
                <StatCard icon="alert-circle" label="Sem Valor" value={String(adminNoPrice.length)} color="#FF9800" />
              </View>

              {/* Admin priced devices */}
              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>MACs com Valor ({adminPriced.length})</Text>
              {adminPriced.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="cash-outline" size={36} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>Nenhum MAC com valor definido</Text>
                  <Text style={[styles.emptyText, { fontSize: 11, marginTop: 4 }]}>Defina o valor mensal ao ativar um dispositivo</Text>
                </View>
              ) : adminPriced.map(d => (
                <Pressable key={d.id} style={styles.deviceCard} onPress={() => openDeviceModal(d)}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.deviceCardHeader}>
                      <View style={{ flex: 1 }}>
                        {d.client_name ? <Text style={[styles.deviceCardEmail, { fontWeight: '800' }]} numberOfLines={1}>{d.client_name}</Text> : null}
                        <Text style={d.client_name ? [styles.deviceCardMac, { color: 'rgba(255,255,255,0.6)', fontSize: 11 }] : styles.deviceCardEmail} numberOfLines={1}>{d.email}</Text>
                        <Text style={styles.deviceCardMac}>{d.mac_address}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={{ color: '#4CAF50', fontSize: 15, fontWeight: '800' }}>R$ {(d.price ?? 0).toFixed(2)}</Text>
                        <Text style={{ color: Colors.textMuted, fontSize: 9 }}>/mês</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} style={{ marginLeft: 4 }} />
                    </View>
                    {d.expires_at ? <View style={styles.expiryBar}><Ionicons name="calendar-outline" size={11} color={new Date(d.expires_at) < new Date() ? Colors.error : '#4CAF50'} /><Text style={[styles.expiryBarText, { color: new Date(d.expires_at) < new Date() ? Colors.error : '#4CAF50' }]}>Vence: {new Date(d.expires_at).toLocaleDateString('pt-BR')}</Text></View> : null}
                  </View>
                </Pressable>
              ))}

              {/* Admin no-price devices */}
              {adminNoPrice.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Sem Valor Definido ({adminNoPrice.length})</Text>
                  {adminNoPrice.map(d => (
                    <Pressable key={d.id} style={[styles.deviceCard, { borderColor: 'rgba(255,152,0,0.2)' }]} onPress={() => openDeviceModal(d)}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.deviceCardHeader}>
                          <View style={{ flex: 1 }}>
                            {d.client_name ? <Text style={[styles.deviceCardEmail, { fontWeight: '700' }]} numberOfLines={1}>{d.client_name}</Text> : null}
                            <Text style={styles.deviceCardEmail} numberOfLines={1}>{d.email}</Text>
                            <Text style={styles.deviceCardMac}>{d.mac_address}</Text>
                          </View>
                          <View style={[styles.planMacBadge, { backgroundColor: 'rgba(255,152,0,0.1)', borderColor: 'rgba(255,152,0,0.3)' }]}>
                            <Text style={[styles.planMacText, { color: '#FF9800' }]}>Sem valor</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} style={{ marginLeft: 4 }} />
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </>
              )}

              {/* Reps breakdown — collapsible, optional */}
              {repKeys.length > 0 && (
                <>
                  <Pressable
                    style={[styles.sourceGroupHeader, { marginTop: 24, marginBottom: 4 }]}
                    onPress={() => setExpandedSourceReps(prev => {
                      const next = new Set(prev);
                      next.has('__rep_financial__') ? next.delete('__rep_financial__') : next.add('__rep_financial__');
                      return next;
                    })}
                  >
                    <View style={[styles.repGroupIcon, { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,215,0,0.08)' }]}>
                      <Ionicons name="people-outline" size={16} color="#FFD700" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFD700', fontSize: 13, fontWeight: '700' }}>Receita dos Representantes</Text>
                      <Text style={{ color: Colors.textMuted, fontSize: 10 }}>
                        {repKeys.length} representante(s) • R$ {Object.values(repGroups).reduce((s, g) => s + g.total, 0).toFixed(2)}/mês
                      </Text>
                    </View>
                    <Ionicons name={expandedSourceReps.has('__rep_financial__') ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
                  </Pressable>

                  {expandedSourceReps.has('__rep_financial__') && Object.entries(repGroups).sort((a, b) => b[1].total - a[1].total).map(([key, group]) => (
                    <View key={key} style={[styles.planCard, { marginBottom: 8, borderColor: 'rgba(255,215,0,0.12)' }]}>
                      <View style={styles.planCardHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.planName}>#{group.repNumber} — {group.repName}</Text>
                          <Text style={styles.planServer}>{group.priced.length} MAC(s) com valor</Text>
                        </View>
                        <View style={[styles.planMacBadge, { backgroundColor: 'rgba(255,215,0,0.1)', borderColor: 'rgba(255,215,0,0.3)' }]}>
                          <Ionicons name="cash-outline" size={11} color="#FFD700" />
                          <Text style={[styles.planMacText, { color: '#FFD700' }]}> R$ {group.total.toFixed(2)}/mês</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
          );
        })()}

        {/* ── SUB-ADMINS ── */}
        {activeTab === 'subadmins' && !isSubAdmin && (
          <View style={styles.section}>
            <Pressable style={styles.createBtn} onPress={() => { setEditingSubAdmin(null); setSubAdminForm({ username: '', password: '', name: '', notes: '' }); setSubAdminModal(true); }}>
              <Ionicons name="person-add-outline" size={18} color="#fff" /><Text style={styles.createBtnText}>  Novo Sub-Admin</Text>
            </Pressable>
            <View style={[styles.creditsInfoCard, { marginBottom: 14, backgroundColor: 'rgba(21,101,192,0.06)', borderColor: 'rgba(21,101,192,0.2)' }]}>
              <Ionicons name="information-circle-outline" size={14} color="#42A5F5" />
              <Text style={[styles.planCred, { marginLeft: 8, fontSize: 11, flex: 1, color: '#90CAF9' }]}>
                Sub-admins têm acesso isolado — eles só veem seus próprios representantes, fontes e dispositivos. Você continua sendo o dono da plataforma.
              </Text>
            </View>
            {subAdmins.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="shield-half-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>Nenhum sub-admin criado</Text>
              </View>
            ) : subAdmins.map(sa => (
              <View key={sa.id} style={[styles.planCard, { borderColor: 'rgba(21,101,192,0.2)' }]}>
                <View style={styles.planCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{sa.name}</Text>
                    <Text style={styles.planServer}>@{sa.username} • {sa.active ? 'Ativo' : 'Inativo'}</Text>
                  </View>
                  <View style={[styles.planMacBadge, { backgroundColor: sa.active ? 'rgba(21,101,192,0.12)' : 'rgba(255,255,255,0.04)', borderColor: sa.active ? 'rgba(21,101,192,0.4)' : 'rgba(255,255,255,0.1)' }]}>
                    <Ionicons name={sa.active ? 'checkmark-circle' : 'close-circle'} size={13} color={sa.active ? '#42A5F5' : Colors.textMuted} />
                    <Text style={[styles.planMacText, { color: sa.active ? '#42A5F5' : Colors.textMuted }]}> {sa.active ? 'Ativo' : 'Inativo'}</Text>
                  </View>
                </View>
                {sa.notes ? <Text style={[styles.planCred, { marginBottom: 10 }]}>{sa.notes}</Text> : null}
                <View style={styles.planCardActions}>
                  <Pressable style={styles.planActionBtn} onPress={() => { setEditingSubAdmin(sa); setSubAdminForm({ username: sa.username, password: '', name: sa.name, notes: sa.notes || '' }); setSubAdminModal(true); }}>
                    <Ionicons name="create-outline" size={16} color={Colors.primary} /><Text style={[styles.planActionText, { color: Colors.primary }]}>Editar</Text>
                  </Pressable>
                  <Pressable style={[styles.planActionBtn, { borderColor: sa.active ? 'rgba(255,152,0,0.3)' : 'rgba(76,175,80,0.3)' }]} onPress={async () => { try { await updateSubAdmin(sa.id, { active: !sa.active }); await loadAll(true); } catch (e: any) { Alert.alert('Erro', e.message); } }}>
                    <Ionicons name={sa.active ? 'pause-circle-outline' : 'play-circle-outline'} size={16} color={sa.active ? '#FF9800' : '#4CAF50'} /><Text style={[styles.planActionText, { color: sa.active ? '#FF9800' : '#4CAF50' }]}>{sa.active ? 'Suspender' : 'Ativar'}</Text>
                  </Pressable>
                  <Pressable style={[styles.planActionBtn, { borderColor: 'rgba(244,67,54,0.3)' }]} onPress={() => Alert.alert('Excluir Sub-Admin', `Excluir ${sa.name}?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: async () => { try { await deleteSubAdmin(sa.id); await loadAll(true); } catch (e: any) { Alert.alert('Erro', e.message); } } }])}>
                    <Ionicons name="trash-outline" size={16} color={Colors.error} /><Text style={[styles.planActionText, { color: Colors.error }]}>Excluir</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── PRE-AUTHORIZE ── */}
        {activeTab === 'add' && (
          <View style={styles.section}>
            <View style={styles.preAuthCard}>
              <Ionicons name="person-add-outline" size={32} color={Colors.primary} style={{ marginBottom: 12 }} />
              <Text style={styles.preAuthTitle}>Pré-ativar Acesso</Text>
              <Text style={styles.preAuthSubtitle}>Ative um e-mail com MAC e plano antes do cliente abrir o app</Text>
              <Text style={styles.fieldLabel}>E-mail do cliente *</Text>
              <View style={styles.inputWrap}><Ionicons name="mail-outline" size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder="cliente@email.com" placeholderTextColor={Colors.textMuted} value={preAuthEmail} onChangeText={setPreAuthEmail} keyboardType="email-address" autoCapitalize="none" /></View>
              <Text style={styles.fieldLabel}>MAC do dispositivo *</Text>
              <View style={styles.inputWrap}><Ionicons name="hardware-chip-outline" size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder="XX:XX:XX:XX:XX:XX" placeholderTextColor={Colors.textMuted} value={preAuthMac} onChangeText={setPreAuthMac} autoCapitalize="characters" /></View>
              <Text style={styles.fieldLabel}>Plano *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {plans.map(p => <Pressable key={p.id} style={[styles.planChip, preAuthPlanId === p.id && styles.planChipActive]} onPress={() => setPreAuthPlanId(p.id)}><Text style={[styles.planChipText, preAuthPlanId === p.id && styles.planChipTextActive]}>{p.name}</Text></Pressable>)}
                </View>
              </ScrollView>
              <Pressable style={[styles.loginBtn, preAuthLoading && { opacity: 0.6 }]} onPress={handlePreAuthorize} disabled={preAuthLoading}>
                {preAuthLoading ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark-circle-outline" size={18} color="#fff" /><Text style={styles.loginBtnText}>  Ativar Acesso</Text></>}
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── DEVICE DETAIL MODAL ── */}
      <Modal visible={deviceModal} transparent animationType="slide" onRequestClose={() => !deviceActionLoading && setDeviceModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
                {selectedDevice && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={[styles.modalTitle, { flex: 1, marginBottom: 0 }]}>Detalhes</Text>
                      {isOnline(selectedDevice.last_seen_at) && <View style={styles.onlinePill}><View style={styles.onlinePillDot} /><Text style={styles.onlinePillText}>ONLINE</Text></View>}
                    </View>
                    {selectedDevice.client_name ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(229,0,0,0.06)', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(229,0,0,0.15)', gap: 8 }}>
                        <Ionicons name="person-circle-outline" size={16} color={Colors.primary} />
                        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 }}>{selectedDevice.client_name}</Text>
                      </View>
                    ) : null}
                    {selectedDevice.representatives ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.06)', borderRadius: 8, padding: 8, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)', gap: 8 }}>
                        <Ionicons name="headset-outline" size={14} color="#FFD700" />
                        <Text style={{ color: '#FFD700', fontSize: 12, fontWeight: '600' }}>Rep #{selectedDevice.representatives.rep_number} - {selectedDevice.representatives.name}</Text>
                      </View>
                    ) : null}
                    {[
                      { icon: 'mail-outline', label: 'E-mail', value: selectedDevice.email },
                      { icon: 'hardware-chip-outline', label: 'MAC', value: selectedDevice.mac_address, mono: true },
                      { icon: 'phone-portrait-outline', label: 'Dispositivo', value: `${selectedDevice.device_name || '—'} (${selectedDevice.platform || 'N/A'})` },
                      { icon: 'time-outline', label: 'Último acesso', value: formatLastSeen(selectedDevice.last_seen_at) },
                      { icon: 'calendar-outline', label: 'Registrado', value: new Date(selectedDevice.created_at).toLocaleDateString('pt-BR') },
                    ].map(row => (
                      <View key={row.label} style={styles.deviceDetailRow}>
                        <Ionicons name={row.icon as any} size={14} color={Colors.textMuted} />
                        <Text style={styles.deviceDetailLabel}>{row.label}</Text>
                        <Text style={[styles.deviceDetailValue, (row as any).mono && { fontFamily: 'monospace', fontSize: 10 }]} numberOfLines={1}>{row.value}</Text>
                      </View>
                    ))}
                    {selectedDevice.current_content ? <View style={styles.currentContentDetail}><Ionicons name="play-circle-outline" size={14} color="#9C27B0" /><Text style={styles.currentContentDetailText} numberOfLines={2}>Assistindo: {selectedDevice.current_content}</Text></View> : null}
                    <View style={[styles.deviceDetailRow, { marginBottom: 8 }]}>
                      <View style={[styles.statusDot, { backgroundColor: selectedDevice.activated ? '#4CAF50' : selectedDevice.blocked_reason ? Colors.error : '#FF9800' }]} />
                      <Text style={styles.deviceDetailLabel}>Status</Text>
                      <Text style={[styles.deviceDetailValue, { color: selectedDevice.activated ? '#4CAF50' : selectedDevice.blocked_reason ? Colors.error : '#FF9800', fontWeight: '700' }]}>
                        {selectedDevice.activated ? 'ATIVO' : selectedDevice.blocked_reason === 'manual' ? 'BLOQUEADO' : selectedDevice.blocked_reason === 'expired' ? 'EXPIRADO' : 'PENDENTE'}
                      </Text>
                    </View>
                    {selectedDevice.blocked_reason === 'manual' && selectedDevice.block_reason_detail ? <View style={styles.blockReasonBadge}><Ionicons name="ban" size={13} color={Colors.error} /><Text style={styles.blockReasonText}>Motivo: {selectedDevice.block_reason_detail}</Text></View> : null}
                    {selectedDevice.grace_period_used && <View style={styles.graceBadge}><Ionicons name="information-circle-outline" size={14} color="#FF9800" /><Text style={styles.graceBadgeText}>Período de confiança já utilizado</Text></View>}
                    <Text style={styles.fieldLabel}>Data de expiração (DD/MM/AAAA)</Text>
                    <View style={[styles.inputWrap, { marginBottom: 8 }]}>
                      <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                      <TextInput style={styles.input} placeholder="Ex: 31/12/2025 (vazio = sem prazo)" placeholderTextColor={Colors.textMuted} value={deviceExpiryInput} onChangeText={v => setDeviceExpiryInput(formatDateInput(v))} keyboardType="number-pad" maxLength={10} />
                      {deviceExpiryInput ? <Pressable onPress={() => setDeviceExpiryInput('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={Colors.textMuted} /></Pressable> : null}
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {[{ label: '30d', days: 30 }, { label: '60d', days: 60 }, { label: '90d', days: 90 }, { label: '1 ano', days: 365 }, { label: 'Sem prazo', days: 0 }].map(({ label, days }) => (
                          <Pressable key={label} style={styles.expiryPreset} onPress={() => { if (days === 0) { setDeviceExpiryInput(''); return; } const d = new Date(); d.setDate(d.getDate() + days); setDeviceExpiryInput(isoToDisplay(d.toISOString())); }}>
                            <Text style={styles.expiryPresetText}>{label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                    <Text style={styles.fieldLabel}>Valor da assinatura (R$)</Text>
                    <View style={[styles.inputWrap, { marginBottom: 16 }]}><Ionicons name="cash-outline" size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder="Ex: 29.90" placeholderTextColor={Colors.textMuted} value={devicePriceInput} onChangeText={setDevicePriceInput} keyboardType="decimal-pad" /></View>
                    <Text style={styles.fieldLabel}>Plano de acesso</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {plans.map(p => <Pressable key={p.id} style={[styles.planChip, selectedPlanId === p.id && styles.planChipActive]} onPress={() => setSelectedPlanId(p.id)}><Text style={[styles.planChipText, selectedPlanId === p.id && styles.planChipTextActive]}>{p.name}</Text></Pressable>)}
                      </View>
                    </ScrollView>
                    <Text style={styles.fieldLabel}>Observações</Text>
                    <View style={[styles.inputWrap, { minHeight: 52, paddingVertical: 10, alignItems: 'flex-start', marginBottom: 16 }]}><TextInput style={[styles.input, { height: 55 }]} placeholder="Observações..." placeholderTextColor={Colors.textMuted} value={deviceNotesInput} onChangeText={setDeviceNotesInput} multiline /></View>
                    <Pressable style={[styles.saveBtn, deviceActionLoading && { opacity: 0.6 }]} onPress={handleSaveDevice} disabled={deviceActionLoading}>
                      {deviceActionLoading ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark-circle-outline" size={18} color="#fff" /><Text style={styles.saveBtnText}>  Salvar e Ativar</Text></>}
                    </Pressable>
                    <View style={styles.modalActions}>
                      <Pressable style={[styles.modalActionBtn, { backgroundColor: Colors.error }]} onPress={() => { setBlockReasonInput(''); pendingBlockRef.current = true; setDeviceModal(false); }} disabled={deviceActionLoading}><Ionicons name="ban-outline" size={16} color="#fff" /><Text style={styles.modalActionText}> Bloquear</Text></Pressable>
                      <Pressable style={[styles.modalActionBtn, { backgroundColor: '#FF9800' }]} onPress={handleDeactivateDevice} disabled={deviceActionLoading}><Ionicons name="pause-circle-outline" size={16} color="#fff" /><Text style={styles.modalActionText}> Desativar</Text></Pressable>
                      <Pressable style={[styles.modalActionBtn, { backgroundColor: 'rgba(244,67,54,0.15)', borderWidth: 1, borderColor: 'rgba(244,67,54,0.4)' }]} onPress={handleDeleteDevice} disabled={deviceActionLoading}><Ionicons name="trash-outline" size={16} color={Colors.error} /><Text style={[styles.modalActionText, { color: Colors.error }]}> Excluir</Text></Pressable>
                    </View>
                    {!selectedDevice.grace_period_used && <Pressable style={styles.graceActionBtn} onPress={handleGrantGrace} disabled={deviceActionLoading}><Ionicons name="time-outline" size={16} color="#FF9800" /><Text style={styles.graceActionText}> Conceder 3 dias de confiança</Text></Pressable>}
                    <Pressable style={styles.modalClose} onPress={() => !deviceActionLoading && setDeviceModal(false)}><Text style={styles.modalCloseText}>Fechar</Text></Pressable>
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── BLOCK REASON MODAL ── */}
      <Modal visible={blockReasonModal} transparent animationType="fade" onRequestClose={() => setBlockReasonModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={[styles.modalBackdrop, { justifyContent: 'center' }]}>
            <View style={[styles.modalSheet, { borderRadius: 16, height: undefined, maxHeight: '80%', paddingBottom: 20 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Bloquear Dispositivo</Text>
              <Text style={styles.blockReasonHint}>Informe o motivo (será exibido para o cliente):</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {['Falta de pagamento', 'Pagamento em atraso', 'Uso indevido', 'Conta suspensa'].map(reason => (
                    <Pressable key={reason} style={[styles.reasonChip, blockReasonInput === reason && styles.reasonChipActive]} onPress={() => setBlockReasonInput(reason)}>
                      <Text style={[styles.reasonChipText, blockReasonInput === reason && styles.reasonChipTextActive]}>{reason}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.inputWrap}><Ionicons name="create-outline" size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder="Ou escreva o motivo..." placeholderTextColor={Colors.textMuted} value={blockReasonInput} onChangeText={setBlockReasonInput} /></View>
              <View style={[styles.modalActions, { marginTop: 12 }]}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setBlockReasonModal(false)}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                <Pressable style={[styles.modalActionBtn, { flex: 1, backgroundColor: Colors.error }]} onPress={handleConfirmBlock}><Ionicons name="ban-outline" size={16} color="#fff" /><Text style={styles.modalActionText}> Confirmar</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── PLAN MODAL ── */}
      <Modal visible={planModal} transparent animationType="slide" onRequestClose={() => setPlanModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingPlan ? 'Editar Plano' : 'Criar Plano'}</Text>
                {([
                  { field: 'name', label: 'Nome do plano *', placeholder: 'Ex: Plano Básico', icon: 'layers-outline', kb: 'default' },
                  { field: 'server_url', label: 'DNS / URL do Servidor *', placeholder: 'https://odira.sbs', icon: 'server-outline', kb: 'url' },
                  { field: 'xtream_username', label: 'Usuário Xtream *', placeholder: 'usuario123', icon: 'person-outline', kb: 'default' },
                  { field: 'xtream_password', label: 'Senha Xtream *', placeholder: '••••••••', icon: 'lock-closed-outline', kb: 'default', secure: true },
                  { field: 'max_macs', label: 'Máx. MACs (1–20)', placeholder: '5', icon: 'phone-portrait-outline', kb: 'number-pad' },
                  { field: 'notes', label: 'Observações', placeholder: 'Opcional...', icon: 'document-text-outline', kb: 'default' },
                ] as any[]).map(({ field, label, placeholder, icon, kb, secure }) => (
                  <View key={field}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <View style={styles.inputWrap}><Ionicons name={icon} size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder={placeholder} placeholderTextColor={Colors.textMuted} value={(planForm as any)[field]} onChangeText={v => setPlanForm(f => ({ ...f, [field]: v }))} keyboardType={kb} secureTextEntry={secure} autoCapitalize="none" returnKeyType="next" /></View>
                  </View>
                ))}
                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setPlanModal(false)}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                  <Pressable style={[styles.modalActionBtn, { flex: 1 }]} onPress={handleSavePlan} disabled={planFormLoading}>
                    {planFormLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalActionText}>{editingPlan ? 'Salvar' : 'Criar Plano'}</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── REPRESENTATIVE MODAL ── */}
      <Modal visible={repModal} transparent animationType="slide" onRequestClose={() => setRepModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingRep ? 'Editar Representante' : 'Novo Representante'}</Text>
                {([
                  { field: 'name', label: 'Nome completo *', placeholder: 'Ex: João Silva', icon: 'person-outline', kb: 'default' },
                  { field: 'rep_number', label: 'Número do representante *', placeholder: 'Ex: 01', icon: 'id-card-outline', kb: 'number-pad' },
                  { field: 'password', label: editingRep ? 'Nova senha (vazio = manter)' : 'Senha *', placeholder: '••••••••', icon: 'lock-closed-outline', kb: 'default', secure: true },
                  { field: 'credits', label: 'Créditos iniciais', placeholder: '0', icon: 'wallet-outline', kb: 'number-pad' },
                  { field: 'notes', label: 'Observações', placeholder: 'Opcional...', icon: 'document-text-outline', kb: 'default' },
                ] as any[]).map(({ field, label, placeholder, icon, kb, secure }) => (
                  <View key={field}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <View style={styles.inputWrap}><Ionicons name={icon} size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder={placeholder} placeholderTextColor={Colors.textMuted} value={(repForm as any)[field]} onChangeText={v => setRepForm(f => ({ ...f, [field]: v }))} keyboardType={kb} secureTextEntry={secure} autoCapitalize="none" returnKeyType="next" /></View>
                  </View>
                ))}
                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setRepModal(false)}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                  <Pressable style={[styles.modalActionBtn, { flex: 1 }]} onPress={async () => {
                    if (!repForm.name || !repForm.rep_number) { Alert.alert('Preencha nome e número'); return; }
                    if (!editingRep && !repForm.password) { Alert.alert('Senha obrigatória'); return; }
                    setRepFormLoading(true);
                    try {
                      if (editingRep) { await updateRepresentative(editingRep.id, { name: repForm.name, password: repForm.password || undefined, notes: repForm.notes }); }
                      else { await createRepresentative({ name: repForm.name, rep_number: repForm.rep_number, password: repForm.password, credits: parseInt(repForm.credits) || 0, notes: repForm.notes }); }
                      setRepModal(false); await loadAll(true);
                    } catch (e: any) { Alert.alert('Erro', e.message); }
                    setRepFormLoading(false);
                  }} disabled={repFormLoading}>
                    {repFormLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalActionText}>{editingRep ? 'Salvar' : 'Criar'}</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── CREDITS MODAL ── */}
      <Modal visible={creditsModal} transparent animationType="fade" onRequestClose={() => !creditsLoading && setCreditsModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={[styles.modalBackdrop, { justifyContent: 'center' }]}>
            <View style={[styles.modalSheet, { borderRadius: 16, height: undefined, maxHeight: '80%', paddingBottom: 20 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Gerenciar Créditos</Text>

              {/* Rep info */}
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.07)', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)', gap: 8 }}>
                <Ionicons name="person-circle-outline" size={18} color="#FFD700" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{creditsRep?.name}</Text>
                  <Text style={{ color: Colors.textMuted, fontSize: 11 }}>Rep #{creditsRep?.rep_number}</Text>
                </View>
                <View style={{ alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.12)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)' }}>
                  <Text style={{ color: '#FFD700', fontSize: 18, fontWeight: '800' }}>{creditsRep?.credits ?? 0}</Text>
                  <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '600' }}>CRÉDITOS</Text>
                </View>
              </View>

              {/* Mode toggle */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <Pressable
                  style={[styles.planActionBtn, { flex: 1, height: 44, borderColor: creditsMode === 'add' ? 'rgba(76,175,80,0.5)' : 'rgba(255,255,255,0.1)', backgroundColor: creditsMode === 'add' ? 'rgba(76,175,80,0.12)' : 'transparent' }]}
                  onPress={() => setCreditsMode('add')}
                >
                  <Ionicons name="add-circle-outline" size={16} color={creditsMode === 'add' ? '#4CAF50' : Colors.textMuted} />
                  <Text style={[styles.planActionText, { color: creditsMode === 'add' ? '#4CAF50' : Colors.textMuted }]}>Adicionar</Text>
                </Pressable>
                <Pressable
                  style={[styles.planActionBtn, { flex: 1, height: 44, borderColor: creditsMode === 'remove' ? 'rgba(244,67,54,0.5)' : 'rgba(255,255,255,0.1)', backgroundColor: creditsMode === 'remove' ? 'rgba(244,67,54,0.1)' : 'transparent' }]}
                  onPress={() => setCreditsMode('remove')}
                >
                  <Ionicons name="remove-circle-outline" size={16} color={creditsMode === 'remove' ? Colors.error : Colors.textMuted} />
                  <Text style={[styles.planActionText, { color: creditsMode === 'remove' ? Colors.error : Colors.textMuted }]}>Remover</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Quantidade a {creditsMode === 'add' ? 'adicionar' : 'remover'}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="wallet-outline" size={16} color={creditsMode === 'add' ? '#4CAF50' : Colors.error} />
                <TextInput style={styles.input} placeholder="Ex: 10" placeholderTextColor={Colors.textMuted} value={creditsInput} onChangeText={setCreditsInput} keyboardType="number-pad" />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[5, 10, 20, 30, 50].map(n => <Pressable key={n} style={styles.expiryPreset} onPress={() => setCreditsInput(String(n))}><Text style={styles.expiryPresetText}>{n}</Text></Pressable>)}
                </View>
              </ScrollView>

              <Text style={styles.fieldLabel}>Descrição (opcional)</Text>
              <View style={[styles.inputWrap, { marginBottom: 10 }]}>
                <Ionicons name="document-text-outline" size={16} color={Colors.textMuted} />
                <TextInput style={styles.input} placeholder={creditsMode === 'add' ? 'Ex: Bonificação mensal' : 'Ex: Estorno por inatividade'} placeholderTextColor={Colors.textMuted} value={creditsDescription} onChangeText={setCreditsDescription} />
              </View>

              {creditsInput && parseInt(creditsInput) > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: creditsMode === 'add' ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: creditsMode === 'add' ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)' }}>
                  <Ionicons name={creditsMode === 'add' ? 'trending-up-outline' : 'trending-down-outline'} size={14} color={creditsMode === 'add' ? '#4CAF50' : Colors.error} />
                  <Text style={{ color: creditsMode === 'add' ? '#4CAF50' : Colors.error, fontSize: 12, fontWeight: '600' }}>
                    Saldo após: {creditsMode === 'add'
                      ? (creditsRep?.credits ?? 0) + parseInt(creditsInput)
                      : Math.max(0, (creditsRep?.credits ?? 0) - parseInt(creditsInput))} crédito(s)
                  </Text>
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => { if (!creditsLoading) setCreditsModal(false); }}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                <Pressable
                  style={[styles.modalActionBtn, { flex: 1, backgroundColor: creditsMode === 'add' ? '#4CAF50' : Colors.error }, creditsLoading && { opacity: 0.6 }]}
                  onPress={async () => {
                    const amount = parseInt(creditsInput);
                    if (!amount || amount < 1) { Alert.alert('Valor inválido', 'Digite uma quantidade maior que zero'); return; }
                    if (creditsMode === 'remove' && amount > (creditsRep?.credits ?? 0)) {
                      Alert.alert('Saldo insuficiente', `O representante tem apenas ${creditsRep?.credits ?? 0} crédito(s).`);
                      return;
                    }
                    setCreditsLoading(true);
                    try {
                      if (creditsMode === 'add') {
                        await addCredits(creditsRep!.id, amount, creditsDescription.trim() || undefined);
                        Alert.alert('Pronto', `${amount} crédito(s) adicionados!`);
                      } else {
                        await removeCredits(creditsRep!.id, amount, creditsDescription.trim() || undefined);
                        Alert.alert('Pronto', `${amount} crédito(s) removidos!`);
                      }
                      setCreditsModal(false);
                      setCreditsInput('');
                      setCreditsDescription('');
                      await loadAll(true);
                    } catch (e: any) { Alert.alert('Erro', e.message); }
                    setCreditsLoading(false);
                  }}
                  disabled={creditsLoading}
                >
                  {creditsLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Ionicons name={creditsMode === 'add' ? 'add-circle-outline' : 'remove-circle-outline'} size={16} color="#fff" /><Text style={styles.modalActionText}> {creditsMode === 'add' ? 'Adicionar' : 'Remover'}</Text></>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── SUB-ADMIN MODAL ── */}
      <Modal visible={subAdminModal} transparent animationType="slide" onRequestClose={() => setSubAdminModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingSubAdmin ? 'Editar Sub-Admin' : 'Novo Sub-Admin'}</Text>
                <View style={[styles.creditsInfoCard, { marginBottom: 16, backgroundColor: 'rgba(21,101,192,0.06)', borderColor: 'rgba(21,101,192,0.2)' }]}>
                  <Ionicons name="shield-half-outline" size={14} color="#42A5F5" />
                  <Text style={[styles.planCred, { marginLeft: 8, fontSize: 11, flex: 1, color: '#90CAF9' }]}>
                    O sub-admin só verá seus próprios representantes, fontes e dispositivos. Sua rede principal fica isolada.
                  </Text>
                </View>
                {([
                  { field: 'name', label: 'Nome completo *', placeholder: 'Ex: Carlos Revendas', icon: 'person-outline', kb: 'default' },
                  { field: 'username', label: editingSubAdmin ? 'Usuário (não alterável)' : 'Usuário para login *', placeholder: 'Ex: carlos123', icon: 'at-outline', kb: 'default', disabled: !!editingSubAdmin },
                  { field: 'password', label: editingSubAdmin ? 'Nova senha (vazio = manter)' : 'Senha *', placeholder: '••••••••', icon: 'lock-closed-outline', kb: 'default', secure: true },
                  { field: 'notes', label: 'Observações', placeholder: 'Opcional...', icon: 'document-text-outline', kb: 'default' },
                ] as any[]).map(({ field, label, placeholder, icon, kb, secure, disabled }) => (
                  <View key={field}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <View style={[styles.inputWrap, disabled && { opacity: 0.5 }]}>
                      <Ionicons name={icon} size={16} color={Colors.textMuted} />
                      <TextInput style={styles.input} placeholder={placeholder} placeholderTextColor={Colors.textMuted} value={(subAdminForm as any)[field]} onChangeText={v => !disabled && setSubAdminForm(f => ({ ...f, [field]: v }))} keyboardType={kb} secureTextEntry={secure} autoCapitalize="none" editable={!disabled} />
                    </View>
                  </View>
                ))}
                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setSubAdminModal(false)}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                  <Pressable style={[styles.modalActionBtn, { flex: 1, backgroundColor: '#1565C0' }]} onPress={async () => {
                    if (!subAdminForm.name) { Alert.alert('Nome obrigatório'); return; }
                    if (!editingSubAdmin && (!subAdminForm.username || !subAdminForm.password)) { Alert.alert('Usuário e senha obrigatórios'); return; }
                    setSubAdminFormLoading(true);
                    try {
                      if (editingSubAdmin) {
                        await updateSubAdmin(editingSubAdmin.id, { name: subAdminForm.name, password: subAdminForm.password || undefined, notes: subAdminForm.notes });
                      } else {
                        await createSubAdmin({ username: subAdminForm.username, password: subAdminForm.password, name: subAdminForm.name, notes: subAdminForm.notes || undefined });
                      }
                      setSubAdminModal(false);
                      await loadAll(true);
                    } catch (e: any) { Alert.alert('Erro', e.message); }
                    setSubAdminFormLoading(false);
                  }} disabled={subAdminFormLoading}>
                    {subAdminFormLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalActionText}>{editingSubAdmin ? 'Salvar' : 'Criar Sub-Admin'}</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── SOURCE MODAL ── */}
      <Modal visible={sourceModal} transparent animationType="slide" onRequestClose={() => setSourceModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingSource ? 'Editar Fonte' : 'Nova Fonte'}</Text>
                {([
                  { field: 'name', label: 'Nome da fonte *', placeholder: 'Ex: Servidor Principal', icon: 'server-outline', kb: 'default' },
                  { field: 'server_url', label: 'DNS / URL do servidor *', placeholder: 'https://odira.sbs', icon: 'globe-outline', kb: 'url' },
                  { field: 'xtream_username', label: 'Usuário Xtream *', placeholder: 'usuario123', icon: 'person-outline', kb: 'default' },
                  { field: 'xtream_password', label: 'Senha Xtream *', placeholder: '••••••••', icon: 'lock-closed-outline', kb: 'default', secure: true },
                  { field: 'max_connections', label: 'Máx. conexões', placeholder: '5', icon: 'people-outline', kb: 'number-pad' },
                  { field: 'notes', label: 'Observações', placeholder: 'Opcional...', icon: 'document-text-outline', kb: 'default' },
                ] as any[]).map(({ field, label, placeholder, icon, kb, secure }) => (
                  <View key={field}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <View style={styles.inputWrap}><Ionicons name={icon} size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder={placeholder} placeholderTextColor={Colors.textMuted} value={(sourceForm as any)[field]} onChangeText={v => setSourceForm(f => ({ ...f, [field]: v }))} keyboardType={kb} secureTextEntry={secure} autoCapitalize="none" returnKeyType="next" /></View>
                  </View>
                ))}
                <Text style={styles.fieldLabel}>Atribuir ao representante</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable style={[styles.planChip, !sourceForm.rep_id && styles.planChipActive]} onPress={() => setSourceForm(f => ({ ...f, rep_id: '' }))}><Text style={[styles.planChipText, !sourceForm.rep_id && styles.planChipTextActive]}>Nenhum</Text></Pressable>
                    {reps.map(r => <Pressable key={r.id} style={[styles.planChip, sourceForm.rep_id === r.id && styles.planChipActive]} onPress={() => setSourceForm(f => ({ ...f, rep_id: r.id }))}><Text style={[styles.planChipText, sourceForm.rep_id === r.id && styles.planChipTextActive]}>#{r.rep_number} {r.name}</Text></Pressable>)}
                  </View>
                </ScrollView>
                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setSourceModal(false)}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                  <Pressable style={[styles.modalActionBtn, { flex: 1 }]} onPress={async () => {
                    if (!sourceForm.name || !sourceForm.server_url || !sourceForm.xtream_username || !sourceForm.xtream_password) { Alert.alert('Campos obrigatórios faltando'); return; }
                    setSourceFormLoading(true);
                    try {
                      if (editingSource) { await updateSource(editingSource.id, { name: sourceForm.name, server_url: sourceForm.server_url, xtream_username: sourceForm.xtream_username, xtream_password: sourceForm.xtream_password, max_connections: parseInt(sourceForm.max_connections) || 5, rep_id: sourceForm.rep_id || null, notes: sourceForm.notes || null } as any); }
                      else { await createSource({ name: sourceForm.name, server_url: sourceForm.server_url, xtream_username: sourceForm.xtream_username, xtream_password: sourceForm.xtream_password, max_connections: parseInt(sourceForm.max_connections) || 5, rep_id: sourceForm.rep_id || null, notes: sourceForm.notes }); }
                      setSourceModal(false); await loadAll(true);
                    } catch (e: any) { Alert.alert('Erro', e.message); }
                    setSourceFormLoading(false);
                  }} disabled={sourceFormLoading}>
                    {sourceFormLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalActionText}>{editingSource ? 'Salvar' : 'Criar Fonte'}</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── NOTIFICATION MODAL ── */}
      <Modal visible={notifModal} transparent animationType="slide" onRequestClose={() => setNotifModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdropFlex}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>Enviar Aviso</Text>
                <View style={styles.broadcastRow}>
                  <View style={{ flex: 1 }}><Text style={styles.fieldLabel}>Para todos os clientes?</Text><Text style={{ color: Colors.textMuted, fontSize: 11 }}>{notifForm.isBroadcast ? 'Aviso geral' : 'Aviso individual'}</Text></View>
                  <Pressable style={[styles.toggleBtn, notifForm.isBroadcast && styles.toggleBtnActive]} onPress={() => setNotifForm(f => ({ ...f, isBroadcast: !f.isBroadcast }))}><Text style={[styles.toggleBtnText, notifForm.isBroadcast && { color: '#fff' }]}>{notifForm.isBroadcast ? 'Geral' : 'Individual'}</Text></Pressable>
                </View>
                {!notifForm.isBroadcast && (<><Text style={styles.fieldLabel}>E-mail do cliente *</Text><View style={styles.inputWrap}><Ionicons name="mail-outline" size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder="cliente@email.com" placeholderTextColor={Colors.textMuted} value={notifForm.targetEmail} onChangeText={v => setNotifForm(f => ({ ...f, targetEmail: v }))} keyboardType="email-address" autoCapitalize="none" /></View></>)}
                <Text style={styles.fieldLabel}>Título *</Text>
                <View style={styles.inputWrap}><Ionicons name="megaphone-outline" size={16} color={Colors.textMuted} /><TextInput style={styles.input} placeholder="Ex: Manutenção programada" placeholderTextColor={Colors.textMuted} value={notifForm.title} onChangeText={v => setNotifForm(f => ({ ...f, title: v }))} /></View>
                <Text style={styles.fieldLabel}>Mensagem *</Text>
                <View style={[styles.inputWrap, { minHeight: 80, paddingVertical: 10, alignItems: 'flex-start', marginBottom: 16 }]}><TextInput style={[styles.input, { height: 70 }]} placeholder="Mensagem..." placeholderTextColor={Colors.textMuted} value={notifForm.message} onChangeText={v => setNotifForm(f => ({ ...f, message: v }))} multiline /></View>
                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setNotifModal(false)}><Text style={styles.modalCancelText}>Cancelar</Text></Pressable>
                  <Pressable style={[styles.modalActionBtn, { flex: 1 }]} onPress={handleSendNotification} disabled={notifLoading}>
                    {notifLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalActionText}>Enviar</Text>}
                  </Pressable>
                </View>
              </ScrollView>
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
  loginScreen: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  loginLogo: { width: 100, height: 100, borderRadius: 20, marginBottom: 16 },
  loginTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  loginSubtitle: { color: Colors.textMuted, fontSize: 13, marginBottom: 32 },
  loginCard: { width: '100%', maxWidth: 360, backgroundColor: '#141414', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)', marginBottom: 20 },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: 10, height: 50, marginTop: 4 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  backLink: { flexDirection: 'row', alignItems: 'center' },
  backLinkText: { color: Colors.textMuted, fontSize: 13 },
  errorText: { color: Colors.error, fontSize: 12, marginBottom: 8, paddingHorizontal: 4 },
  adminHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', gap: 10, backgroundColor: '#111' },
  headerBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)' },
  headerLogo: { width: 36, height: 36, borderRadius: 8 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub: { color: Colors.textMuted, fontSize: 10 },
  headerRefresh: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  tabBarScroll: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', backgroundColor: '#111', flexGrow: 0 },
  tabBar: { flexDirection: 'row' },
  tabItem: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 14, gap: 3, borderBottomWidth: 2, borderBottomColor: 'transparent', position: 'relative' },
  tabItemActive: { borderBottomColor: Colors.primary },
  tabLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '500' },
  tabLabelActive: { color: Colors.primary, fontWeight: '700' },
  tabBadge: { position: 'absolute', top: 4, right: 4, backgroundColor: '#9C27B0', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  section: { padding: 16 },
  sectionTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: (width - 56) / 3, backgroundColor: '#141414', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', gap: 10 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  deviceEmail: { color: '#fff', fontSize: 13, fontWeight: '600' },
  deviceMac: { color: Colors.textMuted, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  lastSeenText: { color: Colors.textMuted, fontSize: 10 },
  watchingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(156,39,176,0.12)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 120, borderWidth: 1, borderColor: 'rgba(156,39,176,0.25)' },
  watchingBadgeText: { color: '#9C27B0', fontSize: 9, fontWeight: '600', marginLeft: 3 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, color: '#fff', fontSize: 13 },
  selectModeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  selectModeBtnActive: {},
  bulkBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(229,0,0,0.06)', borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  bulkBarText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', flex: 1 },
  bulkBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  bulkBtnDanger: { backgroundColor: Colors.error, borderColor: Colors.error },
  bulkBtnText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  filterChipActive: { backgroundColor: 'rgba(229,0,0,0.15)', borderColor: Colors.primary },
  filterChipText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  filterChipTextActive: { color: Colors.primary },
  deleteInactiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(244,67,54,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(244,67,54,0.2)', marginBottom: 12 },
  deleteInactiveText: { color: Colors.error, fontSize: 12, fontWeight: '600' },
  repGroupCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141414', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 10 },
  repGroupIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(229,0,0,0.08)', borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  repGroupLabel: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  repGroupMeta: { color: Colors.textMuted, fontSize: 10 },
  sourceGroupHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 10 },
  deviceCard: { backgroundColor: '#141414', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', flexDirection: 'row', alignItems: 'center' },
  deviceCardSelected: { borderColor: Colors.primary, backgroundColor: 'rgba(229,0,0,0.06)' },
  checkboxWrap: { padding: 12 },
  deviceCardHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  statusIndicator: { width: 10, height: 10, borderRadius: 5 },
  deviceCardEmail: { color: '#fff', fontSize: 14, fontWeight: '600' },
  deviceCardMac: { color: Colors.textMuted, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  deviceCardRight: { alignItems: 'flex-end', marginRight: 4 },
  deviceCardStatus: { fontSize: 10, fontWeight: '800' },
  deviceCardPlan: { color: Colors.textMuted, fontSize: 9, maxWidth: 80 },
  deviceCardMeta: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6 },
  deviceCardMetaText: { color: Colors.textMuted, fontSize: 10 },
  currentContentBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6 },
  currentContentText: { color: '#9C27B0', fontSize: 10, fontWeight: '600', flex: 1 },
  expiryBar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingBottom: 8 },
  expiryBarText: { fontSize: 10, fontWeight: '600' },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: 10, height: 46, marginBottom: 16 },
  createBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  planCard: { backgroundColor: '#141414', borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 14 },
  planCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 10 },
  planName: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 3 },
  planServer: { color: Colors.primary, fontSize: 11 },
  planMacBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(229,0,0,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)' },
  planMacText: { color: Colors.primary, fontSize: 11, fontWeight: '700' },
  planCardBody: { gap: 4, marginBottom: 12 },
  planCredRow: { flexDirection: 'row', alignItems: 'center' },
  planCred: { color: Colors.textSecondary, fontSize: 12 },
  planCardActions: { flexDirection: 'row', gap: 8 },
  planActionBtn: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(229,0,0,0.3)' },
  planActionText: { fontSize: 13, fontWeight: '600' },
  notifCard: { backgroundColor: '#141414', borderRadius: 12, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  notifHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  notifTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  notifTarget: { color: Colors.primary, fontSize: 11, marginTop: 2 },
  notifMessage: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  notifDate: { color: Colors.textMuted, fontSize: 10 },
  broadcastRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: '#1a1a1a' },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleBtnText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  watchingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  watchingTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  watchingLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#9C27B0' },
  watchingLiveText: { color: Colors.textMuted, fontSize: 11 },
  watchingCard: { backgroundColor: '#141414', borderRadius: 12, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(156,39,176,0.2)', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  watchingCardIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(156,39,176,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(156,39,176,0.3)' },
  watchingContent: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  watchingEmail: { color: Colors.textSecondary, fontSize: 12, marginBottom: 4 },
  watchingMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  watchingMetaText: { color: Colors.textMuted, fontSize: 10 },
  emptySubText: { color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  creditsInfoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(255,215,0,0.06)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)' },
  preAuthCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)', alignItems: 'center' },
  preAuthTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  preAuthSubtitle: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  planChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', minWidth: 100 },
  planChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  planChipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  planChipTextActive: { color: '#fff' },
  fieldLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 12, height: 48, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 8, marginBottom: 10 },
  input: { flex: 1, color: '#fff', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingTop: 48, gap: 12 },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
  modalBackdropFlex: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end', alignItems: 'center' },
  modalSheet: { backgroundColor: '#141414', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 20, height: '92%', width: '100%', borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(229,0,0,0.2)', overflow: 'hidden' },
  modalHandle: { width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  deviceDetailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 8 },
  deviceDetailLabel: { color: Colors.textMuted, fontSize: 12, width: 88 },
  deviceDetailValue: { color: '#fff', fontSize: 12, flex: 1, textAlign: 'right' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(76,175,80,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  onlinePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },
  onlinePillText: { color: '#4CAF50', fontSize: 11, fontWeight: '700' },
  currentContentDetail: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(156,39,176,0.08)', borderRadius: 8, padding: 8, marginVertical: 6, borderWidth: 1, borderColor: 'rgba(156,39,176,0.2)' },
  currentContentDetailText: { color: '#9C27B0', fontSize: 11, fontWeight: '600', flex: 1 },
  blockReasonBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(229,0,0,0.08)', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(229,0,0,0.2)' },
  blockReasonText: { color: Colors.error, fontSize: 12 },
  graceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,152,0,0.1)', borderRadius: 8, padding: 8, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,152,0,0.2)' },
  graceBadgeText: { color: '#FF9800', fontSize: 11 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4CAF50', borderRadius: 12, height: 50, marginTop: 4, marginBottom: 12 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modalActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: 10, height: 44 },
  modalActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  modalCancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, height: 44, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalCancelText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  modalClose: { alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', marginTop: 8 },
  modalCloseText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  graceActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,152,0,0.12)', borderRadius: 10, height: 44, borderWidth: 1, borderColor: 'rgba(255,152,0,0.35)', marginBottom: 8 },
  graceActionText: { color: '#FF9800', fontSize: 13, fontWeight: '600' },
  expiryPreset: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  expiryPresetText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  blockReasonHint: { color: Colors.textMuted, fontSize: 12, marginBottom: 12, textAlign: 'center' },
  reasonChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  reasonChipActive: { backgroundColor: 'rgba(229,0,0,0.15)', borderColor: Colors.primary },
  reasonChipText: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  reasonChipTextActive: { color: Colors.primary },
});
