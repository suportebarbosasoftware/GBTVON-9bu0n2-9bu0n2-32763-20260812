/** Shared administrative state with independent reads and confirmed device updates. */
import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getPanelSnapshot, getPlans, getNotifications, getSubAdmins, rootAdminLogin, subAdminLogin } from '@/services/adminApiService';
import type { Device, Plan, AdminStats, Notification, WatchingDevice, SubAdmin } from '@/services/adminApiService';
import { getRepresentatives, getSources } from '@/services/repApiService';
import type { Representative, Source } from '@/services/repApiService';
import { clearAdminSession, setSubAdminCredentials } from '@/services/adminSessionService';
import { isAdminAuthError } from '@/services/adminTransportService';
import { applyConfirmedDeviceChange, buildConfirmedPanelOverview } from '@/services/panelStateService';
import { panelMetadataFreshnessMs } from '@/constants/adminPanel';

type SecondarySection = 'plans' | 'notifications' | 'reps' | 'sources' | 'subAdmins';
type Section = 'stats' | 'devices' | 'watchingNow' | SecondarySection;
interface PanelData {
  stats: AdminStats | null; devices: Device[]; plans: Plan[]; notifications: Notification[];
  reps: Representative[]; sources: Source[]; subAdmins: SubAdmin[]; watchingNow: WatchingDevice[];
}
interface PanelIdentity { subAdmin: SubAdmin | null; }
interface InFlight { generation: number; promise: Promise<void>; }
export interface AdminPanelContextType extends PanelData {
  authenticated: boolean; isSubAdmin: boolean; currentSubAdmin: SubAdmin | null;
  loading: boolean; refreshing: boolean; lastSyncedAt: string | null;
  loaded: Partial<Record<Section, boolean>>;
  loadingSections: Partial<Record<SecondarySection, boolean>>;
  syncError: string; accessError: string;
  login: (mode: 'root' | 'subadmin', password: string, username: string) => Promise<string | null>;
  syncClients: (silent?: boolean, force?: boolean) => Promise<void>;
  commitDeviceChange: (device: Device | null, removedIds?: string[]) => void;
  loadSection: (section: SecondarySection, force?: boolean) => Promise<void>;
  loadAll: (silent?: boolean) => Promise<void>;
  loadWatching: () => Promise<void>; refresh: () => Promise<void>; reset: () => void;
}
const emptyData = (): PanelData => ({ stats: null, devices: [], plans: [], notifications: [], reps: [], sources: [], subAdmins: [], watchingNow: [] });
const labels: Record<Section, string> = { stats: 'Resumo', devices: 'MACs e clientes', plans: 'Planos', notifications: 'Avisos', reps: 'Representantes', sources: 'Fontes', subAdmins: 'Sub-admins', watchingNow: 'Assistindo' };
const metadataLoaders: Record<SecondarySection, () => Promise<unknown>> = { plans: getPlans, notifications: getNotifications, reps: getRepresentatives, sources: getSources, subAdmins: getSubAdmins };
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
  const clientRevision = useRef(0);
  const clientsLoadedRef = useRef(false);
  const loginInFlight = useRef(false);
  const clientsInFlight = useRef<InFlight | null>(null);
  const metadataInFlight = useRef<Partial<Record<SecondarySection, InFlight>>>({});
  const metadataRevision = useRef<Partial<Record<SecondarySection, number>>>({});
  const metadataUpdatedAt = useRef<Partial<Record<SecondarySection, number>>>({});
  const requestedSections = useRef<Set<SecondarySection>>(new Set());

  const reset = useCallback(() => {
    generation.current += 1; clientRevision.current += 1;
    identityRef.current = null; clientsLoadedRef.current = false;
    clearAdminSession(); setIdentity(null); setData(emptyData());
    setLoaded({}); setLoadingSections({}); setErrors({}); setAccessError('');
    setLoading(false); setRefreshing(false); setLastSyncedAt(null);
    clientsInFlight.current = null; metadataInFlight.current = {}; metadataRevision.current = {};
    requestedSections.current = new Set(); metadataUpdatedAt.current = {};
  }, []);
  const reportError = useCallback((error: unknown, epoch: number, key: Section) => {
    if (generation.current !== epoch) return;
    const message = error instanceof Error ? error.message : 'Falha ao atualizar o painel.';
    if (isAdminAuthError(error)) { reset(); setAccessError(message); return; }
    setErrors(previous => ({ ...previous, [key]: message }));
  }, [reset]);

  const syncClients: AdminPanelContextType['syncClients'] = useCallback((silent = false, force = false): Promise<void> => {
    if (!identityRef.current) return Promise.resolve();
    const epoch = generation.current;
    if (!silent) setLoading(true);
    if (force) clientRevision.current += 1;
    const pending = clientsInFlight.current;
    if (pending?.generation === epoch) return force
      ? pending.promise.then(() => generation.current === epoch ? syncClients(silent) : undefined)
      : pending.promise;
    const revision = clientRevision.current;
    const promise = getPanelSnapshot().then(snapshot => {
      if (generation.current !== epoch || revision !== clientRevision.current) return;
      clientsLoadedRef.current = true;
      setData(previous => ({ ...previous, devices: snapshot.devices, stats: snapshot.stats, watchingNow: snapshot.watchingNow }));
      setLoaded(previous => ({ ...previous, devices: true, stats: true, watchingNow: true }));
      setLastSyncedAt(snapshot.syncedAt);
      setErrors(previous => { const next = { ...previous }; delete next.devices; delete next.stats; delete next.watchingNow; return next; });
    }).catch(error => { if (revision === clientRevision.current) reportError(error, epoch, 'devices'); }).finally(() => {
      if (generation.current !== epoch) return;
      clientsInFlight.current = null; setLoading(false);
    });
    clientsInFlight.current = { generation: epoch, promise };
    return promise;
  }, [reportError]);

  const commitDeviceChange = useCallback((device: Device | null, removedIds: string[] = []) => {
    if (!identityRef.current) return;
    if (device) {
      const actualScope = (device as Device & { admin_id?: string | null }).admin_id ?? null;
      if (actualScope !== (identityRef.current.subAdmin?.id ?? null)) return;
    }
    clientRevision.current += 1;
    setData(previous => {
      const devices = applyConfirmedDeviceChange(previous.devices, device, removedIds);
      if (!clientsLoadedRef.current) return { ...previous, devices };
      const overview = buildConfirmedPanelOverview(devices, previous.stats?.plans ?? 0);
      return { ...previous, devices, stats: overview.stats, watchingNow: overview.watchingNow as WatchingDevice[] };
    });
    metadataUpdatedAt.current = {};
  }, []);

  const loadSection: AdminPanelContextType['loadSection'] = useCallback((section, force = false): Promise<void> => {
    if (!identityRef.current || (section === 'subAdmins' && identityRef.current.subAdmin)) return Promise.resolve();
    const epoch = generation.current;
    requestedSections.current.add(section);
    if (force) { metadataRevision.current[section] = (metadataRevision.current[section] ?? 0) + 1; metadataUpdatedAt.current[section] = 0; }
    const pending = metadataInFlight.current[section];
    if (pending?.generation === epoch) return force
      ? pending.promise.then(() => generation.current === epoch ? loadSection(section) : undefined)
      : pending.promise;
    const updatedAt = metadataUpdatedAt.current[section];
    if (!force && updatedAt && Date.now() - updatedAt < panelMetadataFreshnessMs) return Promise.resolve();
    const revision = metadataRevision.current[section] ?? 0;
    setLoadingSections(previous => ({ ...previous, [section]: true }));
    const promise = metadataLoaders[section]().then(value => {
      if (generation.current !== epoch || revision !== (metadataRevision.current[section] ?? 0)) return;
      setData(previous => ({ ...previous, [section]: value }));
      setLoaded(previous => ({ ...previous, [section]: true }));
      metadataUpdatedAt.current[section] = Date.now();
      setErrors(previous => { const next = { ...previous }; delete next[section]; return next; });
    }).catch(error => { if (revision === (metadataRevision.current[section] ?? 0)) reportError(error, epoch, section); }).finally(() => {
      if (generation.current !== epoch) return;
      delete metadataInFlight.current[section]; setLoadingSections(previous => ({ ...previous, [section]: false }));
    });
    metadataInFlight.current[section] = { generation: epoch, promise };
    return promise;
  }, [reportError]);

  const loadAll = useCallback(async (silent = false): Promise<void> => {
    if (!identityRef.current) return;
    await Promise.allSettled([syncClients(silent, true), ...Array.from(requestedSections.current).map(section => loadSection(section, true))]);
  }, [syncClients, loadSection]);
  const loadWatching = useCallback(() => syncClients(true), [syncClients]);
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
        setSubAdminCredentials(result.admin.id, result.sessionToken);
        nextIdentity = { subAdmin: result.admin };
      } else {
        await rootAdminLogin(password);
        if (generation.current !== epoch) { clearAdminSession(); return null; }
        nextIdentity = { subAdmin: null };
      }
      identityRef.current = nextIdentity; setIdentity(nextIdentity);
      void syncClients(); // Only authentication is awaited by the login form.
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
    return `Não foi possível atualizar: ${keys.map(key => labels[key]).join(', ')}. ${errors[keys[0]]}${loaded.devices ? ' A lista exibida é a última confirmada.' : ' Ainda não há uma lista confirmada.'}`;
  }, [errors, loaded.devices]);
  const value = useMemo<AdminPanelContextType>(() => ({ ...data, authenticated: identity !== null,
    isSubAdmin: !!identity?.subAdmin, currentSubAdmin: identity?.subAdmin ?? null, loading, refreshing,
    loaded, loadingSections, lastSyncedAt, syncError, accessError, login, syncClients, commitDeviceChange,
    loadSection, loadAll, loadWatching, refresh, reset,
  }), [data, identity, loading, refreshing, loaded, loadingSections, lastSyncedAt, syncError, accessError,
    login, syncClients, commitDeviceChange, loadSection, loadAll, loadWatching, refresh, reset]);
  return <AdminPanelContext.Provider value={value}>{children}</AdminPanelContext.Provider>;
}
