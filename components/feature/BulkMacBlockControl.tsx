import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';
import { useBulkMacBlock } from '@/hooks/useBulkMacBlock';

interface BulkMacBlockControlProps {
  isSubAdmin: boolean;
}

export const BulkMacBlockControl = memo(function BulkMacBlockControl({ isSubAdmin }: BulkMacBlockControlProps) {
  const { blocking, canBlock, requestBlockAll } = useBulkMacBlock();
  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Ionicons name="shield-outline" size={20} color={Colors.error} />
        <Text style={styles.title}>Bloqueio de toda a rede</Text>
      </View>
      <Text style={styles.description}>
        Inclui MACs dos representantes e mantém fontes e cadastros. {isSubAdmin ? 'Não altera outras redes.' : 'Não altera redes de sub-admins.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Bloquear todas as MACs desta rede"
        accessibilityState={{ disabled: !canBlock || blocking, busy: blocking }}
        disabled={!canBlock || blocking}
        onPress={requestBlockAll}
        style={({ pressed }) => [styles.button, { opacity: !canBlock || blocking || pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      >
        {blocking ? <ActivityIndicator color={Colors.textPrimary} size="small" /> : <Ionicons name="ban-outline" size={20} color={Colors.textPrimary} />}
        <Text style={styles.buttonText}>{blocking ? 'Bloqueando MACs...' : 'Bloquear todas as MACs'}</Text>
      </Pressable>
      <Text style={styles.note}>Exige confirmação. O app antigo aplica o bloqueio na próxima validação de acesso.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.bgCardElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.lg },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: '600', includeFontPadding: false, flex: 1 },
  description: { color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 26, includeFontPadding: false },
  button: { minHeight: 48, backgroundColor: Colors.primaryDark, borderRadius: BorderRadius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginTop: Spacing.sm },
  buttonText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600', includeFontPadding: false },
  note: { color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 26, includeFontPadding: false },
});
