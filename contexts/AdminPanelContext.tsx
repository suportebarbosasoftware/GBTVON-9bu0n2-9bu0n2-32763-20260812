/** Administrative panel: fast MAC snapshots, on-demand metadata and stale-identity protection. */
import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getPanelSnapshot, getPlans, getNotifications, getSubAdmins, rootAdminLogin, subAdminLogin } from '@/services/adminApiService';
import type { Device, Plan, AdminStats, Notification, WatchingDevice, SubAdmin } from '@/services/adminApiService';
import { getRepresentatives, getSources } from '@/services/repApiService';
import type { Representative, Source } from '@/services/repApiService';
import { clearAdminSession, setSubAdminCredentials } from '@/services/adminSessionService';
import { isAdminAuthError } from '@/services/adminTransportService';
import { panelMetadataFreshnessMs } from '@/constants/adminPanel';

type SecondarySection = 'plans' | 'notifications' | 'reps' | 'sources' | 'subAdmins';
type Section = 'stats' | 'devices' | 'watchingNow' | SecondarySection;
interface PanelData {
  stats: AdminStats | null;
  devices: Device[];
  plans: Plan[];
  notifications: Notification[];
  reps: Representative[];
  sources: Source[];
  subAdmins: SubAdmin[];
  watchingNow: WatchingDevice[];
}
interface PanelIdentity { subAdmin: SubAdmin | null; }
interface InFlight { generation: number; promise: Promise<void>; }
export interface AdminPanelContextType extends PanelData {
  authenticated: boolean;
  isSubAdmin: boolean;
  currentSubAdmin: SubAdmin | null;
  loading: boolean;
  refreshing: boolean;
  lastSyncedAt: string | null;
  loaded: Partial<Record<Section, boolean>>;
  loadingSections: Partial<Record<SecondarySection, boolean>>;
  syncError: string;
  accessError: string;
  login: (mode: 'root' | 'subadmin', password: string, username: string) => Promise<string | null>;
  syncClients: (silent?: boolean) => Promise<void>;
  loadSection: (section: SecondarySection, force?: boolean) => Promise<void>;
  loadAll: (silent?: boolean) => Promise<void>;
  loadWatching: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}
const emptyData = (): PanelData => ({ stats: null, devices: [], plans: [], notifications: [], reps: [], sources: [], subAdmins: [], watchingNow: [] });
const labels: Record<Section, string> = { stats: 'Resumo', devices: 'MACs e clientes', plans: 'Planos', notifications: 'Avisos', reps: 'Representantes', sources: 'Fontes', subAdmins: 'Sub-admins', watchingNow: 'Assistindo' };
const metadataLoaders: Record<SecondarySection, () => Promise<unknown>> = {
  plans: getPlans, notifications: getNotifications, reps: getRepresentatives, sources: getSources, subAdmins: getSubAdmins,
};

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
  const loginInFlight = useRef(false);
  const clientsInFlight = useRef<InFlight | null>(null);
  const metadataInFlight = useRef<Partial<Record<SecondarySection, InFlight>>>({});
  const requestedSections = useRef<Set<SecondarySection>>(new Set());
  const metadataUpdatedAt = useRef<Partial<Record<SecondarySection, number>>>({});

  const reset = useCallback(() => {
    generation.current += 1;
    identityRef.current = null;
    clearAdminSession();
    setIdentity(null);
    setData(emptyData());
    setLoaded({});
    setLoadingSections({});
    setErrors({});
    setAccessError('');
    setLoading(false);
    setRefreshing(false);
    setLastSyncedAt(null);
    clientsInFlight.current = null;
    metadataInFlight.current = {};
    requestedSections.current = new Set();
    metadataUpdatedAt.current = {};
  }, []);

  const reportError = useCallback((error: unknown, epoch: number, key: Section) => {
    if (generation.current !== epoch) return;
    const message = error instanceof Error ? error.message : 'Falha ao atualizar o painel.';
    if (isAdminAuthError(error)) {
      reset();
      setAccessError(message);
      return;
    }
    setErrors(previous => ({ ...previous, [key]: message }));
  }, [reset]);

  const syncClients = useCallback((silent = false): Promise<void> => {
    if (!identityRef.current) return Promise.resolve();
    const epoch = generation.current;
    if (!silent) setLoading(true);
    if (clientsInFlight.current?.generation === epoch) return clientsInFlight.current.promise;
    const promise = getPanelSnapshot().then(snapshot => {
      if (generation.current !== epoch) return;
      // Publish related lists and counts together so the header cannot disagree with its MAC list.
      setData(previous => ({ ...previous, devices: snapshot.devices, stats: snapshot.stats, watchingNow: snapshot.watchingNow }));
      setLoaded(previous => ({ ...previous, devices: true, stats: true, watchingNow: true }));
      setLastSyncedAt(snapshot.syncedAt);
      setErrors(previous => {
        const next = { ...previous };
        delete next.devices; delete next.stats; delete next.watchingNow;
        return next;
      });
    }).catch(error => reportError(error, epoch, 'devices')).finally(() => {
      if (generation.current !== epoch) return;
      setLoading(false);
      setRefreshing(false);
      clientsInFlight.current = null;
    });
    clientsInFlight.current = { generation: epoch, promise };
    return promise;
  }, [reportError]);

  const loadSection = useCallback((section: SecondarySection, force = false): Promise<void> => {
    if (!identityRef.current || (section === 'subAdmins' && identityRef.current.subAdmin)) return Promise.resolve();
    const epoch = generation.current;
    requestedSections.current.add(section);
    const pending = metadataInFlight.current[section];
    if (pending?.generation === epoch) return pending.promise;
    const updatedAt = metadataUpdatedAt.current[section];
    if (!force && updatedAt && Date.now() - updatedAt < panelMetadataFreshnessMs) return Promise.resolve();
    setLoadingSections(previous => ({ ...previous, [section]: true }));
    const promise = metadataLoaders[section]().then(value => {
      if (generation.current !== epoch) return;
      setData(previous => ({ ...previous, [section]: value }));
      setLoaded(previous => ({ ...previous, [section]: true }));
      metadataUpdatedAt.current[section] = Date.now();
      setErrors(previous => { const next = { ...previous }; delete next[section]; return next; });
    }).catch(error => reportError(error, epoch, section)).finally(() => {
      if (generation.current !== epoch) return;
      delete metadataInFlight.current[section];
      setLoadingSections(previous => ({ ...previous, [section]: false }));
    });
    metadataInFlight.current[section] = { generation: epoch, promise };
    return promise;
  }, [reportError]);

  const loadAll = useCallback(async (silent = false): Promise<void> => {
    if (!identityRef.current) return;
    // Manual refresh / completed changes also reload tabs already visited, but never lock MAC polling.
    await Promise.allSettled([
      syncClients(silent),
      ...Array.from(requestedSections.current).map(section => loadSection(section, true)),
    ]);
  }, [syncClients, loadSection]);

  const loadWatching = useCallback(() => syncClients(true), [syncClients]);

  const login = useCallback(async (mode: 'root' | 'subadmin', password: string, username: string): Promise<string | null> => {
    if (loginInFlight.current) return null;
    loginInFlight.current = true;
    reset();
    const epoch = generation.current;
    setLoading(true);
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
      identityRef.current = nextIdentity;
      setIdentity(nextIdentity);
      // Enter immediately after authentication; unrelated tabs are not downloaded at login.
      void syncClients();
      return null;
    } catch (error) {
      if (generation.current !== epoch) return null;
      clearAdminSession();
      return error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.';
    } finally {
      loginInFlight.current = false;
      if (generation.current === epoch && !identityRef.current) setLoading(false);
    }
  }, [reset, syncClients]);

  const refresh = useCallback(async () => {
    if (!identityRef.current) return;
    setRefreshing(true);
    await loadAll();
  }, [loadAll]);
  const syncError = useMemo(() => {
    const keys = Object.keys(errors) as Section[];
    if (!keys.length) return '';
    return `Não foi possível atualizar: ${keys.map(key => labels[key]).join(', ')}. ${errors[keys[0]]} Dados já carregados foram mantidos.`;
  }, [errors]);
  const value = useMemo<AdminPanelContextType>(() => ({
    ...data, authenticated: identity !== null, isSubAdmin: !!identity?.subAdmin,
    currentSubAdmin: identity?.subAdmin ?? null, loading, refreshing, loaded, loadingSections, lastSyncedAt, syncError, accessError,
    login, syncClients, loadSection, loadAll, loadWatching, refresh, reset,
  }), [data, identity, loading, refreshing, loaded, loadingSections, lastSyncedAt, syncError, accessError, login, syncClients, loadSection, loadAll, loadWatching, refresh, reset]);

  return <AdminPanelContext.Provider value={value}>{children}</AdminPanelContext.Provider>;
}
