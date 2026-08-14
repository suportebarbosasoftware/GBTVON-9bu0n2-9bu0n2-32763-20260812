import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { resetSetup } from '@/services/channelSetupService';
import { clearHiddenChannels, clearHiddenCategories } from '@/services/channelFilterService';
import { getHistory, getFavorites, clearHistory } from '@/services/favoritesService';
import { getDeviceProfile } from '@/services/deviceService';
import { getDeviceId } from '@/services/deviceIdService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import { useDevMode } from '@/contexts/DevModeContext';

const device = getDeviceProfile();
const isTV = IS_TV;
const F = TV.fontSize;
const SP = TV.spacing;

// ── Main Profile Screen ──────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { auth, userEmail, macAddress: authMac, planName, expiresAt, logout, refreshActivation } = useAuth();

  const [historyCount, setHistoryCount] = useState(0);
  const [favCount, setFavCount] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);
  const [deviceMac, setDeviceMac] = useState(authMac || '');
  const [refreshing, setRefreshing] = useState(false);

  // Developer mode via shared context — overlay rendered globally in TabLayout
  const { devMode, registerTap } = useDevMode();
  const devPulse = useRef(new Animated.Value(1)).current;

  // Hidden admin access: tap headset icon 7 times
  const adminTapCount = useRef(0);
  const adminTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadStats();
    if (!authMac) getDeviceId().then(setDeviceMac);
    else setDeviceMac(authMac);
  }, [authMac]);

  // Pulse animation for dev mode avatar ring
  useEffect(() => {
    if (!devMode) { devPulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(devPulse, { toValue: 1.12, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(devPulse, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [devMode]);

  async function loadStats() {
    setLoadingStats(true);
    try {
      const [history, favorites] = await Promise.all([getHistory(), getFavorites()]);
      setHistoryCount(history.length);
      setFavCount(favorites.length);
    } catch {}
    setLoadingStats(false);
  }

  async function handleRefreshActivation() {
    setRefreshing(true);
    await refreshActivation();
    setRefreshing(false);
    Alert.alert('Verificado', 'Status de ativação atualizado!');
  }

  function handleSupportIconTap() {
    adminTapCount.current += 1;
    if (adminTapTimer.current) clearTimeout(adminTapTimer.current);
    adminTapTimer.current = setTimeout(() => { adminTapCount.current = 0; }, 3000);
    if (adminTapCount.current >= 7) {
      adminTapCount.current = 0;
      router.push('/admin' as any);
    }
  }

  // 7 taps on avatar → developer mode (global via context, overlay in TabLayout)
  function handleAvatarTap() {
    const remaining = registerTap();
    if (remaining === 0 && !devMode) {
      Alert.alert('Modo Desenvolvedor', 'Painel D-Pad ativado — disponível em todas as abas!');
    }
  }

  async function handleLogout() {
    Alert.alert(
      'Trocar conta',
      'Deseja sair e entrar com outro e-mail?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/login' as any);
          },
        },
      ]
    );
  }

  async function handleResetChannels() {
    Alert.alert(
      'Reconfigurar canais',
      'Isto abrirá o assistente de seleção de canais novamente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            await resetSetup();
            router.push('/channel-setup' as any);
          },
        },
      ]
    );
  }

  async function handleClearFilters() {
    Alert.alert(
      'Restaurar canais ocultos',
      'Todos os canais e categorias que você ocultou serão restaurados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          onPress: async () => {
            await Promise.all([clearHiddenChannels(), clearHiddenCategories()]);
            Alert.alert('Pronto', 'Canais restaurados!');
          },
        },
      ]
    );
  }

  async function handleClearHistory() {
    Alert.alert(
      'Limpar histórico',
      'Seu histórico de filmes e séries assistidos será apagado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar',
          style: 'destructive',
          onPress: async () => {
            await clearHistory();
            setHistoryCount(0);
            Alert.alert('Pronto', 'Histórico limpo!');
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 20, 32) }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.headerLogo}
            contentFit="contain"
          />
          <Text style={styles.headerTitle}>Perfil</Text>
          {devMode && (
            <View style={styles.devBadgeHeader}>
              <Ionicons name="bug-outline" size={12} color="#E50000" />
              <Text style={styles.devBadgeHeaderText}> DEV</Text>
            </View>
          )}
          {isTV ? <Text style={styles.tvNavHint}>↑↓ Navegar · OK Selecionar</Text> : null}
        </View>

        {/* Account Card */}
        <View style={[styles.accountCard, isTV && styles.accountCardTV]}>
          {/* Avatar — 7 taps activates dev mode */}
          <Pressable onPress={handleAvatarTap} style={{ position: 'relative' }}>
            <Animated.View style={[
              styles.accountAvatarRing,
              devMode && styles.accountAvatarRingDev,
              devMode && { transform: [{ scale: devPulse }] },
            ]}>
              <Image
                source={require('@/assets/images/icon.png')}
                style={[styles.accountAvatar, isTV && styles.accountAvatarTV]}
                contentFit="contain"
              />
            </Animated.View>
            <View style={[styles.accountStatusDot, { backgroundColor: devMode ? '#E50000' : '#4CAF50' }]} />
            {devMode && (
              <View style={styles.devIndicatorBadge}>
                <Ionicons name="bug" size={10} color="#fff" />
              </View>
            )}
          </Pressable>

          <View style={styles.accountInfo}>
            <Text style={[styles.accountUser, isTV && { fontSize: F.lg }]} numberOfLines={1}>
              {userEmail || 'Usuário'}
            </Text>
            <View style={styles.accountStatusBadge}>
              <View style={[styles.accountStatusDotInline, { backgroundColor: devMode ? '#E50000' : '#4CAF50' }]} />
              <Text style={[styles.accountStatusText, { color: devMode ? '#E50000' : '#4CAF50', fontSize: isTV ? F.sm : 11 }]}>
                {devMode ? 'Dev Mode' : 'Ativa'}
              </Text>
            </View>
            {planName ? (
              <Text style={[styles.accountServer, isTV && { fontSize: F.xs }]} numberOfLines={1}>
                Plano: {planName}
              </Text>
            ) : null}
            {expiresAt ? (
              <View style={styles.expiryBadge}>
                <Ionicons name="calendar-outline" size={11} color={
                  new Date(expiresAt) < new Date() ? Colors.error :
                  new Date(expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 ? '#FF9800' : '#4CAF50'
                } />
                <Text style={[styles.expiryBadgeText, {
                  color: new Date(expiresAt) < new Date() ? Colors.error :
                         new Date(expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 ? '#FF9800' : '#4CAF50'
                }]}>
                  {new Date(expiresAt) < new Date()
                    ? 'Expirado'
                    : `Vence: ${new Date(expiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                </Text>
              </View>
            ) : null}
            {deviceMac ? (
              <Text style={[styles.accountServer, { fontFamily: 'monospace', fontSize: isTV ? 13 : 10 }]} numberOfLines={1}>
                MAC: {deviceMac}
              </Text>
            ) : null}
            {devMode && (
              <Text style={styles.devTapHint}>Toque na foto 7x para desativar · painel visível em todas as abas</Text>
            )}
          </View>
        </View>

        {/* Account Details */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isTV && { fontSize: F.xs }]}>Dados da Conta</Text>
          <View style={styles.detailsCard}>
            <DetailRow icon="person-outline" label="Nome" value={userEmail || '—'} />
            <DetailRow icon="hardware-chip-outline" label="MAC" value={deviceMac || '—'} mono />
            <DetailRow icon="layers-outline" label="Plano" value={planName || '—'} />
            <DetailRow
              icon="calendar-outline"
              label="Vencimento"
              value={
                expiresAt
                  ? new Date(expiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : 'Sem prazo'
              }
              valueColor={
                !expiresAt ? Colors.textMuted :
                new Date(expiresAt) < new Date() ? Colors.error :
                new Date(expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 ? '#FF9800' : '#4CAF50'
              }
              isLast
            />
          </View>
        </View>

        {/* Refresh */}
        <View style={styles.section}>
          <TVFocusable
            style={[styles.refreshActivationBtn, isTV && styles.btnTV]}
            focusedStyle={{ borderColor: '#E50000', shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 12 }}
            onPress={handleRefreshActivation}
            disabled={refreshing}
            hasTVPreferredFocus={isTV}
          >
            {refreshing ? <ActivityIndicator color={Colors.primary} size="small" /> : (
              <>
                <Ionicons name="refresh-circle-outline" size={isTV ? TV.iconSize.md : 18} color={Colors.primary} />
                <Text style={[styles.refreshActivationText, isTV && { fontSize: F.md }]}>Verificar ativação</Text>
              </>
            )}
          </TVFocusable>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, isTV && styles.statCardTV]}>
            <Ionicons name="heart" size={isTV ? TV.iconSize.md : 24} color={Colors.error} />
            <Text style={[styles.statNum, isTV && { fontSize: F.xl }]}>{loadingStats ? '—' : favCount}</Text>
            <Text style={[styles.statLabel, isTV && { fontSize: F.xs }]}>Favoritos</Text>
          </View>
          <View style={[styles.statCard, isTV && styles.statCardTV]}>
            <Ionicons name="time" size={isTV ? TV.iconSize.md : 24} color={Colors.primary} />
            <Text style={[styles.statNum, isTV && { fontSize: F.xl }]}>{loadingStats ? '—' : historyCount}</Text>
            <Text style={[styles.statLabel, isTV && { fontSize: F.xs }]}>Assistidos</Text>
          </View>
          <View style={[styles.statCard, isTV && styles.statCardTV]}>
            <Ionicons name="tv" size={isTV ? TV.iconSize.md : 24} color="#4FC3F7" />
            <Text style={[styles.statNum, isTV && { fontSize: F.lg }]}>{isTV ? 'TV' : device.type === 'tablet' ? 'Tablet' : 'Celular'}</Text>
            <Text style={[styles.statLabel, isTV && { fontSize: F.xs }]}>Dispositivo</Text>
          </View>
        </View>

        {/* Channel Settings */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isTV && { fontSize: F.xs }]}>Canais e Configurações</Text>
          <View style={styles.menuCard}>
            <MenuRow
              icon="options"
              label="Reconfigurar canais"
              subtitle="Montar sua lista novamente"
              onPress={handleResetChannels}
              isTV={isTV}
            />
            <MenuRow
              icon="eye"
              label="Restaurar canais ocultos"
              subtitle="Trazer canais que foram removidos"
              onPress={handleClearFilters}
              isTV={isTV}
            />
            <MenuRow
              icon="trash-outline"
              iconColor={Colors.error}
              label="Limpar histórico"
              subtitle={`${historyCount} item(s) assistidos`}
              labelColor={Colors.error}
              onPress={handleClearHistory}
              isLast
              isTV={isTV}
            />
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isTV && { fontSize: F.xs }]}>Suporte</Text>
          <View style={[styles.supportCard, isTV && styles.supportCardTV]}>
            <Pressable onPress={handleSupportIconTap} hitSlop={16}>
              <Ionicons name="headset-outline" size={isTV ? TV.iconSize.md : 32} color={Colors.primary} />
            </Pressable>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[styles.supportTitle, isTV && { fontSize: F.md }]}>Precisa de ajuda?</Text>
              <Text style={[styles.supportSub, isTV && { fontSize: F.xs }]}>
                {isTV ? 'Toque 7x no ícone para acessar o painel Admin' : 'Fale com nosso suporte técnico'}
              </Text>
            </View>
            <TVFocusable
              style={styles.supportBtn}
              focusedStyle={{ shadowColor: '#E50000', shadowRadius: 8, shadowOpacity: 0.7 }}
              onPress={() => {
                const { Linking } = require('react-native');
                Linking.openURL('tel:79999001094');
              }}
            >
              <Text style={[styles.supportBtnText, isTV && { fontSize: F.xs }]}>(79) 99900-1094</Text>
            </TVFocusable>
          </View>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <TVFocusable
            style={[styles.logoutBtn, isTV && styles.btnTV]}
            focusedStyle={{ borderColor: '#ff6666', shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 14 }}
            onPress={handleLogout}
          >
            <Ionicons name="swap-horizontal-outline" size={isTV ? TV.iconSize.sm : 20} color="#fff" />
            <Text style={[styles.logoutText, isTV && { fontSize: F.md }]}>Trocar de Conta</Text>
          </TVFocusable>
          <Text style={[styles.versionText, isTV && { fontSize: F.xs }]}>GBTVON • v1.0.0 • Mais que TV, Uma Experiência!</Text>
        </View>
      </ScrollView>
      {/* DevDPad overlay is rendered globally in app/(tabs)/_layout.tsx */}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailRow({ icon, label, value, isLast = false, mono = false, valueColor }: {
  icon: string; label: string; value: string; isLast?: boolean; mono?: boolean; valueColor?: string;
}) {
  return (
    <View style={[styles.detailRow, !isLast && styles.detailRowBorder]}>
      <Ionicons name={icon as any} size={16} color={Colors.primary} style={{ width: 20 }} />
      <Text style={[styles.detailLabel, isTV && { fontSize: F.sm }]}>{label}</Text>
      <Text style={[
        styles.detailValue,
        mono && { fontFamily: 'monospace', fontSize: isTV ? 13 : 10 },
        isTV && { fontSize: F.sm },
        valueColor ? { color: valueColor, fontWeight: '700' } : undefined,
      ]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MenuRow({ icon, iconColor, label, subtitle, labelColor, onPress, isLast = false, isTV: _isTV = false }: {
  icon: string; iconColor?: string; label: string; subtitle?: string; labelColor?: string;
  onPress: () => void; isLast?: boolean; isTV?: boolean;
}) {
  return (
    <TVFocusable
      style={[
        styles.menuRow,
        !isLast && styles.menuRowBorder,
        _isTV && styles.menuRowTV,
      ]}
      focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.12)', borderColor: '#E50000' }}
      onPress={onPress}
    >
      <View style={[styles.menuIconWrap, iconColor ? { backgroundColor: `${iconColor}22` } : undefined, _isTV && styles.menuIconWrapTV]}>
        <Ionicons name={icon as any} size={_isTV ? TV.iconSize.sm : 18} color={iconColor || Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuRowLabel, labelColor ? { color: labelColor } : undefined, _isTV && { fontSize: F.md }]}>{label}</Text>
        {subtitle ? <Text style={[styles.menuRowSub, _isTV && { fontSize: F.xs }]}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={_isTV ? TV.iconSize.sm : 16} color={Colors.textMuted} />
    </TVFocusable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: isTV ? SP.lg : Spacing.md,
    paddingVertical: isTV ? 16 : 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 4,
  },
  headerLogo: { width: isTV ? 52 : 36, height: isTV ? 52 : 36, borderRadius: 6, marginRight: 10 },
  headerTitle: { color: Colors.textPrimary, fontSize: F.lg, fontWeight: '700', flex: 1 },
  tvNavHint: { color: 'rgba(255,255,255,0.25)', fontSize: 12, fontStyle: 'italic' },
  devBadgeHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(229,0,0,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(229,0,0,0.4)', marginRight: 8 },
  devBadgeHeaderText: { color: '#E50000', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  accountCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    margin: isTV ? SP.md : Spacing.md,
    padding: isTV ? SP.md : 18,
    backgroundColor: '#1a0000',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.3)',
    gap: 16,
  },
  accountCardTV: { padding: 24, borderRadius: 20, borderWidth: 2 },

  accountAvatarRing: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(229,0,0,0.3)',
    padding: 2,
  },
  accountAvatarRingDev: {
    borderColor: '#E50000',
    borderWidth: 3,
    shadowColor: '#E50000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 12,
  },
  accountAvatar: { width: 72, height: 72, borderRadius: 16 },
  accountAvatarTV: { width: 96, height: 96, borderRadius: 20 },
  accountStatusDot: { position: 'absolute', bottom: 4, right: 4, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#1a0000' },
  devIndicatorBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E50000',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1a0000',
  },

  accountInfo: { flex: 1 },
  accountUser: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  accountStatusBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: '#4CAF50', paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6, gap: 5 },
  accountStatusDotInline: { width: 6, height: 6, borderRadius: 3 },
  accountStatusText: { fontSize: 11, fontWeight: '700' },
  accountServer: { color: Colors.textMuted, fontSize: 11 },
  devTapHint: { color: 'rgba(229,0,0,0.6)', fontSize: 10, marginTop: 4, fontStyle: 'italic' },

  section: { marginHorizontal: isTV ? SP.md : Spacing.md, marginBottom: isTV ? SP.sm : Spacing.md },
  sectionTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10, textTransform: 'uppercase' },
  detailsCard: { backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: isTV ? 16 : 13, gap: 10 },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  detailLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', width: 88 },
  detailValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  refreshActivationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(229,0,0,0.08)',
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.2)',
  },
  refreshActivationText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  btnTV: { height: TV.buttonHeight, borderRadius: TV.cardRadius },
  statsRow: { flexDirection: 'row', marginHorizontal: isTV ? SP.md : Spacing.md, marginBottom: isTV ? SP.sm : Spacing.md, gap: 10 },
  statCard: { flex: 1, backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center', gap: 4 },
  statCardTV: { padding: 20, borderRadius: 16 },
  statNum: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },
  menuCard: { backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  menuRowTV: { paddingVertical: 20, paddingHorizontal: 20 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  menuIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(229,0,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  menuIconWrapTV: { width: 48, height: 48, borderRadius: 14 },
  menuRowLabel: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  menuRowSub: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  supportCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 0 },
  supportCardTV: { padding: 22, borderRadius: 16 },
  supportTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  supportSub: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  supportBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  supportBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(229,0,0,0.15)',
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.4)',
    marginBottom: 14,
  },
  logoutText: { color: Colors.primary, fontSize: 16, fontWeight: '700' },
  versionText: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },
  expiryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  expiryBadgeText: { fontSize: 11, fontWeight: '700' },
});
