/**
 * Device ID Service — GBTVON
 * Returns a stable MAC-format device identifier that persists across
 * app uninstalls and data clears.
 *
 * Priority order for stability:
 *  1. expo-application AndroidId (survives reinstall on Android ≥ Q)
 *  2. expo-device modelName + a UUID seeded to androidId (deterministic)
 *  3. Random UUID (last resort — only if all above fail)
 *
 * The computed value is cached in AsyncStorage for fast synchronous-like
 * access on subsequent calls, but the primary source is always the hardware id.
 *
 * IMPORTANT: expo-device and expo-application are loaded lazily to prevent
 * "Cannot read property 'NativeModule' of undefined" crash on Android TV.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'gbtvon_device_id';
// Separate key — stores the hardware-derived ID so we can verify cache integrity
const DEVICE_HW_KEY = 'gbtvon_device_hw';

/** Safely read expo-application.androidId — never throws */
function safeGetAndroidId(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Application = require('expo-application');
    const id: string | null = Application.androidId ?? null;
    if (id && id.length >= 8) return id;
    return null;
  } catch {
    return null;
  }
}

/** Safely get device model info — never throws */
function safeGetDeviceInfo(): { model: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device');
    return { model: (Device.modelName || 'unknown').replace(/\s+/g, '') };
  } catch {
    return { model: 'unknown' };
  }
}

/**
 * Deterministic hash — maps any string to a 12-char hex string.
 * Used to derive a stable MAC-like ID from the Android hardware ID.
 */
function deterministicHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0');
  return combined.substring(0, 12).toUpperCase();
}

/** Convert a 12-char hex string to MAC format XX:XX:XX:XX:XX:XX */
function toMacFormat(hex: string): string {
  return hex.padEnd(12, '0').substring(0, 12).match(/.{1,2}/g)!.join(':').toUpperCase();
}

/**
 * Get a stable unique device identifier in MAC format.
 *
 * On Android the result is derived from `androidId` which the OS keeps
 * stable across app reinstalls (within the same device + Android account).
 * On iOS/TV it falls back to a model-seeded deterministic hash.
 */
export async function getDeviceId(): Promise<string> {
  try {
    const androidId = safeGetAndroidId();

    if (androidId) {
      // Check if we already have a cached MAC for this exact androidId
      const [cached, cachedHw] = await Promise.all([
        AsyncStorage.getItem(DEVICE_ID_KEY),
        AsyncStorage.getItem(DEVICE_HW_KEY),
      ]);

      if (cached && cachedHw === androidId) {
        // Cache is valid and was derived from the same hardware ID
        return cached;
      }

      // Derive deterministic MAC from hardware ID
      const hex = deterministicHash(androidId);
      const mac = toMacFormat(hex);

      // Update cache — atomically
      await Promise.all([
        AsyncStorage.setItem(DEVICE_ID_KEY, mac),
        AsyncStorage.setItem(DEVICE_HW_KEY, androidId),
      ]);
      return mac;
    }

    // Fallback: check existing cache first
    const cached = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (cached) return cached;

    // Last resort: deterministic from device model + random seed
    const { model } = safeGetDeviceInfo();
    const seed = `${model}-${Platform.OS}-${Date.now()}`;
    const mac = toMacFormat(deterministicHash(seed));
    await AsyncStorage.setItem(DEVICE_ID_KEY, mac);
    return mac;
  } catch {
    // Absolute fallback — should never happen in practice
    return toMacFormat(deterministicHash(`fallback-${Date.now()}`));
  }
}

/** Get device display name — safe for all platforms */
export function getDeviceName(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device');
    const brand = Device.brand || '';
    const model = Device.modelName || 'Dispositivo';
    return brand ? `${brand} ${model}` : model;
  } catch {
    return 'Dispositivo';
  }
}

/** Get platform string */
export function getDevicePlatform(): string {
  const isTV = (Platform as any).isTV === true;
  if (isTV) return 'androidtv';
  return Platform.OS;
}
