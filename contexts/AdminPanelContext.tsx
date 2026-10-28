/** Administrative panel state: independent loads, one identity and stale-response protection. */
import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getDevices, getPlans, getStats, getNotifications, getWatchingNow, getSubAdmins,
  rootAdminLogin, subAdminLogin,
} from '@/services/adminApiService';
import type { Device, Plan, AdminStats, Notification, WatchingDevice, SubAdmin } from '@/services/adminApiService';
import { getRepresentatives, getSources } from '@/services/repApiService';
import type { Representative, Source } from '@/services/repApiService';
import { clearAdminSession, setSubAdminCredentials } from '@/services/adminSessionService';
import { isAdminAuthError } from '@/services/adminTransportService';

type Section = 'stats' | 'devices' | 'plans' | 'notifications' | 'reps' | 'sources' | 'subAdmins' | 'watchingNow';
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
export interface AdminPanelContextType extends PanelData {
  authenticated: boolean;
  isSubAdmin: boolean;
  currentSubAdmin: SubAdmin | null;
  loading: boolean;
  refreshing: boolean;
  loaded: Partial<Record<Section, boolean>>;
  syncError: string;
  accessError: string;
  login: (mode: 'root' | 'subadmin', password: string, username: string) => Promise<string | null>;
  loadAll: (silent?: boolean) => Promise<void>;
  loadWatching: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}
const emptyData = (): PanelData => ({ stats: null, devices: [], plans: [], notifications: [], reps: [], sources: [], subAdmins: [], watchingNow: [] });
const labels: Record<Section, string> = { stats: 'Resumo', devices: 'Dispositivos', plans: 'Planos', notifications: 'Avisos', reps: 'Representantes', sources: 'Fontes', subAdmins: 'Sub-admins', watchingNow: 'Assistindo' };

export const AdminPanelContext = createContext<AdminPanelContextType | undefined>(undefined);

export function AdminPanelProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PanelData>(emptyData);
  const [identity, setIdentity] = useState<PanelIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState<Partial<Record<Section, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});
  const [accessError, setAccessError] = useState('');
  const identityRef = useRef<PanelIdentity | null>(null);
  const generation = useRef(0);
  const loginInFlight = useRef(false);
  const loadInFlight = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const watchingInFlight = useRef<{ generation: number; promise: Promise<void> } | null>(null);

  const reset = useCallback(() => {
    generation.current += 1;
    identityRef.current = null;
    clearAdminSession();
    setIdentity(null);
    setData(emptyData());
    setLoaded({});
    setErrors({});
    setAccessError('');
    setLoading(false);
    setRefreshing(false);
    loadInFlight.current = null;
    watchingInFlight.current = null;
  }, []);

  const invalidateSession = useCallback((error: unknown, epoch: number) => {
    if (generation.current !== epoch) return;
    reset();
    setAccessError(error instanceof Error ? error.message : 'Sessão inválida. Faça login novamente.');
  }, [reset]);

  const loadAll = useCallback((silent = false): Promise<void> => {
    if (!identityRef.current) return Promise.resolve();
    const epoch = generation.current;
    if (loadInFlight.current?.generation === epoch) return loadInFlight.current.promise;
    if (!silent) setLoading(true);
    const tasks: { key: Section; run: () => Promise<unknown> }[] = [
      { key: 'devices', run: getDevices },
      { key: 'stats', run: getStats },
      { key: 'plans', run: getPlans },
      { key: 'reps', run: getRepresentatives },
      { key: 'sources', run: getSources },
      { key: 'notifications', run: getNotifications },
      { key: 'watchingNow', run: getWatchingNow },
    ];
    if (!identityRef.current.subAdmin) tasks.push({ key: 'subAdmins', run: getSubAdmins });
    const promise = Promise.allSettled(tasks.map(async task => {
      try {
        const value = await task.run();
        if (generation.current !== epoch) return;
        // Publish each successful query immediately; a different failing query cannot discard it.
        setData(previous => ({ ...previous, [task.key]: value }));
        setLoaded(previous => ({ ...previous, [task.key]: true }));
        setErrors(previous => { const next = { ...previous }; delete next[task.key]; return next; });
      } catch (error) {
        if (generation.current !== epoch) return;
        if (isAdminAuthError(error)) { invalidateSession(error, epoch); return; }
        setErrors(previous => ({ ...previous, [task.key]: error instanceof Error ? error.message : 'Falha ao carregar.' }));
        // Network/server errors do not clear the session or previous successful data.
      }
    })).then(() => {
      if (generation.current !== epoch) return;
      setLoading(false);
      setRefreshing(false);
      loadInFlight.current = null;
    });
    loadInFlight.current = { generation: epoch, promise };
    return promise;
  }, [invalidateSession]);

  const loadWatching = useCallback((): Promise<void> => {
    if (!identityRef.current) return Promise.resolve();
    const epoch = generation.current;
    if (loadInFlight.current?.generation === epoch) return loadInFlight.current.promise;
    if (watchingInFlight.current?.generation === epoch) return watchingInFlight.current.promise;
    const promise = getWatchingNow().then(value => {
      if (generation.current !== epoch) return;
      setData(previous => ({ ...previous, watchingNow: value }));
      setLoaded(previous => ({ ...previous, watchingNow: true }));
      setErrors(previous => { const next = { ...previous }; delete next.watchingNow; return next; });
    }).catch(error => {
      if (generation.current !== epoch) return;
      if (isAdminAuthError(error)) { invalidateSession(error, epoch); return; }
      setErrors(previous => ({ ...previous, watchingNow: error instanceof Error ? error.message : 'Falha ao atualizar conteúdo.' }));
    }).finally(() => {
      if (generation.current === epoch) watchingInFlight.current = null;
    });
    watchingInFlight.current = { generation: epoch, promise };
    return promise;
  }, [invalidateSession]);

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
      await loadAll();
      return null;
    } catch (error) {
      if (generation.current !== epoch) return null;
      clearAdminSession();
      return error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.';
    } finally {
      loginInFlight.current = false;
      if (generation.current === epoch) setLoading(false);
    }
  }, [reset, loadAll]);

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
    currentSubAdmin: identity?.subAdmin ?? null, loading, refreshing, loaded, syncError, accessError,
    login, loadAll, loadWatching, refresh, reset,
  }), [data, identity, loading, refreshing, loaded, syncError, accessError, login, loadAll, loadWatching, refresh, reset]);

  return <AdminPanelContext.Provider value={value}>{children}</AdminPanelContext.Provider>;
}
