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

// Re-check activation every 2 minutes while app is in foreground
const POLL_INTERVAL_MS = 2 * 60 * 1000;

interface AuthContextType {
  isAuthenticated: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
    stopPolling();
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
    if (!email) return;
    try {
      const result = await checkActivation(email);
      // Only apply if server gave a definitive answer — ignore errors/timeouts
      if (result.status === 'error') return;
      applyActivationResult(result, true);
      await storeActivation(result);
    } catch {}
  }

  async function initAuth() {
    try {
      const [storedName, mac, cached] = await Promise.all([
        AsyncStorage.getItem(CLIENT_NAME_KEY),
        getDeviceId(),
        loadStoredActivation(),
      ]);

      setMacAddress(mac);

      if (mac) {
        // MAC is always the primary identifier — use it directly
        userEmailRef.current = mac; // reuse ref as identifier
        if (storedName) setClientName(storedName);

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
    } catch {}
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
      setAuth(authData);
      setPlanName(result.plan_name || null);
      setExpiresAt(result.expires_at || null);
      setIsAuthenticated(true);
      isAuthenticatedRef.current = true;
      startPolling();
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
    // Use MAC as the primary identifier; store client name for display
    const mac = await getDeviceId();
    userEmailRef.current = mac;
    setClientName(nameOrEmail.trim() || null);
    setUserEmail(nameOrEmail.trim() || null);

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
    isAuthenticatedRef.current = false;
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated, isLoading, auth, userEmail, macAddress,
      planName, expiresAt, activationStatus, gracePeriodUsed,
      blockReasonDetail, devicePrice,
      pendingNotifications, login, logout, refreshActivation, markNotificationsRead,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
