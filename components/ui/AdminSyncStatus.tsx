import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BorderRadius, Colors, FontSize, Spacing } from '@/constants/theme';

interface AdminSyncStatusProps {
  loading: boolean;
  error: string;
  onRetry: () => void;
  metadataLoading?: boolean;
  lastSyncedAt?: string | null;
}
export const AdminSyncStatus = memo(function AdminSyncStatus({ loading, error, onRetry, metadataLoading = false, lastSyncedAt = null }: AdminSyncStatusProps) {
  if (!loading && !error && !metadataLoading && !lastSyncedAt) return null;
  const hasMessage = loading || !!error || metadataLoading;
  const updatedDate = lastSyncedAt ? new Date(lastSyncedAt) : null;
  const updatedTime = updatedDate && Number.isFinite(updatedDate.getTime()) ? updatedDate.toLocaleTimeString('pt-BR') : null;
  // Healthy background synchronization should not occupy a full card above the clients.
  if (!hasMessage) return updatedTime ? (
    <View style={styles.statusLine}>
      <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />
      <Text style={styles.statusText}>Atualizado automaticamente · {updatedTime}</Text>
    </View>
  ) : null;
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      {hasMessage ? (
        <View style={styles.messageRow}>
          {error ? <Ionicons name="alert-circle-outline" size={20} color={Colors.warning} /> : <ActivityIndicator size="small" color={Colors.primary} />}
          <Text style={styles.message}>{error || (loading ? 'Carregando clientes...' : 'Carregando fontes e informações do painel...')}</Text>
        </View>
      ) : null}
      {updatedTime ? (
        <View style={styles.updatedRow}>
          <Ionicons name={error ? 'time-outline' : 'checkmark-circle-outline'} size={18} color={error ? Colors.warning : Colors.success} />
          <Text style={styles.updatedText}>Sincronização automática · última leitura: {updatedTime}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.message}>Se a falta de resposta persistir nos dois painéis, encaminhe os horários da falha ao suporte: contact@onspace.ai.</Text> : null}
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
  statusLine: { marginHorizontal: Spacing.md, paddingVertical: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusText: { flex: 1, color: Colors.textMuted, fontSize: FontSize.md, includeFontPadding: false },
  panel: { margin: Spacing.md, padding: Spacing.md, backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  message: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 26, includeFontPadding: false },
  retry: { minHeight: 48, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryDark, borderRadius: BorderRadius.md },
  retryText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600', includeFontPadding: false },
  updatedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  updatedText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 26, includeFontPadding: false },
  dimmed: { opacity: 0.65 },
});
