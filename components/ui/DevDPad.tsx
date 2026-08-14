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

function FocusTarget({ label, hasTVPreferredFocus }: { label: string; hasTVPreferredFocus?: boolean }) {
  const [active, setActive] = useState(false);

  return (
    <TVFocusable
      style={[styles.focusTarget, active && styles.focusTargetActive]}
      focusedStyle={{ borderColor: '#E50000', backgroundColor: 'rgba(229,0,0,0.25)' }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      onPress={() => {
        setActive(true);
        setTimeout(() => setActive(false), 300);
        Alert.alert('Foco OK', label + ' respondeu!');
      }}
    >
      <Ionicons
        name={active ? 'radio-button-on' : 'radio-button-off'}
        size={14}
        color={active ? '#E50000' : 'rgba(255,255,255,0.4)'}
      />
      <Text style={[styles.focusTargetText, active && styles.focusTargetTextActive]}>
        {label}
      </Text>
    </TVFocusable>
  );
}

// ── Main D-Pad Component ─────────────────────────────────────────────────────

export default function DevDPad() {
  const { toggleDevMode } = useDevMode();
  const [lastDir, setLastDir] = useState('');
  const scaleAnim = useRef(new Animated.Value(1)).current;

  function pressDir(dir: string) {
    setLastDir(dir);
    scaleAnim.setValue(0.9);
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  }

  const btnStyle: object = {
    width: 52,
    height: 52,
    borderRadius: 13,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(229,0,0,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(229,0,0,0.5)',
  };

  const centerStyle: object = {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(229,0,0,0.28)',
    borderWidth: 1.5,
    borderColor: 'rgba(229,0,0,0.5)',
  };

  const LABELS: Record<string, string> = {
    up: '\u2191', down: '\u2193', left: '\u2190', right: '\u2192', ok: 'OK',
  };

  return (
    <View style={styles.container}>
      <View style={styles.backdrop} />

      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="bug-outline" size={11} color="#E50000" />
        <Text style={styles.headerText}> MODO DESENVOLVEDOR — TESTE DE FOCO</Text>
        <Pressable onPress={toggleDevMode} hitSlop={14} style={styles.closeBtn}>
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* D-Pad */}
        <View style={styles.dpadSection}>
          <Text style={styles.sectionLabel}>
            {IS_TV ? 'Use o controle fisico' : 'Simule o controle'}
          </Text>
          <Animated.View style={[styles.dpad, { transform: [{ scale: scaleAnim }] }]}>
            <View style={styles.dpadRow}>
              <Pressable style={btnStyle} onPress={() => pressDir('up')}>
                <Ionicons name="chevron-up" size={22} color="#E50000" />
              </Pressable>
            </View>
            <View style={styles.dpadMid}>
              <Pressable style={btnStyle} onPress={() => pressDir('left')}>
                <Ionicons name="chevron-back" size={22} color="#E50000" />
              </Pressable>
              <Pressable style={centerStyle} onPress={() => pressDir('ok')}>
                <Text style={styles.okText}>OK</Text>
              </Pressable>
              <Pressable style={btnStyle} onPress={() => pressDir('right')}>
                <Ionicons name="chevron-forward" size={22} color="#E50000" />
              </Pressable>
            </View>
            <View style={styles.dpadRow}>
              <Pressable style={btnStyle} onPress={() => pressDir('down')}>
                <Ionicons name="chevron-down" size={22} color="#E50000" />
              </Pressable>
            </View>
          </Animated.View>
          {lastDir ? (
            <View style={styles.lastRow}>
              <Text style={styles.lastLabel}>Ultima:</Text>
              <View style={styles.lastBadge}>
                <Text style={styles.lastText}>{LABELS[lastDir] || lastDir}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Focus targets */}
        <View style={styles.targetsSection}>
          <Text style={styles.sectionLabel}>
            {IS_TV ? 'Navegue com D-Pad -> vermelho' : 'Toque -> deve acender vermelho'}
          </Text>
          <View style={styles.targets}>
            <FocusTarget label="Alvo 1" hasTVPreferredFocus />
            <FocusTarget label="Alvo 2" />
            <FocusTarget label="Alvo 3" />
          </View>
          <Text style={styles.hint}>
            {IS_TV
              ? 'Se o indicador nao se mover com o controle, o foco nativo nao esta chegando ao componente.'
              : 'No celular o foco e por toque. Pressione cada alvo.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.4)',
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,0,0,0.96)',
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
  headerText: {
    color: '#E50000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    flex: 1,
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
  dpadMid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  okText: {
    color: '#E50000',
    fontSize: 15,
    fontWeight: '900',
  },
  lastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  lastLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
  },
  lastBadge: {
    backgroundColor: 'rgba(229,0,0,0.2)',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.5)',
  },
  lastText: {
    color: '#E50000',
    fontSize: 15,
    fontWeight: '900',
  },
  targets: {
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
  focusTargetTextActive: {
    color: '#E50000',
    fontWeight: '900',
  },
  hint: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 10,
    lineHeight: 14,
    fontStyle: 'italic',
  },
});
