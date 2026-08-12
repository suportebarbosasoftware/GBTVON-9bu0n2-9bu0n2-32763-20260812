import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Linking,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, BorderRadius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { activateGracePeriod } from '@/services/activationService';

const isTV = IS_TV;
const F = TV.fontSize;

/** Shared PIX payment section rendered for both expired and manual-block */
function PixSection({
  price,
  isLandscape,
  qrSize,
  whatsappUrl,
}: {
  price: number | null;
  isLandscape: boolean;
  qrSize: number;
  whatsappUrl: string;
}) {
  return (
    <View style={[pixStyles.pixSection, isLandscape && { flexDirection: 'row', alignItems: 'flex-start', gap: 20 }]}>
      {/* QR Code */}
      <View style={[pixStyles.qrContainer, { width: qrSize + 16, alignSelf: isLandscape ? 'flex-start' : 'center' }]}>
        <View style={[pixStyles.qrWrap, { width: qrSize, height: qrSize }]}>
          <Image
            source={require('@/assets/pix-qrcode.png')}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
          />
        </View>
        <Text style={pixStyles.qrLabel}>Escaneie para pagar</Text>
        <Text style={pixStyles.qrName}>GINESON BARBOSA DOS SANTOS</Text>
      </View>

      {/* PIX Key + Info */}
      <View style={[pixStyles.pixInfo, isLandscape && { flex: 1 }]}>
        {price ? (
          <View style={pixStyles.priceCard}>
            <Text style={pixStyles.priceLabel}>Valor em aberto:</Text>
            <Text style={pixStyles.priceValue}>R$ {price.toFixed(2)}</Text>
          </View>
        ) : null}

        <View style={pixStyles.pixKeyCard}>
          <Text style={pixStyles.pixKeyLabel}>Chave PIX:</Text>
          <Text style={[pixStyles.pixKey, isTV && { fontSize: F.md }]} selectable>
            gbtvon2@gmail.com
          </Text>
        </View>

        <Text style={[pixStyles.pixInstructions, isTV && { fontSize: F.xs }]}>
          Após o pagamento, envie o comprovante pelo WhatsApp:
        </Text>

        <TVFocusable
          style={pixStyles.whatsappBtn}
          focusedStyle={{ shadowColor: '#25D366', shadowOpacity: 0.8, shadowRadius: 14 }}
          onPress={() => Linking.openURL(whatsappUrl)}
        >
          <Ionicons name="logo-whatsapp" size={isTV ? 28 : 22} color="#fff" />
          <Text style={[pixStyles.whatsappBtnText, isTV && { fontSize: F.sm }]}>
            WhatsApp: (79) 99900-1094
          </Text>
        </TVFocusable>

        <Pressable style={pixStyles.phoneLinkRow} onPress={() => Linking.openURL('tel:79999001094')}>
          <Ionicons name="call-outline" size={13} color={Colors.textMuted} />
          <Text style={pixStyles.phoneLinkText}>Ligar: (79) 99900-1094</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function BlockedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    reason?: string;
    blockDetail?: string;
    price?: string;
  }>();
  const { userEmail, activationStatus, refreshActivation } = useAuth();

  const reason = params.reason || activationStatus || 'expired';
  const isManualBlock = reason === 'blocked_manual';
  const isExpired = reason === 'expired';
  const blockDetail = params.blockDetail || '';
  const price = params.price ? parseFloat(params.price) : null;

  const [loading, setLoading] = useState(false);
  const [gracePeriodActivating, setGracePeriodActivating] = useState(false);
  const [graceUsed, setGraceUsed] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Responsive sizing
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const isLandscape = screenW > screenH;
  const qrSize = Math.min(screenW * (isLandscape ? 0.22 : 0.55), 240);
  const cardMaxW = Math.min(screenW - 32, 520);

  const whatsappUrl = 'https://wa.me/5579999001094';

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  async function handleGracePeriod() {
    if (!userEmail) return;
    setGracePeriodActivating(true);
    try {
      const result = await activateGracePeriod(userEmail);
      if (result.status === 'activated') {
        await refreshActivation();
        router.replace('/(tabs)');
      } else {
        setGraceUsed(true);
      }
    } catch {}
    setGracePeriodActivating(false);
  }

  async function handleRefreshCheck() {
    setLoading(true);
    await refreshActivation();
    setLoading(false);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, 32) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <Animated.View style={[styles.logoWrap, { transform: [{ scale: pulseAnim }] }]}>
          <Image source={require('@/assets/images/icon.png')} style={styles.logo} contentFit="contain" />
        </Animated.View>
        <Text style={[styles.brand, isTV && { fontSize: F.xxl, letterSpacing: 6 }]}>GBTVON</Text>

        {/* ── MANUAL BLOCK ── */}
        {isManualBlock ? (
          <View style={[styles.card, { maxWidth: cardMaxW }]}>
            <View style={[styles.warningBadge, { borderColor: 'rgba(229,0,0,0.5)', backgroundColor: 'rgba(229,0,0,0.12)' }]}>
              <Ionicons name="ban" size={isTV ? 40 : 30} color={Colors.error} />
            </View>
            <Text style={[styles.cardTitle, isTV && { fontSize: F.lg }]}>Acesso Bloqueado</Text>

            {blockDetail ? (
              <View style={styles.blockReasonCard}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.blockReasonLabel}>Motivo informado pelo administrador:</Text>
                  <Text style={styles.blockReasonValue}>{blockDetail}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.cardMessage}>
                Seu acesso foi suspenso pelo administrador.{'\n'}
                Para regularizar, realize o pagamento abaixo.
              </Text>
            )}

            <View style={styles.divider} />
            <Text style={styles.pixSectionTitle}>Realize o pagamento para desbloquear:</Text>

            {/* PIX QR + key + WhatsApp — always visible on manual block */}
            <PixSection
              price={price}
              isLandscape={isLandscape}
              qrSize={qrSize}
              whatsappUrl={whatsappUrl}
            />

            <Text style={[styles.pixFooter, isTV && { fontSize: F.xs }]}>
              Após confirmar o pagamento, aguarde a reativação pelo administrador.
            </Text>
          </View>
        ) : null}

        {/* ── EXPIRED ── */}
        {isExpired ? (
          <View style={[styles.card, { maxWidth: cardMaxW }]}>
            <View style={[styles.warningBadge, { backgroundColor: 'rgba(229,0,0,0.12)', borderColor: 'rgba(229,0,0,0.4)' }]}>
              <Ionicons name="time-outline" size={isTV ? 40 : 30} color={Colors.error} />
            </View>
            <Text style={[styles.cardTitle, isTV && { fontSize: F.lg }]}>Assinatura Expirada</Text>
            <Text style={[styles.cardMessage, isTV && { fontSize: F.sm }]}>
              Seu plano GBTVON venceu e o acesso foi suspenso.{'\n'}
              Realize o pagamento para reativar imediatamente.
            </Text>

            {/* PIX QR + key + WhatsApp */}
            <PixSection
              price={price}
              isLandscape={isLandscape}
              qrSize={qrSize}
              whatsappUrl={whatsappUrl}
            />

            <Text style={[styles.pixFooter, isTV && { fontSize: F.xs }]}>
              Assim que o pagamento for confirmado, seu acesso será reativado.
            </Text>

            <View style={styles.divider} />

            {/* Grace period */}
            {!graceUsed ? (
              <View style={styles.graceSection}>
                <Text style={[styles.graceTitle, isTV && { fontSize: F.md }]}>Sem condições de pagar agora?</Text>
                <Text style={[styles.graceSubtitle, isTV && { fontSize: F.xs }]}>
                  Ative 3 dias gratuitos para continuar enquanto resolve o pagamento.{'\n'}
                  <Text style={{ color: Colors.error, fontWeight: '700' }}>Pode ser usado apenas uma vez.</Text>
                </Text>
                <TVFocusable
                  style={[styles.graceBtn, gracePeriodActivating && { opacity: 0.6 }]}
                  focusedStyle={{ borderColor: '#fff', borderWidth: 2, shadowColor: '#E50000', shadowOpacity: 0.8, shadowRadius: 14 }}
                  onPress={handleGracePeriod}
                  disabled={gracePeriodActivating}
                >
                  {gracePeriodActivating
                    ? <ActivityIndicator color="#fff" size="small" />
                    : (
                      <>
                        <Ionicons name="time-outline" size={18} color="#fff" />
                        <Text style={styles.graceBtnText}> Ativar 3 dias de confiança</Text>
                      </>
                    )}
                </TVFocusable>
              </View>
            ) : (
              <View style={styles.graceUsedBadge}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
                <Text style={styles.graceUsedText}>Período de confiança já utilizado</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Refresh check */}
        <TVFocusable
          style={[styles.refreshBtn, { maxWidth: cardMaxW }]}
          focusedStyle={{ borderColor: '#E50000', shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 12 }}
          onPress={handleRefreshCheck}
          disabled={loading}
          hasTVPreferredFocus={isTV}
        >
          {loading
            ? <ActivityIndicator color={Colors.primary} size="small" />
            : (
              <>
                <Ionicons name="refresh-outline" size={16} color={Colors.primary} />
                <Text style={styles.refreshBtnText}> Verificar status do acesso</Text>
              </>
            )}
        </TVFocusable>

        <TVFocusable
          style={styles.logoutLink}
          focusedStyle={{ borderColor: '#E50000', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 }}
          onPress={() => router.replace('/login')}
        >
          <Text style={styles.logoutLinkText}>Usar outro e-mail</Text>
        </TVFocusable>
      </ScrollView>
    </View>
  );
}

// ── Shared PIX styles ────────────────────────────────────────────────────────
const pixStyles = StyleSheet.create({
  pixSection: { width: '100%', alignItems: 'center', gap: 12, marginTop: 4 },
  qrContainer: { alignItems: 'center' },
  qrWrap: {
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 3, borderColor: '#fff',
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 10,
  },
  qrLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 7, textAlign: 'center' },
  qrName: { color: 'rgba(255,255,255,0.35)', fontSize: 10, textAlign: 'center', marginTop: 3 },
  pixInfo: { width: '100%', alignItems: 'center' },
  priceCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', backgroundColor: 'rgba(76,175,80,0.1)',
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)', marginBottom: 10,
  },
  priceLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  priceValue: { color: '#4CAF50', fontSize: 20, fontWeight: '900' },
  pixKeyCard: {
    width: '100%', backgroundColor: 'rgba(229,0,0,0.08)',
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)',
    alignItems: 'center', marginBottom: 12,
  },
  pixKeyLabel: {
    color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5,
  },
  pixKey: { color: Colors.primary, fontSize: 16, fontWeight: '900', textAlign: 'center', letterSpacing: 0.5 },
  pixInstructions: { color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center', marginBottom: 10, lineHeight: 18 },
  whatsappBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#25D366', borderRadius: 12, height: 50, width: '100%',
    marginBottom: 8,
    shadowColor: '#25D366', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  whatsappBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  phoneLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  phoneLinkText: { color: Colors.textMuted, fontSize: 12 },
});

// ── Screen styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 24 },
  logoWrap: { marginBottom: 6 },
  logo: { width: isTV ? 130 : 100, height: isTV ? 130 : 100, borderRadius: 22 },
  brand: {
    color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: 4,
    textShadowColor: Colors.primary, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16,
    marginBottom: 16,
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(18,18,18,0.98)',
    borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: 'rgba(229,0,0,0.22)',
    alignItems: 'center', marginBottom: 14,
  },
  warningBadge: {
    width: 66, height: 66, borderRadius: 33,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: { color: '#fff', fontSize: isTV ? 22 : 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  cardMessage: { color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  blockReasonCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(229,0,0,0.08)', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)', width: '100%', marginBottom: 14,
  },
  blockReasonLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 },
  blockReasonValue: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  divider: { width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 14 },
  pixSectionTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: 10, textAlign: 'center' },
  pixFooter: { color: 'rgba(255,255,255,0.45)', fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 12 },

  // Grace
  graceSection: { width: '100%', alignItems: 'center' },
  graceTitle: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  graceSubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 14 },
  graceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(229,0,0,0.7)', borderRadius: 12, height: 48, width: '100%',
    borderWidth: 1, borderColor: Colors.primary,
  },
  graceBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  graceUsedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  graceUsedText: { color: Colors.textMuted, fontSize: 12 },

  // Bottom actions
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, height: 46, width: '100%',
    borderWidth: 1.5, borderColor: 'rgba(229,0,0,0.4)', marginBottom: 10,
  },
  refreshBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  logoutLink: { paddingVertical: 10 },
  logoutLinkText: { color: Colors.textMuted, fontSize: 13 },
});
