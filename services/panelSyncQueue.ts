/** Single-flight synchronization with one coalesced follow-up after invalidation. No React or writes. */
export interface PanelSyncQueue {
  request: (fresh?: boolean) => Promise<void>;
  invalidate: () => void;
  dispose: () => void;
}

export function createPanelSyncQueue<T>(options: {
  read: (fresh: boolean) => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
  onIdle?: () => void;
}): PanelSyncQueue {
  let pending: Promise<void> | null = null;
  let revision = 0;
  let followUp = false;
  let urgent = false;
  let disposed = false;

  function request(fresh = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) {
      if (fresh) { revision += 1; followUp = true; urgent = true; }
      return pending;
    }
    urgent = fresh;
    pending = Promise.resolve().then(async () => {
      do {
        followUp = false;
        if (disposed) break;
        const expectedRevision = revision;
        const bypassBackoff = urgent;
        urgent = false;
        try {
          const value = await options.read(bypassBackoff);
          if (!disposed && revision === expectedRevision) options.apply(value);
        } catch (error) {
          if (!disposed && revision === expectedRevision) options.onError(error);
        }
      } while (!disposed && followUp);
    }).finally(() => {
      pending = null;
      // A refresh can arrive while the async worker is settling, after its loop has exited.
      // Drain that late request as well instead of leaving it waiting for manual refresh.
      if (!disposed && followUp) { followUp = false; return request(true); }
      if (!disposed) options.onIdle?.();
    });
    return pending;
  }

  return {
    request,
    invalidate: () => {
      revision += 1;
      if (pending) { followUp = true; urgent = true; }
    },
    dispose: () => { disposed = true; revision += 1; followUp = false; },
  };
}
