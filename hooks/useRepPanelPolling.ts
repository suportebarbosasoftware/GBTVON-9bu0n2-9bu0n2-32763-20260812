import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { repClientSyncIntervalMs } from '@/constants/repPanel';

/** Poll only the focused, foreground panel; schedule after completion to avoid request bursts. */
export function useRepPanelPolling(
  loggedIn: boolean,
  syncClients: (silent?: boolean) => Promise<void>,
  loadSources: (force?: boolean) => Promise<void>,
): void {
  useFocusEffect(useCallback(() => {
    if (!loggedIn) return;
    let disposed = false;
    let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (disposed || !active || running) return;
      running = true;
      // Cached metadata is revalidated at most once per minute and cannot block clients.
      void loadSources();
      try { await syncClients(true); }
      finally {
        running = false;
        if (!disposed && active) timer = setTimeout(() => { void tick(); }, repClientSyncIntervalMs);
      }
    };
    void tick();
    const subscription = AppState.addEventListener('change', state => {
      const wasActive = active;
      active = state === 'active';
      if (!active && timer) { clearTimeout(timer); timer = null; }
      if (active && !wasActive) void tick();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [loggedIn, syncClients, loadSources]));
}
