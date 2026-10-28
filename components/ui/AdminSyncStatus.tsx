import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BorderRadius, Colors, FontSize, Spacing } from '@/constants/theme';

interface AdminSyncStatusProps {
  loading: boolean;
  error: string;
  onRetry: () => void;
}
export const AdminSyncStatus = memo(function AdminSyncStatus({ loading, error, onRetry }: AdminSyncStatusProps) {
  if (!loading && !error) return null;
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      <View style={styles.messageRow}>
        {error ? <Ionicons name="alert-circle-outline" size={20} color={Colors.warning} /> : <ActivityIndicator size="small" color={Colors.primary} />}
        <Text style={styles.message}>{error || 'Atualizando o painel. As listas aparecem assim que cada consulta termina.'}</Text>
      </View>
      {error ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel="Tentar atualizar o painel novamente"
          disabled={loading} onPress={onRetry}
          style={({ pressed }) => [styles.retry, (pressed || loading) ? styles.dimmed : null]}
        >
          <Ionicons name="refresh-outline" size={18} color={Colors.textPrimary} />
          <Text style={styles.retryText}>{loading ? 'Atualizando' : 'Tentar novamente'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});
const styles = StyleSheet.create({
  panel: { margin: Spacing.md, padding: Spacing.md, backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  message: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 26, includeFontPadding: false },
  retry: { minHeight: 48, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryDark, borderRadius: BorderRadius.md },
  retryText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600', includeFontPadding: false },
  dimmed: { opacity: 0.65 },
});
