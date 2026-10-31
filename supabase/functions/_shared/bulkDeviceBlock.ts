/** One confirmed bulk update, restricted to the authenticated administrator's network. */
export async function blockScopedDevices(client: any, adminId: string | null, reasonDetail: string) {
  const blockedAt = new Date().toISOString();
  const query = client.from('devices').update({
    activated: false,
    blocked_reason: 'manual',
    block_reason_detail: reasonDetail,
    blocked_at: blockedAt,
    updated_at: blockedAt,
    current_content: null,
    current_content_type: null,
    current_content_at: null,
  }, { count: 'exact' });
  // Root keeps its existing scope; sub-admin networks must never be included implicitly.
  const scoped = adminId === null ? query.is('admin_id', null) : query.eq('admin_id', adminId);
  const { data, error, count } = await scoped.select('id');
  if (error) throw error;
  if (!Array.isArray(data) || !Number.isInteger(count) || count < data.length ||
      data.some((row: any) => typeof row?.id !== 'string' || !row.id)) {
    throw new Error('O banco não confirmou o bloqueio em lote. Atualize o painel antes de repetir.');
  }
  // The database updates every matching row, regardless of the response row limit.
  // Only acknowledged IDs are patched locally; automatic sync retrieves any remaining rows.
  return { success: true, blockedIds: data.map((row: { id: string }) => row.id),
    blockedCount: count, blockedAt, reasonDetail, adminId };
}
