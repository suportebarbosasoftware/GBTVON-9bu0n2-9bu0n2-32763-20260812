/** Representative-only state: independent loading and server-confirmed device changes. */
import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clearRepCredentials, getRepPanelSnapshot, getRepSources, repLogin, setRepCredentials } from '@/services/repApiService';
import type { Representative, RepDevice, Source } from '@/services/repApiService';
import { isAdminAuthError } from '@/services/adminTransportService';
import { applyConfirmedDeviceChange } from '@/services/panelStateService';
import { repSourcesFreshnessMs } from '@/constants/repPanel';

interface PendingRequest { epoch: number; promise: Promise<void>; }
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
  const clientRevision = useRef(0);
  const sourceRevision = useRef(0);
  const clientsPending = useRef<PendingRequest | null>(null);
  const sourcesPending = useRef<PendingRequest | null>(null);
  const sourcesUpdatedAt = useRef(0);
  const loginPending = useRef(false);

  const reset = useCallback(() => {
    generation.current += 1; clientRevision.current += 1; sourceRevision.current += 1;
    repId.current = null; clearRepCredentials();
    clientsPending.current = null; sourcesPending.current = null; sourcesUpdatedAt.current = 0;
    setRep(null); setDevices([]); setSources([]); setClientsLoaded(false); setSourcesLoaded(false);
    setLoading(false); setSourcesLoading(false); setRefreshing(false); setLoginLoading(false);
    setAccessError(''); setClientError(''); setSourceError(''); setLastSyncedAt(null);
  }, []);
  const reportError = useCallback((error: unknown, epoch: number, section: 'clients' | 'sources') => {
    if (epoch !== generation.current) return;
    if (isAdminAuthError(error)) {
      reset(); setAccessError('O acesso do representante foi recusado pelo servidor. Entre novamente com seu código e senha.'); return;
    }
    const message = error instanceof Error ? error.message : 'Não foi possível comunicar com o servidor.';
    if (section === 'clients') setClientError(message); else setSourceError(message);
  }, [reset]);

  const syncClients: RepPanelContextType['syncClients'] = useCallback((silent = false, force = false): Promise<void> => {
    if (!repId.current) return Promise.resolve();
    const epoch = generation.current;
    if (!silent) setLoading(true);
    if (force) clientRevision.current += 1;
    const pending = clientsPending.current;
    if (pending?.epoch === epoch) return force
      ? pending.promise.then(() => epoch === generation.current ? syncClients(silent) : undefined)
      : pending.promise;
    const revision = clientRevision.current;
    const promise = getRepPanelSnapshot().then(snapshot => {
      if (epoch !== generation.current || revision !== clientRevision.current || snapshot.rep.id !== repId.current) return;
      setDevices(snapshot.devices); setRep(snapshot.rep); setClientsLoaded(true);
      setLastSyncedAt(snapshot.syncedAt); setClientError('');
    }).catch(error => { if (revision === clientRevision.current) reportError(error, epoch, 'clients'); }).finally(() => {
      if (epoch !== generation.current) return;
      clientsPending.current = null; setLoading(false);
    });
    clientsPending.current = { epoch, promise };
    return promise;
  }, [reportError]);

  const loadSources: RepPanelContextType['loadSources'] = useCallback((force = false): Promise<void> => {
    if (!repId.current) return Promise.resolve();
    const epoch = generation.current;
    if (force) { sourceRevision.current += 1; sourcesUpdatedAt.current = 0; }
    const pending = sourcesPending.current;
    if (pending?.epoch === epoch) return force
      ? pending.promise.then(() => epoch === generation.current ? loadSources() : undefined)
      : pending.promise;
    if (!force && sourcesUpdatedAt.current && Date.now() - sourcesUpdatedAt.current < repSourcesFreshnessMs) return Promise.resolve();
    const revision = sourceRevision.current;
    setSourcesLoading(true);
    const promise = getRepSources().then(value => {
      if (epoch !== generation.current || revision !== sourceRevision.current) return;
      setSources(value); setSourcesLoaded(true); setSourceError(''); sourcesUpdatedAt.current = Date.now();
    }).catch(error => { if (revision === sourceRevision.current) reportError(error, epoch, 'sources'); }).finally(() => {
      if (epoch !== generation.current) return;
      sourcesPending.current = null; setSourcesLoading(false);
    });
    sourcesPending.current = { epoch, promise };
    return promise;
  }, [reportError]);

  const commitDeviceChange = useCallback((device: RepDevice | null, removedIds: string[] = [], updatedRep?: Representative) => {
    if (!repId.current || (device && device.rep_id !== repId.current)) return;
    if (updatedRep && (updatedRep.id !== repId.current || !Number.isFinite(Number(updatedRep.credits)))) return;
    clientRevision.current += 1; sourceRevision.current += 1; sourcesUpdatedAt.current = 0;
    setDevices(previous => applyConfirmedDeviceChange(previous, device, removedIds));
    if (updatedRep) {
      setRep(previous => previous?.id === updatedRep.id
        ? { ...previous, ...updatedRep, credits: Number(updatedRep.credits) } : previous);
    }
  }, []);
  const loadData = useCallback(async (showLoader = false): Promise<void> => {
    await Promise.allSettled([syncClients(!showLoader, true), loadSources(true)]);
  }, [syncClients, loadSources]);
  const refresh = useCallback(async (): Promise<void> => {
    if (!repId.current) return;
    const epoch = generation.current; setRefreshing(true);
    try { await loadData(true); } finally { if (epoch === generation.current) setRefreshing(false); }
  }, [loadData]);
  const refreshAfterChange = useCallback(async (): Promise<void> => {
    sourcesUpdatedAt.current = 0;
    // Credit reconciliation is asynchronous; a second network call never delays confirmation of a write.
    void syncClients(true, true);
  }, [syncClients]);
  const login = useCallback(async (repNumber: string, password: string): Promise<string | null> => {
    if (loginPending.current) return 'Aguarde o login em andamento.';
    loginPending.current = true; reset();
    const epoch = generation.current; setLoginLoading(true);
    try {
      const result = await repLogin(repNumber.trim(), password);
      if (epoch !== generation.current) return null;
      if (!result.ok || !result.rep?.id) return result.error || 'Código ou senha incorretos.';
      setRepCredentials(result.rep.id, password); repId.current = result.rep.id; setRep(result.rep);
      void syncClients(); void loadSources();
      return null;
    } catch (error) {
      return epoch === generation.current ? (error instanceof Error ? error.message : 'Não foi possível entrar.') : null;
    } finally {
      loginPending.current = false;
      if (epoch === generation.current) setLoginLoading(false);
    }
  }, [reset, syncClients, loadSources]);

  const displaySources = useMemo(() => {
    if (!clientsLoaded) return sources;
    const counts = new Map<string, number>();
    for (const device of devices) if (device.activated && device.source_id) counts.set(device.source_id, (counts.get(device.source_id) ?? 0) + 1);
    return sources.map(source => ({ ...source, active_macs: counts.get(source.id) ?? 0 }));
  }, [sources, devices, clientsLoaded]);
  const syncError = useMemo(() => {
    const messages = [clientError ? `MACs e clientes: ${clientError}` : '', sourceError ? `Fontes: ${sourceError}` : ''].filter(Boolean);
    if (!messages.length) return '';
    return `${messages.join(' ')} ${clientsLoaded || sourcesLoaded ? 'Dados já confirmados continuam disponíveis.' : 'Ainda não há dados confirmados. Tente atualizar novamente.'}`;
  }, [clientError, sourceError, clientsLoaded, sourcesLoaded]);
  const value = useMemo<RepPanelContextType>(() => ({ loggedIn: rep !== null, rep, devices, sources: displaySources,
    clientsLoaded, sourcesLoaded, loading, sourcesLoading, refreshing, loginLoading, accessError, syncError, lastSyncedAt,
    login, syncClients, loadSources, loadData, refresh, refreshAfterChange, commitDeviceChange, reset,
  }), [rep, devices, displaySources, clientsLoaded, sourcesLoaded, loading, sourcesLoading, refreshing, loginLoading,
    accessError, syncError, lastSyncedAt, login, syncClients, loadSources, loadData, refresh, refreshAfterChange, commitDeviceChange, reset]);
  return <RepPanelContext.Provider value={value}>{children}</RepPanelContext.Provider>;
}
