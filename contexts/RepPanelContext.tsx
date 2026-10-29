/** Representative-only state: clients and sources load together through one authenticated request. */
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clearRepCredentials, getRepAuthPayload, getRepPanelSnapshot, repLogin, setRepCredentials } from '@/services/repApiService';
import type { Representative, RepDevice, Source } from '@/services/repApiService';
import { isAdminAuthError } from '@/services/adminTransportService';
import { applyConfirmedDeviceChange } from '@/services/panelStateService';
import { createPanelSyncQueue } from '@/services/panelSyncQueue';
import type { PanelSyncQueue } from '@/services/panelSyncQueue';
import { getPanelScopeKey, subscribePanelChanges } from '@/services/panelChangeService';
import { repSourcesFreshnessMs } from '@/constants/repPanel';

export interface RepPanelContextType {
  loggedIn: boolean; rep: Representative | null; devices: RepDevice[]; sources: Source[];
  clientsLoaded: boolean; sourcesLoaded: boolean; loading: boolean; sourcesLoading: boolean;
  refreshing: boolean; loginLoading: boolean; accessError: string; syncError: string; lastSyncedAt: string | null;
  login: (repNumber: string, password: string) => Promise<string | null>;
  syncClients: (silent?: boolean, force?: boolean) => Promise<void>;
  loadSources: (force?: boolean) => Promise<void>;
  loadData: (showLoader?: boolean) => Promise<void>;
  refresh: () => Promise<void>; refreshAfterChange: () => Promise<void>;
  commitDeviceChange: (device: RepDevice | null, removedIds?: string[], updatedRep?: Representative) => void;
  reset: () => void;
}
export const RepPanelContext = createContext<RepPanelContextType | undefined>(undefined);

export function RepPanelProvider({ children }: { children: ReactNode }) {
  const [rep, setRep] = useState<Representative | null>(null);
  const [devices, setDevices] = useState<RepDevice[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [clientError, setClientError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const repId = useRef<string | null>(null);
  const generation = useRef(0);
  const clientsLoadedRef = useRef(false);
  const clientQueue = useRef<PanelSyncQueue | null>(null);
  const sourcesUpdatedAt = useRef(0);
  const loginPending = useRef(false);

  const reset = useCallback(() => {
    generation.current += 1;
    clientQueue.current?.dispose(); clientQueue.current = null; sourcesUpdatedAt.current = 0;
    clientsLoadedRef.current = false; repId.current = null; clearRepCredentials();
    setRep(null); setDevices([]); setSources([]); setClientsLoaded(false); setSourcesLoaded(false);
    setLoading(false); setSourcesLoading(false); setRefreshing(false); setLoginLoading(false);
    setAccessError(''); setClientError(''); setSourceError(''); setLastSyncedAt(null);
  }, []);
  useEffect(() => () => { generation.current += 1; clientQueue.current?.dispose(); }, []);
  const reportError = useCallback((error: unknown, epoch: number) => {
    if (epoch !== generation.current) return;
    if (isAdminAuthError(error)) {
      reset(); setAccessError('O acesso do representante foi recusado pelo servidor. Entre novamente com seu código e senha.'); return;
    }
    setClientError(error instanceof Error ? error.message : 'Não foi possível comunicar com o servidor.');
  }, [reset]);

  const syncClients: RepPanelContextType['syncClients'] = useCallback((silent = false, force = false) => {
    if (!repId.current) return Promise.resolve();
    if (!silent || !clientsLoadedRef.current) setLoading(true);
    if (!clientQueue.current) {
      const epoch = generation.current;
      clientQueue.current = createPanelSyncQueue({
        read: fresh => {
          const includeSources = !sourcesUpdatedAt.current || Date.now() - sourcesUpdatedAt.current >= repSourcesFreshnessMs;
          if (includeSources) setSourcesLoading(true);
          return getRepPanelSnapshot(fresh, includeSources);
        },
        apply: snapshot => {
          if (epoch !== generation.current || snapshot.rep.id !== repId.current) return;
          clientsLoadedRef.current = true;
          setDevices(snapshot.devices); setRep(snapshot.rep); setClientsLoaded(true);
          setLastSyncedAt(snapshot.syncedAt); setClientError('');
          if (snapshot.sources) {
            setSources(snapshot.sources); setSourcesLoaded(true); setSourceError('');
            sourcesUpdatedAt.current = Date.now();
          }
          // An optional source failure never erases confirmed clients, credits or existing sources.
          if (snapshot.sourceError) setSourceError(snapshot.sourceError);
        },
        onError: error => reportError(error, epoch),
        onIdle: () => {
          if (epoch !== generation.current) return;
          setLoading(false); setSourcesLoading(false);
        },
      });
    }
    return clientQueue.current.request(force);
  }, [reportError]);

  const loadSources: RepPanelContextType['loadSources'] = useCallback((force = false) => {
    if (!repId.current) return Promise.resolve();
    if (!force && sourcesUpdatedAt.current && Date.now() - sourcesUpdatedAt.current < repSourcesFreshnessMs) return Promise.resolve();
    if (force) sourcesUpdatedAt.current = 0;
    return syncClients(true, force);
  }, [syncClients]);

  const commitDeviceChange = useCallback((device: RepDevice | null, removedIds: string[] = [], updatedRep?: Representative) => {
    if (!repId.current || (device && device.rep_id !== repId.current)) return;
    if (updatedRep && (updatedRep.id !== repId.current || !Number.isFinite(Number(updatedRep.credits)))) return;
    clientQueue.current?.invalidate(); sourcesUpdatedAt.current = 0;
    setDevices(previous => applyConfirmedDeviceChange(previous, device, removedIds));
    if (updatedRep) setRep(previous => previous?.id === updatedRep.id
      ? { ...previous, ...updatedRep, credits: Number(updatedRep.credits) } : previous);
  }, []);
  const loadData = useCallback(async (showLoader = false): Promise<void> => {
    if (!repId.current) return;
    sourcesUpdatedAt.current = 0;
    await syncClients(!showLoader, true);
  }, [syncClients]);
  const refresh = useCallback(async (): Promise<void> => {
    if (!repId.current) return;
    const epoch = generation.current; setRefreshing(true);
    try { await loadData(true); } finally { if (epoch === generation.current) setRefreshing(false); }
  }, [loadData]);
  const refreshAfterChange = useCallback(async (): Promise<void> => {
    // Revalidate an uncertain outcome, but never retry the mutation itself.
    clientQueue.current?.invalidate();
    await loadData();
  }, [loadData]);
  useEffect(() => subscribePanelChanges(change => {
    if (!repId.current || change.scopeKey !== getPanelScopeKey(getRepAuthPayload())) return;
    if (change.sections.includes('sources')) sourcesUpdatedAt.current = 0;
    if (change.sections.includes('devices') || change.sections.includes('sources')) {
      clientQueue.current?.invalidate();
      void syncClients(true, true);
    }
  }), [syncClients]);
  const login = useCallback(async (repNumber: string, password: string): Promise<string | null> => {
    if (loginPending.current) return 'Aguarde o login em andamento.';
    loginPending.current = true; reset();
    const epoch = generation.current; setLoginLoading(true);
    try {
      const result = await repLogin(repNumber.trim(), password);
      if (epoch !== generation.current) return null;
      if (!result.ok || !result.rep?.id) return result.error || 'Código ou senha incorretos.';
      setRepCredentials(result.rep.id, password); repId.current = result.rep.id; setRep(result.rep);
      // Authentication stays lightweight; the very next request loads both clients and sources.
      void syncClients(false, true);
      return null;
    } catch (error) {
      return epoch === generation.current ? (error instanceof Error ? error.message : 'Não foi possível entrar.') : null;
    } finally {
      loginPending.current = false;
      if (epoch === generation.current) setLoginLoading(false);
    }
  }, [reset, syncClients]);

  const displaySources = useMemo(() => {
    if (!clientsLoaded) return sources;
    const counts = new Map<string, number>();
    for (const device of devices) if (device.activated && device.source_id) counts.set(device.source_id, (counts.get(device.source_id) ?? 0) + 1);
    return sources.map(source => ({ ...source, active_macs: counts.get(source.id) ?? 0 }));
  }, [sources, devices, clientsLoaded]);
  const syncError = useMemo(() => {
    const messages = [clientError ? `MACs e clientes: ${clientError}` : '', sourceError ? `Fontes: ${sourceError}` : ''].filter(Boolean);
    if (!messages.length) return '';
    return `${messages.join(' ')} A sincronização tentará novamente automaticamente. ${clientsLoaded || sourcesLoaded ? 'Dados já confirmados continuam disponíveis.' : 'Ainda não há dados confirmados.'}`;
  }, [clientError, sourceError, clientsLoaded, sourcesLoaded]);
  const value = useMemo<RepPanelContextType>(() => ({ loggedIn: rep !== null, rep, devices, sources: displaySources,
    clientsLoaded, sourcesLoaded, loading, sourcesLoading, refreshing, loginLoading, accessError, syncError, lastSyncedAt,
    login, syncClients, loadSources, loadData, refresh, refreshAfterChange, commitDeviceChange, reset,
  }), [rep, devices, displaySources, clientsLoaded, sourcesLoaded, loading, sourcesLoading, refreshing, loginLoading,
    accessError, syncError, lastSyncedAt, login, syncClients, loadSources, loadData, refresh, refreshAfterChange, commitDeviceChange, reset]);
  return <RepPanelContext.Provider value={value}>{children}</RepPanelContext.Provider>;
}
