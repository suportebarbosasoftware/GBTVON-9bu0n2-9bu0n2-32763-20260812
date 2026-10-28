import { useMemo } from 'react';
import * as repApi from '@/services/repApiService';
import { useRepPanel } from '@/hooks/useRepPanel';

/** Mutations refresh authoritative MACs and credits before completing; never retry writes. */
export function useRepPanelActions() {
  const { refreshAfterChange } = useRepPanel();
  return useMemo(() => {
    function withRefresh<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
      return async (...args: Args): Promise<Result> => {
        const result = await action(...args);
        await refreshAfterChange();
        return result;
      };
    }
    return {
      activateRepDevice: withRefresh(repApi.activateRepDevice),
      activateRepTest: withRefresh(repApi.activateRepTest),
      deactivateRepDevice: withRefresh(repApi.deactivateRepDevice),
      blockRepDevice: withRefresh(repApi.blockRepDevice),
      unblockRepDevice: withRefresh(repApi.unblockRepDevice),
      deleteRepDevice: withRefresh(repApi.deleteRepDevice),
      renewRepDevice: withRefresh(repApi.renewRepDevice),
      changeRepDeviceSource: withRefresh(repApi.changeRepDeviceSource),
      updateRepDevicePrice: withRefresh(repApi.updateRepDevicePrice),
      lookupDeviceByMac: repApi.lookupDeviceByMac,
    };
  }, [refreshAfterChange]);
}
