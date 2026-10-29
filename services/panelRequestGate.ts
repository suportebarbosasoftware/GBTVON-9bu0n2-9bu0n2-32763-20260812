/** Writes prioritize only their OWN panel identity; other networks never wait behind them. */
export function createPanelRequestGate() {
  interface ScopeState { activeWrites: number; users: number; waiters: Set<() => void>; }
  const scopes = new Map<string, ScopeState>();
  function acquire(scopeKey: string): ScopeState {
    let state = scopes.get(scopeKey);
    if (!state) { state = { activeWrites: 0, users: 0, waiters: new Set() }; scopes.set(scopeKey, state); }
    state.users += 1;
    return state;
  }
  function release(scopeKey: string, state: ScopeState): void {
    state.users -= 1;
    if (state.users === 0) scopes.delete(scopeKey);
  }
  async function runWrite<T>(operation: () => Promise<T>, scopeKey = 'default'): Promise<T> {
    const state = acquire(scopeKey);
    state.activeWrites += 1;
    try { return await operation(); }
    finally {
      state.activeWrites -= 1;
      if (state.activeWrites === 0) {
        const ready = Array.from(state.waiters); state.waiters.clear();
        for (const resume of ready) resume();
      }
      release(scopeKey, state);
    }
  }
  async function runRead<T>(operation: () => Promise<T>, scopeKey = 'default'): Promise<T> {
    const state = acquire(scopeKey);
    try {
      while (state.activeWrites > 0) await new Promise<void>(resolve => { state.waiters.add(resolve); });
      return await operation();
    } finally { release(scopeKey, state); }
  }
  return { runWrite, runRead };
}
