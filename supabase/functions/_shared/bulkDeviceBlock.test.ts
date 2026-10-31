import { blockScopedDevices } from './bulkDeviceBlock.ts';

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function fixture(response: any) {
  const calls: { table?: string; updates?: any; options?: any; scope?: unknown[]; columns?: string } = {};
  const query = {
    is: (field: string, value: unknown) => { calls.scope = ['is', field, value]; return query; },
    eq: (field: string, value: unknown) => { calls.scope = ['eq', field, value]; return query; },
    select: async (columns: string) => { calls.columns = columns; return response; },
  };
  const client = { from: (table: string) => { calls.table = table; return {
    update: (updates: any, options: any) => { calls.updates = updates; calls.options = options; return query; },
  }; } };
  return { client, calls };
}

Deno.test('root bulk block preserves sub-admin isolation and source credentials', async () => {
  const { client, calls } = fixture({ data: [{ id: 'root-device' }], error: null, count: 1 });
  const result = await blockScopedDevices(client, null, 'Atualize o aplicativo.');
  assert(JSON.stringify(calls.scope) === JSON.stringify(['is', 'admin_id', null]), 'Root scope was widened');
  assert(calls.table === 'devices' && calls.updates.activated === false && calls.updates.blocked_reason === 'manual', 'Manual block missing');
  assert(calls.updates.current_content === null && calls.updates.current_content_type === null && calls.updates.current_content_at === null, 'Watching state not cleared');
  assert(!('plan_id' in calls.updates) && !('source_id' in calls.updates) && !('expires_at' in calls.updates), 'Source or subscription data was changed');
  assert(result.blockedCount === 1 && result.adminId === null && result.blockedIds[0] === 'root-device', 'Confirmation missing');
});

Deno.test('sub-admin bulk block uses only the resolved server identity', async () => {
  const { client, calls } = fixture({ data: [{ id: 'sub-device' }], error: null, count: 1 });
  await blockScopedDevices(client, 'sub-admin-id', 'Atualize o aplicativo.');
  assert(JSON.stringify(calls.scope) === JSON.stringify(['eq', 'admin_id', 'sub-admin-id']), 'Sub-admin escaped its scope');
});

Deno.test('exact count includes all blocked rows when returned IDs are capped', async () => {
  const { client, calls } = fixture({ data: [{ id: 'acknowledged-device' }], error: null, count: 1500 });
  const result = await blockScopedDevices(client, null, 'Atualize o aplicativo.');
  assert(calls.options.count === 'exact' && result.blockedCount === 1500 && result.blockedIds.length === 1, 'Bulk block depends on response row limit');
});

Deno.test('failed bulk block never returns a success receipt', async () => {
  const { client } = fixture({ data: null, error: new Error('write_failed'), count: null });
  let failed = false;
  try { await blockScopedDevices(client, null, 'Atualize o aplicativo.'); } catch { failed = true; }
  assert(failed, 'Failed write reported success');
});
