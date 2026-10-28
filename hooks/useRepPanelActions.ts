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
    function withActivation<Args extends unknown[]>(action: (...args: Args) => Promise<repApi.RepActivationResult>) {
      return async (...args: Args): Promise<repApi.RepActivationResult> => {
        try {
          const result = await action(...args);
          commitDeviceChange(result.device, [], result.rep);
          return result;
        } catch (error) { void refreshAfterChange(); throw error; }
      };
    }
    return {
      activateRepDevice: withActivation(repApi.activateRepDevice),
      activateRepTest: withActivation(repApi.activateRepTest),
      renewRepDevice: async (deviceId: string, days: number): Promise<repApi.RepRenewalResult> => {
        try {
          const result = await repApi.renewRepDevice(deviceId, days);
          commitDeviceChange(result.device, [], result.rep);
          return result;
        } catch (error) { void refreshAfterChange(); throw error; }
      },
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
