/**
 * DevDPad — GBTVON
 * Painel de teste de foco visual — disponível globalmente em todas as abas.
 *
 * Em Android TV: usa o controle físico; este painel confirma se o indicador
 * visual (borda vermelha nativa) está seguindo o foco real do sistema.
 *
 * Em celular/web: os alvos respondem ao toque com feedback visual imediato.
 */
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TVFocusable from '@/components/ui/TVFocusable';
import { IS_TV } from '@/hooks/useTV';
import { useDevMode } from '@/contexts/DevModeContext';

// ── Focus Test Target ────────────────────────────────────────────────────────
// Mostra feedback visual tanto no foco nativo (TV) quanto no toque (celular).

function FocusTarget({ label, hasTVPreferredFocus = false }: { label: string; hasTVPreferredFocus?: boolean }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const active = focused || pressed;

  return (
    <TVFocusable
      style={[
        styles.focusTarget,
        active && styles.focusTargetActive,
      ]}
      focusedStyle={{ borderColor: '#E50000', backgroundColor: 'rgba(229,0,0,0.25)' }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => {
        setPressed(true);
        setTimeout(() => setPressed(false), 300);
        Alert.alert('Foco OK', `${label} respondeu ao foco!`);
      }}
    >
      <Ionicons
        name={active ? 'radio-button-on' : 'radio-button-off'}
        size={14}
        color={active ? '#E50000' : 'rgba(255,255,255,0.4)'}
      />
      <Text style={[styles.focusTargetText, active && { color: '#E50000', fontWeight: '900' }]}>
        {label}
      </Text>
    </TVFocusable>
  );
}

// ── Main D-Pad Component ─────────────────────────────────────────────────────

export default function DevDPad() {
  const { disableDevMode } = useDevMode();
  const [lastDir, setLastDir] = useState<string | null>(null);
  const feedbackAnim = useRef(new Animated.Value(1)).current;

  function animateFeedback() {
    feedbackAnim.setValue(0.88);
    Animated.spring(feedbackAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  }

  function pressDir(direction: string) {
    setLastDir(direction);
    animateFeedback();
  }

  const iconColor = '#E50000';
  const btnBase: any = {
    width: 52,
    height: 52,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(229,0,0,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(229,0,0,0.5)',
  };
  const btnCenter: any = {
    ...btnBase,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(229,0,0,0.28)',
  };

  const dirLabels: Record<string, string> = {
    up: '↑', down: '↓', left: '←', right: '→', ok: 'OK',
  };

  return (
    <View style={styles.container}>
      {/* Backdrop */}
      <View style={styles.backdrop} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.devBadge}>
          <Ionicons name="bug-outline" size={11} color="#E50000" />
          <Text style={styles.devBadgeText}> MODO DESENVOLVEDOR — TESTE DE FOCO</Text>
        </View>
        <Pressable onPress={disableDevMode} hitSlop={14} style={styles.closeBtn}>
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* D-Pad */}
        <View style={styles.dpadSection}>
          <Text style={styles.sectionLabel}>
            {IS_TV ? 'Use o controle físico ↑↓←→' : 'Simule teclas do controle'}
          </Text>

          <Animated.View style={[styles.dpad, { transform: [{ scale: feedbackAnim }] }]}>
            <View style={styles.dpadRow}>
              <Pressable style={btnBase} onPress={() => pressDir('up')}>
                <Ionicons name="chevron-up" size={24} color={iconColor} />
              </Pressable>
            </View>
            <View style={styles.dpadRowMid}>
              <Pressable style={btnBase} onPress={() => pressDir('left')}>
                <Ionicons name="chevron-back" size={24} color={iconColor} />
              </Pressable>
              <Pressable style={btnCenter} onPress={() => pressDir('ok')}>
                <Text style={styles.okText}>OK</Text>
              </Pressable>
              <Pressable style={btnBase} onPress={() => pressDir('right')}>
                <Ionicons name="chevron-forward" size={24} color={iconColor} />
              </Pressable>
            </View>
            <View style={styles.dpadRow}>
              <Pressable style={btnBase} onPress={() => pressDir('down')}>
                <Ionicons name="chevron-down" size={24} color={iconColor} />
              </Pressable>
            </View>
          </Animated.View>

          {lastDir ? (
            <View style={styles.lastDirRow}>
              <Text style={styles.lastDirLabel}>Última tecla:</Text>
              <View style={styles.lastDirBadge}>
                <Text style={styles.lastDirText}>{dirLabels[lastDir] ?? lastDir}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Focus targets */}
        <View style={styles.targetsSection}>
          <Text style={styles.sectionLabel}>
            {IS_TV
              ? 'Navegue com D-Pad → deve acender em vermelho'
              : 'Toque → deve acender em vermelho'}
          </Text>
          <View style={styles.focusTargets}>
            <FocusTarget label="Alvo 1" hasTVPreferredFocus />
            <FocusTarget label="Alvo 2" />
            <FocusTarget label="Alvo 3" />
          </View>

          <Text style={styles.hint}>
            {IS_TV
              ? 'Se o indicador vermelho não se mover com o controle, o foco nativo não está chegando ao componente.'
              : 'No celular o foco é por toque — pressione cada alvo para ver o indicador vermelho.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.4)',
    overflow: 'hidden',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,0,0,0.96)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(229,0,0,0.15)',
  },
  devBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  devBadgeText: {
    color: '#E50000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 20,
    alignItems: 'flex-start',
  },
  dpadSection: {
    alignItems: 'center',
    gap: 8,
  },
  targetsSection: {
    flex: 1,
    gap: 8,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  dpad: {
    alignItems: 'center',
    gap: 4,
  },
  dpadRow: {
    alignItems: 'center',
    marginVertical: 2,
  },
  dpadRowMid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  okText: {
    color: '#E50000',
    fontSize: 15,
    fontWeight: '900',
  },
  lastDirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  lastDirLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
  },
  lastDirBadge: {
    backgroundColor: 'rgba(229,0,0,0.2)',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.5)',
  },
  lastDirText: {
    color: '#E50000',
    fontSize: 15,
    fontWeight: '900',
  },
  focusTargets: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  focusTarget: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    minWidth: 80,
  },
  focusTargetActive: {
    borderColor: '#E50000',
    backgroundColor: 'rgba(229,0,0,0.18)',
  },
  focusTargetText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '700',
  },
  hint: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 10,
    lineHeight: 14,
    fontStyle: 'italic',
  },
});
