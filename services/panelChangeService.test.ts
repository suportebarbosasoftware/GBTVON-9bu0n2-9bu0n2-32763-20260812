// Run with: deno test services/panelChangeService.test.ts
// @ts-ignore Deno supports explicit .ts imports.
import { getPanelScopeKey, publishPanelMutation, subscribePanelChanges } from './panelChangeService.ts';
// @ts-ignore Deno supports explicit .ts type imports.
import type { PanelChange } from './panelChangeService.ts';

declare const Deno: { test: (name: string, test: () => Promise<void>) => void };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 10));

Deno.test('block/delete changes coalesce and refresh the matching representative only', async () => {
  const received: PanelChange[] = [];
  const session = { repId: 'rep-a', repPassword: 'fixture-password' };
  const other = { repId: 'rep-b', repPassword: 'fixture-password' };
  const unsubscribe = subscribePanelChanges(change => {
    if (change.scopeKey === getPanelScopeKey(session)) received.push(change);
  });
  try {
    publishPanelMutation({ ...session, action: 'blockRepDevice' });
    publishPanelMutation({ ...session, action: 'deleteRepDevice' });
    publishPanelMutation({ ...other, action: 'renewRepDevice' });
    await flush();
    assert(received.length === 1 && received[0].sections.includes('devices') && received[0].sections.includes('sources'), 'The panel missed a change or accepted another network.');
  } finally { unsubscribe(); }
});

Deno.test('root, sub-admin and old session notifications remain isolated', async () => {
  const current = { adminId: 'sub-a', sessionToken: 'new-fixture' };
  const received: PanelChange[] = [];
  const unsubscribe = subscribePanelChanges(change => { if (change.scopeKey === getPanelScopeKey(current)) received.push(change); });
  try {
    publishPanelMutation({ rootSessionToken: 'root-fixture', action: 'delete_device' });
    publishPanelMutation({ adminId: 'sub-a', sessionToken: 'old-fixture', action: 'block_device' });
    publishPanelMutation({ ...current, action: 'save_device' });
    await flush();
    assert(received.length === 1, 'Root or stale session notified the sub-admin panel.');
  } finally { unsubscribe(); }
});

Deno.test('login and content reporting do not cause mutation synchronization loops', async () => {
  let received = 0;
  const unsubscribe = subscribePanelChanges(() => { received += 1; });
  try {
    publishPanelMutation({ action: 'rootAdminLogin', rootSessionToken: 'fixture' });
    publishPanelMutation({ action: 'get_panel_snapshot', rootSessionToken: 'fixture' });
    publishPanelMutation({ action: 'update_current_content', rootSessionToken: 'fixture' });
    await flush(); assert(received === 0, 'A read/login/content heartbeat caused a refresh loop.');
  } finally { unsubscribe(); }
});
