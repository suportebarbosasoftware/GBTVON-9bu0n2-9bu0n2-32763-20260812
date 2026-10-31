import { applyConfirmedDeviceChange, applyConfirmedDeviceBlocks, buildConfirmedPanelOverview } from './panelStateService.ts';

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const now = Date.UTC(2026, 9, 28, 12);
const fixture = { id: 'device-a', activated: true, blocked_reason: null as string | null,
  created_at: new Date(now).toISOString(), last_seen_at: new Date(now).toISOString(),
  current_content: 'Channel' as string | null, current_content_at: new Date(now).toISOString() as string | null };

Deno.test('server-confirmed block updates totals without changing the source snapshot', () => {
  const original = [fixture];
  const before = JSON.stringify(original);
  const blocked = { ...fixture, activated: false, blocked_reason: 'manual', current_content: null, current_content_at: null };
  const next = applyConfirmedDeviceChange(original, blocked);
  const overview = buildConfirmedPanelOverview(next, 2, now);
  assert(overview.stats.active === 0 && overview.stats.blocked === 1, 'Block not reflected in totals');
  assert(overview.watchingNow.length === 0, 'Blocked content remained visible');
  assert(JSON.stringify(original) === before, 'Input snapshot was mutated');
});

Deno.test('server-confirmed deletion removes only acknowledged IDs', () => {
  const another = { ...fixture, id: 'device-b' };
  const next = applyConfirmedDeviceChange([fixture, another], null, ['device-a']);
  assert(next.length === 1 && next[0].id === 'device-b', 'Unrelated client was removed');
});

Deno.test('bulk block patches only acknowledged MACs and preserves their assignments', () => {
  const first = { ...fixture, plan_id: 'plan-a', source_id: 'source-a', price: 29.9 };
  const second = { ...first, id: 'device-b' };
  const original = [first, second];
  const before = JSON.stringify(original);
  const next = applyConfirmedDeviceBlocks(original, { blockedIds: ['device-a'], blockedCount: 1,
    blockedAt: new Date(now).toISOString(), reasonDetail: 'Atualize o aplicativo.', adminId: null });
  assert(!next[0].activated && next[0].blocked_reason === 'manual' && next[0].current_content === null, 'Acknowledged MAC not blocked');
  assert(next[1] === second && second.activated, 'Unacknowledged MAC was changed');
  assert(next[0].plan_id === 'plan-a' && next[0].source_id === 'source-a' && next[0].price === 29.9, 'Assignment or price was removed');
  assert(JSON.stringify(original) === before, 'Input snapshot was mutated');
  const overview = buildConfirmedPanelOverview(next, 2, now);
  assert(overview.stats.blocked === 1 && overview.stats.active === 1 && overview.stats.watching === 1, 'Bulk totals are incorrect');
});

Deno.test('server-confirmed source change replaces one row without duplicates', () => {
  const source = { ...fixture, source_id: 'old-source' };
  const next = applyConfirmedDeviceChange([source], { ...source, source_id: 'new-source' });
  assert(next.length === 1 && next[0].source_id === 'new-source', 'Source change was not applied');
});
