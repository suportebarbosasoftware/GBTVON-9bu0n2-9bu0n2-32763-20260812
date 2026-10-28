/** In-memory mutation notifications. Authentication keys stay private and are never logged or persisted. */
export type PanelChangeSection = 'devices' | 'plans' | 'sources' | 'reps' | 'notifications' | 'subAdmins';
export interface PanelChange { scopeKey: string; sections: PanelChangeSection[]; }
type Listener = (change: PanelChange) => void;
const listeners = new Set<Listener>();
const scheduled = new Map<string, { sections: Set<PanelChangeSection>; timer: ReturnType<typeof setTimeout> }>();

const affected: Record<string, PanelChangeSection[]> = {
  save_device: ['devices', 'plans', 'sources', 'reps'], activate_device: ['devices', 'plans', 'sources', 'reps'],
  deactivate_device: ['devices', 'plans', 'sources', 'reps'], block_device: ['devices', 'plans', 'sources', 'reps'],
  delete_device: ['devices', 'plans', 'sources', 'reps'], delete_devices_bulk: ['devices', 'plans', 'sources', 'reps'],
  delete_inactive_devices: ['devices', 'plans', 'sources', 'reps'], grant_grace_period: ['devices', 'plans', 'sources', 'reps'],
  update_device_notes: ['devices'], set_device_expiry: ['devices'], set_device_price: ['devices'],
  pre_authorize_email: ['devices', 'plans'],
  activateRepDevice: ['devices', 'sources'], activateRepTest: ['devices', 'sources'],
  renewRepDevice: ['devices', 'sources'], deactivateRepDevice: ['devices', 'sources'],
  blockRepDevice: ['devices', 'sources'], unblockRepDevice: ['devices', 'sources'],
  deleteRepDevice: ['devices', 'sources'], changeRepDeviceSource: ['devices', 'sources'], updateRepDevicePrice: ['devices'],
  create_plan: ['plans'], update_plan: ['plans', 'devices'], delete_plan: ['plans', 'devices'],
  createSource: ['sources', 'plans'], updateSource: ['sources', 'devices'], deleteSource: ['sources', 'devices'],
  createRepresentative: ['reps'], updateRepresentative: ['reps', 'devices', 'sources'], deleteRepresentative: ['reps', 'devices', 'sources'],
  addCredits: ['reps'], removeCredits: ['reps'],
  send_notification: ['notifications'], delete_notification: ['notifications'],
  createSubAdmin: ['subAdmins'], updateSubAdmin: ['subAdmins'], deleteSubAdmin: ['subAdmins', 'devices', 'reps', 'sources', 'plans'],
};

export function getPanelScopeKey(body: Record<string, unknown>): string | null {
  if (typeof body.repId === 'string' && typeof body.repPassword === 'string' && body.repId && body.repPassword) {
    return JSON.stringify(['rep', body.repId, body.repPassword]);
  }
  if (typeof body.adminId === 'string' && typeof body.sessionToken === 'string' && body.adminId && body.sessionToken) {
    return JSON.stringify(['admin', body.adminId, body.sessionToken]);
  }
  if (typeof body.rootSessionToken === 'string' && body.rootSessionToken) return JSON.stringify(['root', body.rootSessionToken]);
  if (typeof body.adminPassword === 'string' && body.adminPassword) return JSON.stringify(['legacy-root', body.adminPassword]);
  return null;
}

export function subscribePanelChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      for (const item of scheduled.values()) clearTimeout(item.timer);
      scheduled.clear();
    }
  };
}

export function publishPanelMutation(body: Record<string, unknown>): void {
  const sections = affected[String(body.action ?? '')];
  const scopeKey = getPanelScopeKey(body);
  if (!sections || !scopeKey || !listeners.size) return;
  const existing = scheduled.get(scopeKey);
  if (existing) { for (const section of sections) existing.sections.add(section); return; }
  // Next task: action hooks can first publish their confirmed row, without racing a full snapshot.
  const pending: { sections: Set<PanelChangeSection>; timer: ReturnType<typeof setTimeout> } = { sections: new Set(sections), timer: setTimeout(() => {
    scheduled.delete(scopeKey);
    for (const listener of listeners) {
      try { listener({ scopeKey, sections: Array.from(pending.sections) }); }
      catch { console.warn('[panel-sync] notification_failed'); }
    }
  }, 0) };
  scheduled.set(scopeKey, pending);
}
