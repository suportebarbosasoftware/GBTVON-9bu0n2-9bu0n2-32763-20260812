/** Give panel writes priority over NEW background reads. Running reads are never used as a write queue. */
export function createPanelRequestGate() {
  let activeWrites = 0;
  const waiters = new Set<() => void>();

  async function runWrite<T>(operation: () => Promise<T>): Promise<T> {
    activeWrites += 1;
    try { return await operation(); }
    finally {
      activeWrites -= 1;
      if (activeWrites === 0) {
        const ready = Array.from(waiters);
        waiters.clear();
        for (const release of ready) release();
      }
    }
  }

  async function runRead<T>(operation: () => Promise<T>): Promise<T> {
    while (activeWrites > 0) await new Promise<void>(resolve => { waiters.add(resolve); });
    return operation();
  }

  return { runWrite, runRead };
}
