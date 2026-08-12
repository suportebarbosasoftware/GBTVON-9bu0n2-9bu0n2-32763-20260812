/**
 * Activation Service — GBTVON
 * Handles device registration, activation check, and credential retrieval
 * via the device-check Edge Function.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getDeviceId, getDeviceName, getDevicePlatform } from './deviceIdService';

const ACTIVATION_CACHE_KEY = 'gbtvon_activation_cache';

export interface ActivationCredentials {
  server: string;
  username: string;
  password: string;
}

export interface ActivationNotification {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

export interface ActivationResult {
  status: 'activated' | 'pending' | 'expired' | 'blocked_manual' | 'error';
  credentials?: ActivationCredentials;
  plan_name?: string;
  expires_at?: string | null;
  mac_address?: string;
  email?: string;
  grace_period_used?: boolean;
  notifications?: ActivationNotification[];
  message?: string;
  error?: string;
}

interface CachedActivation {
  result: ActivationResult;
  timestamp: number;
}

/** Check device activation and get credentials if active */
export async function checkActivation(
  email: string,
  options?: { markGracePeriod?: boolean; repCode?: string }
): Promise<ActivationResult> {
  try {
    const mac = await getDeviceId();
    const deviceName = getDeviceName();
    const platform = getDevicePlatform();

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('device-check', {
      body: {
        email,
        mac_address: mac,
        device_name: deviceName,
        platform,
        mark_grace_period: options?.markGracePeriod || false,
        rep_code: options?.repCode || undefined,
      },
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const text = await error.context?.text();
          const parsed = text ? JSON.parse(text) : null;
          msg = parsed?.error || text || msg;
        } catch {}
      }
      return { status: 'error', error: msg };
    }

    const result: ActivationResult = data;

    // Cache activated result for offline startup
    if (result.status === 'activated') {
      await AsyncStorage.setItem(ACTIVATION_CACHE_KEY, JSON.stringify({
        result,
        timestamp: Date.now(),
      }));
    }

    return result;
  } catch (err: any) {
    return { status: 'error', error: `Erro de conexão: ${err.message}` };
  }
}

/** Activate 3-day grace period (one-time use) */
export async function activateGracePeriod(email: string): Promise<ActivationResult> {
  return checkActivation(email, { markGracePeriod: true });
}

/** Clear activation cache (on logout) */
export async function clearActivationCache(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVATION_CACHE_KEY);
}

/** Store activation permanently (persists across launches) */
export async function storeActivation(result: ActivationResult): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVATION_CACHE_KEY, JSON.stringify({
      result,
      timestamp: Date.now(),
    }));
  } catch {}
}

/** Load stored activation (ignores TTL — used on cold start) */
export async function loadStoredActivation(): Promise<ActivationResult | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVATION_CACHE_KEY);
    if (!raw) return null;
    const cache: CachedActivation = JSON.parse(raw);
    return cache.result;
  } catch {
    return null;
  }
}
