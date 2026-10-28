import { useMemo } from 'react';
import * as repApi from '@/services/repApiService';
import { useRepPanel } from '@/hooks/useRepPanel';

/** Update confirmed MACs immediately. Polling is not part of a mutation's loading state. */
export function useRepPanelActions() {
  const { refreshAfterChange, commitDeviceChange } = useRepPanel();
  return useMemo(() => {
    function withDevice<Args extends unknown[]>(action: (...args: Args) => Promise<repApi.RepDevice>) {
      return async (...args: Args): Promise<void> => {
        try { commitDeviceChange(await action(...args)); }
        catch (error) { void refreshAfterChange(); throw error; }
      };
    }
    function withReconciliation<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
      return async (...args: Args): Promise<Result> => {
        try { return await action(...args); }
        finally { void refreshAfterChange(); }
      };
    }
    return {
      activateRepDevice: withReconciliation(repApi.activateRepDevice),
      activateRepTest: withReconciliation(repApi.activateRepTest),
      renewRepDevice: withReconciliation(repApi.renewRepDevice),
      deactivateRepDevice: withDevice(repApi.deactivateRepDevice),
      blockRepDevice: withDevice(repApi.blockRepDevice),
      unblockRepDevice: withDevice(repApi.unblockRepDevice),
      updateRepDevicePrice: withDevice(repApi.updateRepDevicePrice),
      deleteRepDevice: async (deviceId: string): Promise<void> => {
        try { commitDeviceChange(null, await repApi.deleteRepDevice(deviceId)); }
        catch (error) { void refreshAfterChange(); throw error; }
      },
      changeRepDeviceSource: async (deviceId: string, sourceId: string) => {
        try {
          const result = await repApi.changeRepDeviceSource(deviceId, sourceId);
          commitDeviceChange(result.device);
          return result;
        } catch (error) { void refreshAfterChange(); throw error; }
      },
      lookupDeviceByMac: repApi.lookupDeviceByMac,
    };
  }, [refreshAfterChange, commitDeviceChange]);
}
