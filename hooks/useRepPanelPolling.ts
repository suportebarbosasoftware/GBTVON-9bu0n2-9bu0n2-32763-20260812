import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { repClientSyncIntervalMs } from '@/constants/repPanel';

/** Poll only the focused, foreground panel; schedule after completion to avoid request bursts. */
export function useRepPanelPolling(
  loggedIn: boolean,
  syncClients: (silent?: boolean, force?: boolean) => Promise<void>,
  loadSources: (force?: boolean) => Promise<void>,
): void {
  useFocusEffect(useCallback(() => {
    if (!loggedIn) return;
    let disposed = false;
    let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (force = false) => {
      if (disposed || !active || running) return;
      if (timer) { clearTimeout(timer); timer = null; }
      running = true;
      // Sources and clients now share one request. Entry/resume includes sources;
      // subsequent snapshots include them automatically whenever their metadata is due.
      try { await (force ? loadSources(true) : syncClients(true)); }
      catch { /* Keep the automatic loop alive after a failed read. */ }
      finally {
        running = false;
        if (!disposed && active) timer = setTimeout(() => { void tick(); }, repClientSyncIntervalMs);
      }
    };
    void tick(true);
    const subscription = AppState.addEventListener('change', state => {
      const wasActive = active;
      active = state === 'active';
      if (!active && timer) { clearTimeout(timer); timer = null; }
      if (active && !wasActive) void tick(true);
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [loggedIn, syncClients, loadSources]));
}
