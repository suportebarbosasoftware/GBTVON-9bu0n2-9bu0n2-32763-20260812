import { useEffect } from 'react';
import { AppState } from 'react-native';
import { clientSyncIntervalMs } from '@/constants/adminPanel';

/** Only MAC snapshots are polled; metadata and background screens do not produce request bursts. */
export function useAdminPanelPolling(authenticated: boolean, syncClients: (silent?: boolean) => Promise<void>): void {
  useEffect(() => {
    if (!authenticated) return;
    let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const interval = setInterval(() => {
      if (active) void syncClients(true);
    }, clientSyncIntervalMs);
    const subscription = AppState.addEventListener('change', state => {
      const wasActive = active;
      active = state === 'active';
      if (active && !wasActive) void syncClients(true);
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [authenticated, syncClients]);
}
