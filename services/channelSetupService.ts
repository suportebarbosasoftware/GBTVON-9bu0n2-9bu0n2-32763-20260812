/**
 * Channel Setup Service — GBTVON
 * Manages the user's personal channel selection (SKY-like setup).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETUP_DONE_KEY = 'gbtvon_setup_done';
const SELECTED_CHANNELS_KEY = 'gbtvon_selected_channels';

export interface SelectedChannelEntry {
  streamId: number;
  baseName: string;
  categoryId: string;
  icon: string;
}

export async function isSetupDone(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(SETUP_DONE_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markSetupDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(SETUP_DONE_KEY, 'true');
  } catch {}
}

export async function resetSetup(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([SETUP_DONE_KEY, SELECTED_CHANNELS_KEY]);
  } catch {}
}

export async function getSelectedChannelKeys(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SELECTED_CHANNELS_KEY);
    if (!raw) return new Set();
    const arr: string[] = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export async function saveSelectedChannelKeys(keys: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(SELECTED_CHANNELS_KEY, JSON.stringify(Array.from(keys)));
  } catch {}
}

/** Returns true if user has any selection saved (non-empty) */
export async function hasChannelSelection(): Promise<boolean> {
  const keys = await getSelectedChannelKeys();
  return keys.size > 0;
}

/** Build a channel key from baseName + categoryId */
export function makeChannelKey(baseName: string, categoryId: string): string {
  return `${categoryId}::${baseName.toLowerCase()}`;
}
