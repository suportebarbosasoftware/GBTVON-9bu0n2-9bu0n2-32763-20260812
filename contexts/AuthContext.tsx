import React, { createContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { XtreamAuth } from '@/services/xtreamApi';
import {
  checkActivation,
  loadStoredActivation,
  clearActivationCache,
  storeActivation,
  ActivationResult,
  ActivationNotification,
} from '@/services/activationService';
import { getDeviceId } from '@/services/deviceIdService';
import { DEMO_REPRESENTATIVE_CODE } from '@/services/demoCatalog';

// Access is checked in the background only. Content navigation must never be
// interrupted by an activation check, especially on lower-powered TV boxes.
// The admin panel classifies a device as online from its recent heartbeat.
// Keep the interval safely below that window, including on webOS where a
// packaged web app can stay open for hours without navigating anywhere.
const POLL_INTERVAL_MS = 3 * 60 * 1000;

interface AuthContextType {
  isAuthenticated: boolean;
  isDemoMode: boolean;
  isLoading: boolean;
  auth: XtreamAuth | null;
  userEmail: string | null;
  macAddress: string | null;
  planName: string | null;
  expiresAt: string | null;
  activationStatus: ActivationResult['status'] | null;
  gracePeriodUsed: boolean;
  blockReasonDetail: string | null;
  devicePrice: number | null;
  pendingNotifications: ActivationNotification[];
  login: (email: string, repCode?: string) => Promise<{ success: boolean; status: string; error?: string; message?: string }>;
  logout: () => Promise<void>;
  refreshActivation: () => Promise<void>;
  markNotificationsRead: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const CLIENT_NAME_KEY = 'gbtvon_client_name';
const DEMO_MODE_KEY = 'gbtvon_demo_mode';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [auth, setAuth] = useState<XtreamAuth | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null); // kept for backward compat
  const [clientName, setClientName] = useState<string | null>(null);
  const [macAddress, setMacAddress] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [activationStatus, setActivationStatus] = useState<ActivationResult['status'] | null>(null);
  const [gracePeriodUsed, setGracePeriodUsed] = useState(false);
  const [blockReasonDetail, setBlockReasonDetail] = useState<string | null>(null);
  const [devicePrice, setDevicePrice] = useState<number | null>(null);
  const [pendingNotifications, setPendingNotifications] = useState<ActivationNotification[]>([]);

  const userEmailRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');
  const isAuthenticatedRef = useRef(false);
  const silentRefreshInFlightRef = useRef(false);

  useEffect(() => {
    initAuth();

    // Listen for app state changes to re-check when foregrounded
    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'active' && prev !== 'active') {
        // App returned to foreground — immediate re-check
        silentRefresh();
      }
    });

    return () => {
      sub.remove();
      stopPolling();
    };
  }, []);

  function startPolling() {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      silentRefresh();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  /** Silent background check — updates state without showing loading.
   * Only applies result if it's a definitive state (activated/blocked/expired).
   * Never revokes an active session due to network errors or timeouts.
   */
  async function silentRefresh() {
    const email = userEmailRef.current;
    if (!email || silentRefreshInFlightRef.current) return;
    silentRefreshInFlightRef.current = true;
    try {
      const result = await checkActivation(email);
      // Only apply if server gave a definitive answer — ignore errors/timeouts
      if (result.status === 'error') return;
      applyActivationResult(result, true);
      await storeActivation(result);
    } catch {} finally {
      silentRefreshInFlightRef.current = false;
    }
  }

  async function initAuth() {
    try {
      const [storedName, mac, cached, demoMode] = await Promise.all([
        AsyncStorage.getItem(CLIENT_NAME_KEY),
        getDeviceId(),
        loadStoredActivation(),
        AsyncStorage.getItem(DEMO_MODE_KEY),
      ]);

      setMacAddress(mac);

      if (demoMode === 'true') {
        const demoName = storedName || 'Demonstração LG';
        setClientName(demoName);
        setUserEmail(demoName);
        setPlanName('Demonstração');
        setExpiresAt(null);
        setAuth(null);
        setActivationStatus('activated');
        setIsDemoMode(true);
        setIsAuthenticated(true);
        isAuthenticatedRef.current = true;
        setIsLoading(false);
        return;
      }

      if (mac) {
        // MAC is always the primary identifier — use it directly
        userEmailRef.current = mac; // reuse ref as identifier
        if (storedName) {
          setClientName(storedName);
          // The profile uses this legacy field. Restore the customer's real
          // name on every launch instead of falling back to "Usuário".
          setUserEmail(storedName);
        }

        if (cached) {
          // Apply cached state immediately so UI loads fast
          applyActivationResult(cached);
        }

        // Do a fresh check in background with a timeout — don't block startup
        setIsLoading(false);
        silentRefreshWithEmail(mac);
        return;
      }
    } catch {}
    setIsLoading(false);
  }

  async function silentRefreshWithEmail(email: string) {
    if (silentRefreshInFlightRef.current) return;
    silentRefreshInFlightRef.current = true;
    try {
      // 15-second timeout so it never hangs indefinitely
      const result = await Promise.race([
        checkActivation(email),
        new Promise<ActivationResult>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 15000)
        ),
      ]) as ActivationResult;
      // Only apply definitive results — never revoke active session on error/timeout
      if (result.status === 'error') return;
      applyActivationResult(result, true);
      await storeActivation(result);
    } catch {} finally {
      silentRefreshInFlightRef.current = false;
    }
  }

  function applyActivationResult(result: ActivationResult, silent = false) {
    setActivationStatus(result.status);
    setGracePeriodUsed(result.grace_period_used || false);
    setBlockReasonDetail((result as any).block_reason_detail || null);
    setDevicePrice((result as any).price || null);

    // Merge new notifications (don't replace unread ones)
    if (result.notifications && result.notifications.length > 0) {
      setPendingNotifications(result.notifications);
    }

    if (result.status === 'activated' && result.credentials) {
      const authData: XtreamAuth = {
        username: result.credentials.username,
        password: result.credentials.password,
        server: result.credentials.server,
      };
      // Do not replace auth with an equivalent object. The content hooks use
      // this reference as a dependency, so replacing it forced every catalog
      // to reload and reset its TV list even when the license was unchanged.
      setAuth(current =>
        current &&
        current.username === authData.username &&
        current.password === authData.password &&
        current.server === authData.server
          ? current
          : authData
      );
      setPlanName(result.plan_name || null);
      setExpiresAt(result.expires_at || null);
      setIsAuthenticated(true);
      const becameAuthenticated = !isAuthenticatedRef.current;
      isAuthenticatedRef.current = true;
      if (becameAuthenticated) startPolling();
    } else if (result.status === 'blocked_manual' || result.status === 'expired') {
      // Only these definitive statuses revoke access
      setAuth(null);
      setPlanName(null);
      setExpiresAt(null);
      setIsAuthenticated(false);
      isAuthenticatedRef.current = false;
      stopPolling();
    }
    // 'pending' and 'error' do NOT revoke an existing active session
  }

  async function login(nameOrEmail: string, repCode?: string): Promise<{ success: boolean; status: string; error?: string; message?: string }> {
    const clientName = nameOrEmail.trim() || 'Demonstração LG';
    if (repCode?.trim() === DEMO_REPRESENTATIVE_CODE) {
      stopPolling();
      userEmailRef.current = null;
      setClientName(clientName);
      setUserEmail(clientName);
      setPlanName('Demonstração');
      setExpiresAt(null);
      setAuth(null);
      setActivationStatus('activated');
      setGracePeriodUsed(false);
      setBlockReasonDetail(null);
      setDevicePrice(null);
      setIsDemoMode(true);
      setIsAuthenticated(true);
      isAuthenticatedRef.current = true;
      await Promise.all([
        AsyncStorage.setItem(CLIENT_NAME_KEY, clientName),
        AsyncStorage.setItem(DEMO_MODE_KEY, 'true'),
        clearActivationCache(),
      ]);
      return { success: true, status: 'activated', message: 'Modo de demonstração iniciado.' };
    }

    // Use MAC as the primary identifier; store client name for display
    const mac = await getDeviceId();
    userEmailRef.current = mac;
    setClientName(nameOrEmail.trim() || null);
    setUserEmail(nameOrEmail.trim() || null);
    setIsDemoMode(false);
    await AsyncStorage.removeItem(DEMO_MODE_KEY);

    const result = await checkActivation(mac, { repCode: repCode?.trim() || undefined, clientName: nameOrEmail.trim() || undefined });

    applyActivationResult(result);

    if (result.status === 'activated') {
      await Promise.all([
        AsyncStorage.setItem(CLIENT_NAME_KEY, nameOrEmail.trim()),
        storeActivation(result),
      ]);
      return { success: true, status: 'activated' };
    }

    if (result.status === 'pending') {
      await AsyncStorage.setItem(CLIENT_NAME_KEY, nameOrEmail.trim());
      await storeActivation(result);
      return { success: false, status: 'pending', message: result.message || 'Aguardando ativação.' };
    }

    if (result.status === 'expired') {
      await AsyncStorage.setItem(CLIENT_NAME_KEY, nameOrEmail.trim());
      await storeActivation(result);
      return { success: false, status: 'expired', message: result.message };
    }

    if (result.status === 'blocked_manual') {
      await AsyncStorage.setItem(CLIENT_NAME_KEY, nameOrEmail.trim());
      await storeActivation(result);
      return { success: false, status: 'blocked_manual', message: result.message };
    }

    return { success: false, status: 'error', error: result.error || 'Erro desconhecido.' };
  }

  async function refreshActivation() {
    if (isDemoMode) return;
    if (!userEmailRef.current) return;
    const result = await checkActivation(userEmailRef.current);
    applyActivationResult(result);
    await storeActivation(result);
  }

  function markNotificationsRead() {
    setPendingNotifications([]);
  }

  async function logout() {
    stopPolling();
    userEmailRef.current = null;
    await Promise.all([
      AsyncStorage.removeItem(CLIENT_NAME_KEY),
      AsyncStorage.removeItem(DEMO_MODE_KEY),
      clearActivationCache(),
    ]);
    setAuth(null);
    setUserEmail(null);
    setClientName(null);
    setPlanName(null);
    setExpiresAt(null);
    setActivationStatus(null);
    setGracePeriodUsed(false);
    setPendingNotifications([]);
    setIsAuthenticated(false);
    setIsDemoMode(false);
    isAuthenticatedRef.current = false;
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated, isDemoMode, isLoading, auth, userEmail, macAddress,
      planName, expiresAt, activationStatus, gracePeriodUsed,
      blockReasonDetail, devicePrice,
      pendingNotifications, login, logout, refreshActivation, markNotificationsRead,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
