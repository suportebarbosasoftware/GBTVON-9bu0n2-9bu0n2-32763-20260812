import { useMemo } from 'react';
import * as adminApi from '@/services/adminApiService';
import { useAdminPanel } from '@/hooks/useAdminPanel';

/** Publish confirmed rows immediately; a full-panel reload never holds an action button. */
export function useAdminPanelActions() {
  const { commitDeviceChange, syncClients } = useAdminPanel();
  return useMemo(() => {
    function withDevice<Args extends unknown[]>(action: (...args: Args) => Promise<adminApi.Device>) {
      return async (...args: Args): Promise<void> => {
        try {
          const device = await action(...args);
          commitDeviceChange(device);
        } catch (error) {
          // A transport failure may hide a completed write. Reconcile without repeating it.
          void syncClients(true, true);
          throw error;
        }
      };
    }
    return {
      activateDevice: withDevice(adminApi.activateDevice),
      saveDevice: withDevice(adminApi.saveDevice),
      deactivateDevice: withDevice(adminApi.deactivateDevice),
      blockDevice: withDevice(adminApi.blockDevice),
      grantGracePeriod: withDevice(adminApi.grantGracePeriod),
      deleteDevice: async (id: string): Promise<void> => {
        try { const ids = await adminApi.deleteDevice(id); commitDeviceChange(null, ids); }
        catch (error) { void syncClients(true, true); throw error; }
      },
      deleteDevicesBulk: async (ids: string[]): Promise<void> => {
        try { const removed = await adminApi.deleteDevicesBulk(ids); commitDeviceChange(null, removed); }
        catch (error) { void syncClients(true, true); throw error; }
      },
      deleteInactiveDevices: async (): Promise<void> => {
        try { const removed = await adminApi.deleteInactiveDevices(); commitDeviceChange(null, removed); }
        catch (error) { void syncClients(true, true); throw error; }
      },
    };
  }, [commitDeviceChange, syncClients]);
}
