/** Shared administrative state: automatic scoped sync and immediate server-confirmed changes. */
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getPanelSnapshot, getPlans, getNotifications, getSubAdmins, rootAdminLogin, subAdminLogin } from '@/services/adminApiService';
import type { Device, Plan, AdminStats, Notification, WatchingDevice, SubAdmin } from '@/services/adminApiService';
import { getRepresentatives, getSources } from '@/services/repApiService';
import type { Representative, Source } from '@/services/repApiService';
import { clearAdminSession, getAdminAuthPayload, setRootAdminSession, setSubAdminCredentials } from '@/services/adminSessionService';
import { isAdminAuthError } from '@/services/adminTransportService';
import { applyConfirmedDeviceChange, buildConfirmedPanelOverview } from '@/services/panelStateService';
import { createPanelSyncQueue } from '@/services/panelSyncQueue';
import type { PanelSyncQueue } from '@/services/panelSyncQueue';
import { getPanelScopeKey, subscribePanelChanges } from '@/services/panelChangeService';
import { panelMetadataFreshnessMs } from '@/constants/adminPanel';

type SecondarySection = 'plans' | 'notifications' | 'reps' | 'sources' | 'subAdmins';
type Section = 'stats' | 'devices' | 'watchingNow' | SecondarySection;
interface PanelData {
  stats: AdminStats | null; devices: Device[]; plans: Plan[]; notifications: Notification[];
  reps: Representative[]; sources: Source[]; subAdmins: SubAdmin[]; watchingNow: WatchingDevice[];
}
interface PanelIdentity { subAdmin: SubAdmin | null; }
export interface AdminPanelContextType extends PanelData {
  authenticated: boolean; isSubAdmin: boolean; currentSubAdmin: SubAdmin | null;
  loading: boolean; refreshing: boolean; lastSyncedAt: string | null;
  loaded: Partial<Record<Section, boolean>>;
  loadingSections: Partial<Record<SecondarySection, boolean>>;
  syncError: string; accessError: string;
  login: (mode: 'root' | 'subadmin', password: string, username: string) => Promise<string | null>;
  syncClients: (silent?: boolean, force?: boolean) => Promise<void>;
  syncPanel: (silent?: boolean, force?: boolean) => Promise<void>;
  commitDeviceChange: (device: Device | null, removedIds?: string[]) => void;
  loadSection: (section: SecondarySection, force?: boolean) => Promise<void>;
  loadAll: (silent?: boolean) => Promise<void>;
  loadWatching: () => Promise<void>; refresh: () => Promise<void>; reset: () => void;
}
const emptyData = (): PanelData => ({ stats: null, devices: [], plans: [], notifications: [], reps: [], sources: [], subAdmins: [], watchingNow: [] });
const labels: Record<Section, string> = { stats: 'Resumo', devices: 'MACs e clientes', plans: 'Planos', notifications: 'Avisos', reps: 'Representantes', sources: 'Fontes', subAdmins: 'Sub-admins', watchingNow: 'Assistindo' };
const metadataLoaders: Record<SecondarySection, (fresh?: boolean) => Promise<unknown>> = { plans: getPlans, notifications: getNotifications, reps: getRepresentatives, sources: getSources, subAdmins: getSubAdmins };
export const AdminPanelContext = createContext<AdminPanelContextType | undefined>(undefined);

export function AdminPanelProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PanelData>(emptyData);
  const [identity, setIdentity] = useState<PanelIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState<Partial<Record<Section, boolean>>>({});
  const [loadingSections, setLoadingSections] = useState<Partial<Record<SecondarySection, boolean>>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});
  const [accessError, setAccessError] = useState('');
  const identityRef = useRef<PanelIdentity | null>(null);
  const generation = useRef(0);
  const clientsLoadedRef = useRef(false);
  const loginInFlight = useRef(false);
  const clientQueue = useRef<PanelSyncQueue | null>(null);
  const metadataQueues = useRef<Partial<Record<SecondarySection, PanelSyncQueue>>>({});
  const metadataUpdatedAt = useRef<Partial<Record<SecondarySection, number>>>({});
  const requestedSections = useRef<Set<SecondarySection>>(new Set());

  const reset = useCallback(() => {
    generation.current += 1;
    clientQueue.current?.dispose(); clientQueue.current = null;
    for (const queue of Object.values(metadataQueues.current)) queue?.dispose();
    metadataQueues.current = {}; metadataUpdatedAt.current = {}; requestedSections.current = new Set();
    identityRef.current = null; clientsLoadedRef.current = false;
    clearAdminSession(); setIdentity(null); setData(emptyData());
    setLoaded({}); setLoadingSections({}); setErrors({}); setAccessError('');
    setLoading(false); setRefreshing(false); setLastSyncedAt(null);
  }, []);
  useEffect(() => () => {
    generation.current += 1; clientQueue.current?.dispose();
    for (const queue of Object.values(metadataQueues.current)) queue?.dispose();
  }, []);
  const reportError = useCallback((error: unknown, epoch: number, key: Section) => {
    if (generation.current !== epoch) return;
    const message = error instanceof Error ? error.message : 'Falha ao atualizar o painel.';
    if (isAdminAuthError(error)) { reset(); setAccessError(message); return; }
    setErrors(previous => ({ ...previous, [key]: message }));
  }, [reset]);

  const syncClients: AdminPanelContextType['syncClients'] = useCallback((silent = false, force = false) => {
    if (!identityRef.current) return Promise.resolve();
    if (!silent) setLoading(true);
    if (!clientQueue.current) {
      const epoch = generation.current;
      clientQueue.current = createPanelSyncQueue({
        read: getPanelSnapshot,
        apply: snapshot => {
          if (generation.current !== epoch) return;
          clientsLoadedRef.current = true;
          setData(previous => ({ ...previous, devices: snapshot.devices, stats: snapshot.stats, watchingNow: snapshot.watchingNow }));
          setLoaded(previous => ({ ...previous, devices: true, stats: true, watchingNow: true }));
          setLastSyncedAt(snapshot.syncedAt);
          setErrors(previous => { const next = { ...previous }; delete next.devices; delete next.stats; delete next.watchingNow; return next; });
        },
        onError: error => reportError(error, epoch, 'devices'),
        onIdle: () => { if (generation.current === epoch) setLoading(false); },
      });
    }
    return clientQueue.current.request(force);
  }, [reportError]);

  const commitDeviceChange = useCallback((device: Device | null, removedIds: string[] = []) => {
    if (!identityRef.current) return;
    if (device) {
      const actualScope = (device as Device & { admin_id?: string | null }).admin_id ?? null;
      if (actualScope !== (identityRef.current.subAdmin?.id ?? null)) return;
    }
    clientQueue.current?.invalidate();
    setData(previous => {
      const devices = applyConfirmedDeviceChange(previous.devices, device, removedIds);
      if (!clientsLoadedRef.current) return { ...previous, devices };
      const overview = buildConfirmedPanelOverview(devices, previous.stats?.plans ?? 0);
      return { ...previous, devices, stats: overview.stats, watchingNow: overview.watchingNow as WatchingDevice[] };
    });
    for (const section of ['plans', 'sources', 'reps'] as SecondarySection[]) {
      metadataUpdatedAt.current[section] = 0; metadataQueues.current[section]?.invalidate();
    }
  }, []);

  const loadSection: AdminPanelContextType['loadSection'] = useCallback((section, force = false) => {
    if (!identityRef.current || (section === 'subAdmins' && identityRef.current.subAdmin)) return Promise.resolve();
    requestedSections.current.add(section);
    const updatedAt = metadataUpdatedAt.current[section];
    if (!force && updatedAt && Date.now() - updatedAt < panelMetadataFreshnessMs) return Promise.resolve();
    setLoadingSections(previous => ({ ...previous, [section]: true }));
    let queue = metadataQueues.current[section];
    if (!queue) {
      const epoch = generation.current;
      queue = createPanelSyncQueue({
        read: fresh => metadataLoaders[section](fresh),
        apply: value => {
          if (generation.current !== epoch) return;
          setData(previous => ({ ...previous, [section]: value }));
          setLoaded(previous => ({ ...previous, [section]: true }));
          metadataUpdatedAt.current[section] = Date.now();
          setErrors(previous => { const next = { ...previous }; delete next[section]; return next; });
        },
        onError: error => reportError(error, epoch, section),
        onIdle: () => { if (generation.current === epoch) setLoadingSections(previous => ({ ...previous, [section]: false })); },
      });
      metadataQueues.current[section] = queue;
    }
    if (force) metadataUpdatedAt.current[section] = 0;
    return queue.request(force);
  }, [reportError]);

  const syncPanel = useCallback(async (silent = true, force = false): Promise<void> => {
    if (!identityRef.current) return;
    // Secondary tabs are refreshed automatically, but never hold the MAC polling cycle.
    for (const section of requestedSections.current) void loadSection(section, force);
    await syncClients(silent, force);
  }, [syncClients, loadSection]);
  useEffect(() => subscribePanelChanges(change => {
    if (!identityRef.current || change.scopeKey !== getPanelScopeKey(getAdminAuthPayload())) return;
    if (change.sections.includes('devices')) {
      clientQueue.current?.invalidate();
      void syncClients(true, true);
    }
    for (const section of change.sections) {
      if (section !== 'devices' && requestedSections.current.has(section)) {
        metadataUpdatedAt.current[section] = 0;
        metadataQueues.current[section]?.invalidate();
        void loadSection(section, true);
      }
    }
  }), [syncClients, loadSection]);
  const loadAll = useCallback((silent = false) => syncPanel(silent, true), [syncPanel]);
  const loadWatching = useCallback(() => syncClients(true, true), [syncClients]);
  const login = useCallback(async (mode: 'root' | 'subadmin', password: string, username: string): Promise<string | null> => {
    if (loginInFlight.current) return 'Aguarde o login em andamento.';
    loginInFlight.current = true; reset();
    const epoch = generation.current; setLoading(true);
    try {
      let nextIdentity: PanelIdentity;
      if (mode === 'subadmin') {
        const result = await subAdminLogin(username.trim(), password);
        if (generation.current !== epoch) return null;
        if (!result.ok || !result.admin || !result.sessionToken) throw new Error(result.error || 'Credenciais inválidas.');
        setSubAdminCredentials(result.admin.id, result.sessionToken); nextIdentity = { subAdmin: result.admin };
      } else {
        const result = await rootAdminLogin(password);
        if (generation.current !== epoch) return null;
        setRootAdminSession(result.token); nextIdentity = { subAdmin: null };
      }
      identityRef.current = nextIdentity; setIdentity(nextIdentity);
      void syncClients(false, true);
      return null;
    } catch (error) {
      if (generation.current !== epoch) return null;
      clearAdminSession(); return error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.';
    } finally {
      loginInFlight.current = false;
      if (generation.current === epoch && !identityRef.current) setLoading(false);
    }
  }, [reset, syncClients]);
  const refresh = useCallback(async (): Promise<void> => {
    if (!identityRef.current) return;
    const epoch = generation.current; setRefreshing(true);
    try { await loadAll(); } finally { if (generation.current === epoch) setRefreshing(false); }
  }, [loadAll]);
  const syncError = useMemo(() => {
    const keys = Object.keys(errors) as Section[];
    if (!keys.length) return '';
    return `Não foi possível atualizar: ${keys.map(key => labels[key]).join(', ')}. ${errors[keys[0]]} A sincronização tentará novamente automaticamente.${loaded.devices ? ' A lista exibida é a última confirmada.' : ' Ainda não há uma lista confirmada.'}`;
  }, [errors, loaded.devices]);
  const value = useMemo<AdminPanelContextType>(() => {
    const planCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    const repCounts = new Map<string, number>();
    if (loaded.devices) for (const device of data.devices) {
      if (!device.activated) continue;
      if (device.plan_id) planCounts.set(device.plan_id, (planCounts.get(device.plan_id) ?? 0) + 1);
      const sourceId = (device as Device & { source_id?: string }).source_id;
      if (sourceId) sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
      if (device.rep_id) repCounts.set(device.rep_id, (repCounts.get(device.rep_id) ?? 0) + 1);
    }
    return { ...data,
      plans: loaded.devices ? data.plans.map(plan => ({ ...plan, active_macs: planCounts.get(plan.id) ?? 0 })) : data.plans,
      sources: loaded.devices ? data.sources.map(source => ({ ...source, active_macs: sourceCounts.get(source.id) ?? 0 })) : data.sources,
      reps: loaded.devices ? data.reps.map(rep => ({ ...rep, active_devices: repCounts.get(rep.id) ?? 0 })) : data.reps,
      authenticated: identity !== null, isSubAdmin: !!identity?.subAdmin, currentSubAdmin: identity?.subAdmin ?? null,
      loading, refreshing, loaded, loadingSections, lastSyncedAt, syncError, accessError,
      login, syncClients, syncPanel, commitDeviceChange, loadSection, loadAll, loadWatching, refresh, reset };
  }, [data, identity, loading, refreshing, loaded, loadingSections, lastSyncedAt, syncError, accessError,
    login, syncClients, syncPanel, commitDeviceChange, loadSection, loadAll, loadWatching, refresh, reset]);
  return <AdminPanelContext.Provider value={value}>{children}</AdminPanelContext.Provider>;
}
