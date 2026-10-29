/** Read-only panel helpers. Queries must already contain the resolved administrator's scope. */
const pageSize = 500;

export async function readPanelRows(createQuery: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await createQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao carregar o painel.');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

/** Isolate optional metadata failures: an unavailable source must not discard confirmed clients. */
export async function readPanelMetadata(readers: Record<string, () => Promise<any>>): Promise<{ values: Record<string, any>; errors: Record<string, string> }> {
  const entries = Object.entries(readers);
  const results = await Promise.allSettled(entries.map(([, read]) => Promise.resolve().then(read)));
  const values: Record<string, any> = {};
  const errors: Record<string, string> = {};
  results.forEach((result, index) => {
    const name = entries[index][0];
    if (result.status === 'fulfilled') values[name] = result.value;
    else errors[name] = /panel_database_timeout/i.test(String(result.reason?.message ?? ''))
      ? 'A consulta demorou para responder. Uma nova tentativa será feita automaticamente.'
      : 'Não foi possível carregar esta informação. Uma nova tentativa será feita automaticamente.';
  });
  return { values, errors };
}

interface OverviewDevice {
  activated: boolean | null;
  blocked_reason: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  current_content: string | null;
  current_content_at: string | null;
}

/** Derive MAC lists, totals and watching data from the same database read, never from a cached list. */
export function buildPanelOverview<T extends OverviewDevice>(devices: T[], activePlans: number, now = new Date()) {
  const onlineSince = now.getTime() - 5 * 60 * 1000;
  const watchingSince = now.getTime() - 60 * 60 * 1000;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const watchingNow = devices.filter(device =>
    device.current_content !== null && device.current_content !== undefined &&
    !!device.current_content_at && new Date(device.current_content_at).getTime() >= watchingSince,
  ).sort((a, b) => new Date(b.current_content_at!).getTime() - new Date(a.current_content_at!).getTime());
  const active = devices.filter(device => device.activated === true).length;
  const blocked = devices.filter(device => device.blocked_reason !== null && device.blocked_reason !== undefined).length;
  return {
    stats: {
      total: devices.length, active, blocked, pending: devices.length - active - blocked,
      newToday: devices.filter(device => !!device.created_at && new Date(device.created_at).getTime() >= todayStart.getTime()).length,
      online: devices.filter(device => !!device.last_seen_at && new Date(device.last_seen_at).getTime() >= onlineSince).length,
      plans: activePlans, watching: watchingNow.length,
    },
    watchingNow,
    syncedAt: now.toISOString(),
  };
}

export function countPanelRelations(rows: Record<string, any>[], field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (typeof row[field] === 'string') counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  }
  return counts;
}
