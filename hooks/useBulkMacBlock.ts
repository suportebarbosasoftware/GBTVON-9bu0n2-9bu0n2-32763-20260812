import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlert } from '@/template';
import { useAdminPanel } from '@/hooks/useAdminPanel';
import { blockAllDevices } from '@/services/adminApiService';
import { getAdminAuthPayload } from '@/services/adminSessionService';
import { getPanelScopeKey } from '@/services/panelChangeService';

function sessionMatches(expected: string | null): boolean {
  try { return expected !== null && getPanelScopeKey(getAdminAuthPayload()) === expected; }
  catch { return false; }
}

export function useBulkMacBlock() {
  const { showAlert } = useAlert();
  const { authenticated, isSubAdmin, devices, loaded, commitDeviceBlocks, syncClients } = useAdminPanel();
  const [blocking, setBlocking] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestBlockAll = useCallback(() => {
    if (!authenticated || busy.current || !loaded.devices || !devices.length) return;
    let expectedScope: string | null = null;
    try { expectedScope = getPanelScopeKey(getAdminAuthPayload()); }
    catch { showAlert('Sessão indisponível', 'Faça login novamente antes de bloquear as MACs.'); return; }
    showAlert('Bloquear todas as MACs?',
      `Isso bloqueará todas as MACs cadastradas nesta rede (${devices.length} na lista atual), inclusive as dos representantes, independentemente dos filtros. ${isSubAdmin ? 'Outras redes não serão alteradas.' : 'Redes de sub-admins não serão alteradas.'}\n\nFontes e cadastros serão mantidos. O app antigo receberá o bloqueio na próxima validação com este backend; credenciais salvas não são cortadas imediatamente.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Bloquear todas', style: 'destructive', onPress: async () => {
          if (!mounted.current || busy.current) return;
          if (!sessionMatches(expectedScope)) {
            showAlert('Sessão alterada', 'Confirme novamente o bloqueio na rede atual.');
            return;
          }
          busy.current = true;
          setBlocking(true);
          try {
            const result = await blockAllDevices();
            if (!mounted.current || !sessionMatches(expectedScope)) return;
            commitDeviceBlocks(result);
            // The transport also publishes a scoped mutation to automatically refresh all sections.
            showAlert('Bloqueio confirmado', `${result.blockedCount} MAC(s) bloqueada(s) nesta rede. Nenhuma fonte ou cadastro foi excluído. O app antigo aplicará o bloqueio na próxima validação de acesso.`);
          } catch (error) {
            if (!mounted.current || !sessionMatches(expectedScope)) return;
            // A failed confirmation may hide a completed write. Reconcile without repeating the block.
            void syncClients(true, true);
            showAlert('Não foi possível confirmar', error instanceof Error ? error.message : 'Atualize o painel para conferir antes de repetir o bloqueio.');
          } finally {
            busy.current = false;
            if (mounted.current) setBlocking(false);
          }
        } },
      ]);
  }, [authenticated, loaded.devices, devices.length, isSubAdmin, showAlert, commitDeviceBlocks, syncClients]);

  return { blocking, requestBlockAll, canBlock: authenticated && !!loaded.devices && devices.length > 0 };
}
