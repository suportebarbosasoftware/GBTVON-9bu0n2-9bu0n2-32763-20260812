import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, BorderRadius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { getDeviceId } from '@/services/deviceIdService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import { validateRepCode } from '@/services/repApiService';

const { width, height } = Dimensions.get('window');
const isTV = IS_TV;
const F = TV.fontSize;
const SP = TV.spacing;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();

  const [clientName, setClientName] = useState('');
  const [repCode, setRepCode] = useState('');
  const [repCodeValid, setRepCodeValid] = useState<boolean | null>(null); // null=unchecked, true=valid, false=invalid
  const [repCodeChecking, setRepCodeChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [macAddress, setMacAddress] = useState('');
  const [pendingInfo, setPendingInfo] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

  // Hidden admin access: tap logo 5 times
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repCodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getDeviceId().then(setMacAddress);
  }, []);

  function handleLogoTap() {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 2000);
    if (logoTapCount.current >= 5) {
      logoTapCount.current = 0;
      router.push('/admin');
    }
  }

  // Debounce rep code validation
  function handleRepCodeChange(val: string) {
    const cleaned = val.replace(/\D/g, '');
    setRepCode(cleaned);
    setRepCodeValid(null);
    if (repCodeTimer.current) clearTimeout(repCodeTimer.current);
    if (cleaned.length >= 1) {
      repCodeTimer.current = setTimeout(() => checkRepCode(cleaned), 700);
    }
  }

  async function checkRepCode(code: string) {
    if (!code.trim()) return;
    setRepCodeChecking(true);
    const result = await validateRepCode(code.trim());
    setRepCodeChecking(false);
    setRepCodeValid(result.ok);
  }

  async function handleLogin() {
    const trimmedName = clientName.trim();
    if (!trimmedName) { setError('Digite seu nome para continuar.'); return; }
    if (!repCode.trim()) { setError('Digite o código do representante para solicitar ativação.'); return; }
    if (repCodeValid === false) { setError('Código de representante inválido. Verifique e tente novamente.'); return; }

    setLoading(true);
    setError('');
    setPendingInfo({ visible: false, message: '' });

    const result = await login(trimmedName, repCode.trim());
    setLoading(false);

    if (result.success && result.status === 'activated') {
      router.replace('/(tabs)');
      return;
    }

    if (result.status === 'pending') {
      setPendingInfo({ visible: true, message: result.message || 'Aguardando ativação pelo representante.' });
      return;
    }

    if (result.status === 'expired') {
      setError(result.message || 'Seu acesso expirou. Contate o suporte.');
      return;
    }

    setError(result.error || 'Erro ao verificar acesso. Tente novamente.');
  }

  async function handleRefresh() {
    setLoading(true);
    const r = await login(clientName.trim() || 'Cliente', repCode.trim() || undefined);
    setLoading(false);
    if (r.success) { router.replace('/(tabs)'); return; }
    if (r.status === 'pending') setPendingInfo({ visible: true, message: r.message || '' });
    else { setPendingInfo({ visible: false, message: '' }); setError(r.error || ''); }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#000' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { minHeight: height, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Background */}
        <Image
          source={{ uri: 'https://cdn-ai.onspace.ai/onspace/files/8vq2Gk6pf9iimh4crADS5c/114D4170-861D-43FA-965D-725C740FA5FC.png' }}
          style={styles.bgImage}
          contentFit="cover"
          blurRadius={12}
        />
        <View style={styles.bgOverlay} />

        {/* Logo */}
        <Pressable onPress={handleLogoTap} style={styles.logoWrap}>
          <Image
            source={{ uri: 'https://cdn-ai.onspace.ai/onspace/files/8vq2Gk6pf9iimh4crADS5c/114D4170-861D-43FA-965D-725C740FA5FC.png' }}
            style={[styles.logo, isTV && styles.logoTV]}
            contentFit="contain"
          />
        </Pressable>

        <Text style={[styles.tagline, isTV && { fontSize: F.sm }]}>Mais que TV, Uma Experiência!</Text>

        {/* MAC display */}
        {macAddress ? (
          <View style={styles.macBadge}>
            <Ionicons name="hardware-chip-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.macText}> MAC: {macAddress}</Text>
          </View>
        ) : null}

        {/* Login card */}
        <View style={[styles.card, isTV && styles.cardTV]}>
          {!pendingInfo.visible ? (
            <>
              <Text style={[styles.cardTitle, isTV && { fontSize: F.xl }]}>Entrar no GBTVON</Text>
              <Text style={[styles.cardSubtitle, isTV && { fontSize: F.sm }]}>
                {isTV
                  ? 'Use o teclado virtual ou um teclado USB para digitar seu nome'
                  : 'Digite seu nome e o código do seu representante'}
              </Text>

              {/* Client name input */}
              <View style={[styles.inputWrap, isTV && styles.inputWrapTV]}>
                <Ionicons name="person-outline" size={isTV ? 24 : 18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, isTV && { fontSize: F.md, color: '#fff' }]}
                  placeholder="Seu nome completo"
                  placeholderTextColor={Colors.textMuted}
                  value={clientName}
                  onChangeText={t => { setClientName(t); setError(''); }}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                />
                {clientName.length > 0 && (
                  <Pressable onPress={() => setClientName('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* Rep code input */}
              <View style={[
                styles.inputWrap,
                isTV && styles.inputWrapTV,
                repCodeValid === true && styles.inputWrapValid,
                repCodeValid === false && styles.inputWrapError,
              ]}>
                <Ionicons name="person-circle-outline" size={isTV ? 24 : 18} color={
                  repCodeValid === true ? '#4CAF50' : repCodeValid === false ? Colors.error : Colors.textMuted
                } style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, isTV && { fontSize: F.md, color: '#fff' }]}
                  placeholder="Código do representante (ex: 01)"
                  placeholderTextColor={Colors.textMuted}
                  value={repCode}
                  onChangeText={handleRepCodeChange}
                  keyboardType="number-pad"
                  returnKeyType="go"
                  onSubmitEditing={handleLogin}
                />
                {repCodeChecking ? (
                  <ActivityIndicator size="small" color={Colors.textMuted} />
                ) : repCodeValid === true ? (
                  <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                ) : repCodeValid === false ? (
                  <Ionicons name="close-circle" size={16} color={Colors.error} />
                ) : null}
              </View>
              <Text style={styles.repCodeHint}>
                Solicite o código ao seu representante GBTVON
              </Text>

              {error ? (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle-outline" size={14} color={Colors.error} />
                  <Text style={[styles.errorText, isTV && { fontSize: F.sm }]}> {error}</Text>
                </View>
              ) : null}

              <TVFocusable
                style={[
                  styles.loginBtn,
                  isTV && styles.loginBtnTV,
                  loading && styles.loginBtnDisabled,
                ]}
                focusedStyle={{ shadowColor: '#E50000', shadowRadius: 18, shadowOpacity: 0.9, elevation: 20 }}
                hasTVPreferredFocus={isTV}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="play-circle" size={isTV ? 28 : 20} color="#fff" />
                    <Text style={[styles.loginBtnText, isTV && { fontSize: F.lg }]}>  Solicitar Ativação</Text>
                  </>
                )}
              </TVFocusable>

              <Text style={[styles.infoHint, isTV && { fontSize: F.xs }]}>
                Informe seu nome e o código do representante para solicitar ativação
              </Text>
            </>
          ) : (
            /* Pending activation screen */
            <View style={styles.pendingWrap}>
              <View style={styles.pendingIconWrap}>
                <Ionicons name="time-outline" size={isTV ? 64 : 48} color={Colors.primary} />
              </View>
              <Text style={[styles.pendingTitle, isTV && { fontSize: F.xl }]}>Aguardando ativação</Text>
              <Text style={[styles.pendingMsg, isTV && { fontSize: F.sm }]}>{pendingInfo.message}</Text>

              <View style={styles.pendingMacCard}>
                <Text style={styles.pendingMacLabel}>Seu código MAC:</Text>
                <Text style={[styles.pendingMacValue, isTV && { fontSize: F.lg }]}>{macAddress}</Text>
                <Text style={[styles.pendingMacHint, isTV && { fontSize: F.xs }]}>
                  Envie este código ao representante para ativar seu acesso
                </Text>
              </View>

              <TVFocusable
                style={[styles.refreshBtn, isTV && styles.refreshBtnTV]}
                focusedStyle={{ borderColor: '#E50000', shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 12 }}
                onPress={handleRefresh}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color={Colors.primary} size="small" /> : (
                  <>
                    <Ionicons name="refresh" size={isTV ? 24 : 16} color={Colors.primary} />
                    <Text style={[styles.refreshBtnText, isTV && { fontSize: F.md }]}>  Verificar ativação</Text>
                  </>
                )}
              </TVFocusable>

              <TVFocusable style={styles.backBtn} onPress={() => setPendingInfo({ visible: false, message: '' })}>
                <Text style={[styles.backBtnText, isTV && { fontSize: F.sm }]}>Voltar</Text>
              </TVFocusable>
            </View>
          )}
        </View>

        {/* Support */}
        <View style={styles.supportRow}>
          <Ionicons name="headset-outline" size={13} color={Colors.textMuted} />
          <Text style={[styles.supportText, isTV && { fontSize: F.xs }]}> Suporte: </Text>
          <TVFocusable onPress={() => {
            const { Linking } = require('react-native');
            Linking.openURL('tel:79999001094');
          }}>
            <Text style={[styles.supportPhone, isTV && { fontSize: F.xs }]}>(79) 99900-1094</Text>
          </TVFocusable>
        </View>

        {/* Representative area */}
        <Pressable
          style={styles.repAreaBtn}
          onPress={() => router.push('/rep-panel')}
        >
          <Ionicons name="headset-outline" size={16} color={Colors.textMuted} />
          <Text style={styles.repAreaText}> Área do Representante</Text>
        </Pressable>

        {/* TV hint */}
        {isTV ? (
          <Text style={styles.tvHint}>
            Pressione OK para confirmar • Use ↑↓ para navegar
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: isTV ? SP.xl : 24 },
  bgImage: { position: 'absolute', width: '100%', height: '100%', opacity: 0.18 },
  bgOverlay: { position: 'absolute', width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.72)' },

  logoWrap: { marginBottom: 8 },
  logo: { width: 160, height: 160, borderRadius: 28 },
  logoTV: { width: 200, height: 200, borderRadius: 36 },

  tagline: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontStyle: 'italic', marginBottom: 12, letterSpacing: 0.5 },

  macBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  macText: { color: Colors.textMuted, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: 'rgba(20,20,20,0.95)',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.2)',
    marginBottom: 20,
  },
  cardTV: {
    maxWidth: 560,
    padding: 36,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(229,0,0,0.3)',
  },
  cardTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  cardSubtitle: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 24, lineHeight: 19 },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 10,
    gap: 8,
  },
  inputWrapTV: { height: 64, borderRadius: 14, paddingHorizontal: 18 },
  inputWrapValid: { borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.07)' },
  inputWrapError: { borderColor: 'rgba(229,0,0,0.5)', backgroundColor: 'rgba(229,0,0,0.05)' },
  inputIcon: {},
  input: { flex: 1, color: '#fff', fontSize: 15 },

  repCodeHint: { color: Colors.textMuted, fontSize: 11, marginBottom: 12, paddingHorizontal: 2, lineHeight: 16 },

  errorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 4 },
  errorText: { color: Colors.error, fontSize: 13, flex: 1, flexWrap: 'wrap' },

  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 52,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  loginBtnTV: { height: 68, borderRadius: 16 },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  infoHint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 },

  // Pending
  pendingWrap: { alignItems: 'center' },
  pendingIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(229,0,0,0.1)',
    borderWidth: 2, borderColor: 'rgba(229,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  pendingTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  pendingMsg: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  pendingMacCard: {
    width: '100%',
    backgroundColor: 'rgba(229,0,0,0.08)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.25)',
    alignItems: 'center',
    marginBottom: 20,
  },
  pendingMacLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  pendingMacValue: { color: Colors.primary, fontSize: 20, fontWeight: '900', letterSpacing: 2, marginBottom: 8, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  pendingMacHint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 24,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    width: '100%',
    marginBottom: 12,
  },
  refreshBtnTV: { height: 64, borderRadius: 16 },
  refreshBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
  backBtn: { paddingVertical: 8 },
  backBtnText: { color: Colors.textSecondary, fontSize: 13 },

  repAreaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  repAreaText: { color: Colors.textMuted, fontSize: 13, fontWeight: '500' },
  supportRow: { flexDirection: 'row', alignItems: 'center' },
  supportText: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  supportPhone: { color: '#4FC3F7', fontSize: 12, fontWeight: '600' },

  tvHint: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 13,
    marginTop: 16,
    fontStyle: 'italic',
  },
});
