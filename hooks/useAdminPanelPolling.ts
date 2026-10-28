import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { clientSyncIntervalMs } from '@/constants/adminPanel';

/** Only a visible, foreground panel polls; each cycle waits for the previous request to finish. */
export function useAdminPanelPolling(authenticated: boolean, syncPanel: (silent?: boolean, force?: boolean) => Promise<void>): void {
  useFocusEffect(useCallback(() => {
    if (!authenticated) return;
    let disposed = false;
    let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (force = false) => {
      if (disposed || !active || running) return;
      if (timer) { clearTimeout(timer); timer = null; }
      running = true;
      try { await syncPanel(true, force); }
      catch { /* The provider reports the error; the next cycle still runs automatically. */ }
      finally {
        running = false;
        if (!disposed && active) timer = setTimeout(() => { void tick(); }, clientSyncIntervalMs);
      }
    };
    void tick(true);
    const subscription = AppState.addEventListener('change', state => {
      const wasActive = active;
      active = state === 'active';
      if (!active && timer) { clearTimeout(timer); timer = null; }
      if (active && !wasActive) void tick(true);
    });
    return () => { disposed = true; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [authenticated, syncPanel]));
}
