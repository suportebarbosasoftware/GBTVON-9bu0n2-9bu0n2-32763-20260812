import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { verifyParentalPin } from '@/services/channelFilterService';
import TVFocusable from '@/components/ui/TVFocusable';

export default function AdultPinModal({ visible, onCancel, onUnlock }: {
  visible: boolean;
  onCancel: () => void;
  onUnlock: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const close = () => { setPin(''); setError(''); onCancel(); };
  const confirm = async () => {
    if (!(await verifyParentalPin(pin))) { setError('PIN incorreto'); return; }
    setPin(''); setError(''); onUnlock();
  };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}><View style={styles.sheet}>
      <Ionicons name="lock-closed" size={34} color={Colors.primary} />
      <Text style={styles.title}>Conteúdo adulto protegido</Text>
      <Text style={styles.sub}>Digite o PIN para abrir esta categoria</Text>
      <View style={styles.dots}>{[0, 1, 2, 3].map(index => <View key={index} style={[styles.dot, pin.length > index && styles.dotFilled]} />)}</View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.grid}>{['1','2','3','4','5','6','7','8','9','⌫','0','OK'].map(key => <TVFocusable key={key} style={[styles.key, key === 'OK' && styles.ok]} onPress={() => {
        if (key === 'OK') { void confirm(); return; }
        if (key === '⌫') { setPin(value => value.slice(0, -1)); setError(''); return; }
        if (pin.length < 4) { setPin(value => value + key); setError(''); }
      }}><Text style={styles.keyText}>{key}</Text></TVFocusable>)}</View>
      <TVFocusable style={styles.cancel} onPress={close}><Text style={styles.cancelText}>Cancelar</Text></TVFocusable>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.84)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 390, borderRadius: 18, padding: 24, alignItems: 'center', backgroundColor: '#151515', borderWidth: 1, borderColor: 'rgba(229,0,0,0.45)' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 }, sub: { color: Colors.textSecondary, marginTop: 6, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 14, marginVertical: 18 }, dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' }, dotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary }, error: { color: Colors.error, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }, key: { width: 82, height: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292929' }, ok: { backgroundColor: Colors.primary }, keyText: { color: '#fff', fontSize: 18, fontWeight: '700' }, cancel: { paddingHorizontal: 24, paddingVertical: 12, marginTop: 12 }, cancelText: { color: Colors.textSecondary, fontWeight: '700' },
});
