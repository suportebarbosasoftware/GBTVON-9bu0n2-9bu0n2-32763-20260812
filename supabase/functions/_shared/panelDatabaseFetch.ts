/** Bound read/login database requests to a single deadline. Never retry mutations here. */
export class PanelDatabaseTimeoutError extends Error {
  constructor() { super('panel_database_timeout'); this.name = 'PanelDatabaseTimeoutError'; }
}
export function createPanelDatabaseFetch(deadlineAt: number, transport: typeof fetch = fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new PanelDatabaseTimeoutError();
    const controller = new AbortController();
    const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    if (upstream?.aborted) abort();
    else upstream?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        transport(input, { ...init, signal: controller.signal }).then(async response => {
          // Keep the deadline active while downloading the JSON too, not just until headers arrive.
          const bytes = await response.arrayBuffer();
          return new Response([204, 205, 304].includes(response.status) ? null : bytes,
            { status: response.status, statusText: response.statusText, headers: response.headers });
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { reject(new PanelDatabaseTimeoutError()); controller.abort(); }, remaining);
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
      upstream?.removeEventListener('abort', abort);
    }
  };
}
