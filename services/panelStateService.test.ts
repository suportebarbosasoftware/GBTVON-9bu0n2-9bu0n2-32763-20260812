import { applyConfirmedDeviceChange, buildConfirmedPanelOverview } from './panelStateService.ts';

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

Deno.test('server-confirmed source change replaces one row without duplicates', () => {
  const source = { ...fixture, source_id: 'old-source' };
  const next = applyConfirmedDeviceChange([source], { ...source, source_id: 'new-source' });
  assert(next.length === 1 && next[0].source_id === 'new-source', 'Source change was not applied');
});
