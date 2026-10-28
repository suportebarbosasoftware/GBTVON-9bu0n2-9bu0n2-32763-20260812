/** Pure processing of server-confirmed changes. Never assumes a write succeeded. */
export interface PanelDeviceState {
  id: string;
  activated: boolean | null;
  blocked_reason?: string | null;
  created_at: string;
  last_seen_at?: string | null;
  current_content?: string | null;
  current_content_at?: string | null;
}

export function applyConfirmedDeviceChange<T extends PanelDeviceState>(
  devices: T[], updated: T | null, removedIds: string[] = [],
): T[] {
  const removed = new Set(removedIds);
  const next = devices.filter(device => !removed.has(device.id));
  if (!updated) return next;
  const index = next.findIndex(device => device.id === updated.id);
  if (index < 0) return [updated, ...next];
  next[index] = { ...next[index], ...updated };
  return next;
}

export function buildConfirmedPanelOverview<T extends PanelDeviceState>(devices: T[], plans = 0, now = Date.now()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const watchingNow = devices.filter(device => Boolean(device.current_content) && Boolean(device.current_content_at) &&
    new Date(device.current_content_at!).getTime() >= now - 60 * 60 * 1000)
    .sort((a, b) => new Date(b.current_content_at!).getTime() - new Date(a.current_content_at!).getTime());
  const active = devices.filter(device => device.activated === true).length;
  const blocked = devices.filter(device => Boolean(device.blocked_reason)).length;
  return {
    stats: { total: devices.length, active, blocked, pending: Math.max(0, devices.length - active - blocked), plans,
      newToday: devices.filter(device => new Date(device.created_at).getTime() >= today.getTime()).length,
      online: devices.filter(device => Boolean(device.last_seen_at) && new Date(device.last_seen_at!).getTime() >= now - 5 * 60 * 1000).length,
      watching: watchingNow.length },
    watchingNow,
  };
}
