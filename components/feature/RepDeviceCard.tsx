import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RepDevice } from '@/services/repApiService';
import { BorderRadius, Colors, FontSize, Spacing } from '@/constants/theme';

interface RepDeviceCardProps {
  device: RepDevice;
  online: boolean;
  onOpen: (device: RepDevice) => void;
  onCopy: (mac: string) => void;
}
export const RepDeviceCard = memo(function RepDeviceCard({ device, online, onOpen, onCopy }: RepDeviceCardProps) {
  const statusColor = device.blocked_reason ? Colors.error : online ? Colors.success : device.activated ? Colors.success : Colors.warning;
  const status = device.blocked_reason ? 'Bloqueado' : online ? 'Online' : device.activated ? 'Ativo' : 'Pendente';
  const expired = !!device.expires_at && new Date(device.expires_at).getTime() < Date.now();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`Abrir cliente ${device.client_name || device.mac_address}`}
      onPress={() => onOpen(device)} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={[styles.dot, { backgroundColor: statusColor }]} />
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{device.client_name || 'Cliente sem nome'}</Text>
        <View style={styles.macRow}>
          <Text style={styles.mac} numberOfLines={1}>{device.mac_address}</Text>
          <Pressable
            accessibilityRole="button" accessibilityLabel={`Copiar MAC ${device.mac_address}`}
            style={({ pressed }) => [styles.copy, pressed ? styles.pressed : null]}
            onPress={event => { event.stopPropagation(); onCopy(device.mac_address); }}
          >
            <Ionicons name="copy-outline" size={18} color={Colors.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.meta}>
          <Text style={[styles.status, { color: statusColor }]}>{status}</Text>
          {device.activated && !device.blocked_reason && device.expires_at ? (
            <Text style={[styles.expiry, { color: expired ? Colors.error : Colors.textSecondary }]}>
              {expired ? 'Expirado' : `Vence ${new Date(device.expires_at).toLocaleDateString('pt-BR')}`}
            </Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward-outline" size={18} color={Colors.textSecondary} />
    </Pressable>
  );
});
const styles = StyleSheet.create({
  card: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, padding: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  content: { flex: 1 },
  dot: { width: Spacing.sm, height: Spacing.sm, borderRadius: BorderRadius.full },
  name: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700', includeFontPadding: false },
  macRow: { flexDirection: 'row', alignItems: 'center' },
  mac: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, fontFamily: 'monospace', includeFontPadding: false },
  copy: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: BorderRadius.sm, backgroundColor: Colors.bgCardElevated },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  status: { fontSize: FontSize.sm, fontWeight: '600', includeFontPadding: false },
  expiry: { fontSize: FontSize.sm, includeFontPadding: false },
  pressed: { opacity: 0.65 },
});
