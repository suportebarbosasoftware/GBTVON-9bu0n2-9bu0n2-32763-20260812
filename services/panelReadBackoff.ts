/** Outage cooldown is private to one panel identity, never shared between networks or login. */
export function createPanelReadBackoff(now: () => number = Date.now) {
  const states = new Map<string, { failures: number; retryAt: number }>();
  function failed(scopeKey: string): void {
    // Expired entries cannot accumulate indefinitely as panel identities change.
    for (const [key, state] of states) if (now() - state.retryAt > 60000) states.delete(key);
    const failures = Math.min(4, (states.get(scopeKey)?.failures ?? 0) + 1);
    states.set(scopeKey, { failures, retryAt: now() + Math.min(60000, 10000 * Math.pow(2, failures - 1)) });
  }
  return {
    failed,
    succeeded: (scopeKey: string): void => { states.delete(scopeKey); },
    shouldDelay: (scopeKey: string): boolean => now() < (states.get(scopeKey)?.retryAt ?? 0),
  };
}
