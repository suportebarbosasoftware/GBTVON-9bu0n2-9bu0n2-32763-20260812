/**
 * Channel Filter Service — GBTVON
 * Manages hidden channels, hidden categories, and adult content blocking.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const HIDDEN_CHANNELS_KEY = 'gbtvon_hidden_channels';
const HIDDEN_CATEGORIES_KEY = 'gbtvon_hidden_categories';
const ADULT_BLOCK_KEY = 'gbtvon_adult_blocked';
const PARENTAL_PIN_KEY = 'gbtvon_parental_pin';

const DEFAULT_PIN = '0000';

// Adult content keywords for auto-detection
const ADULT_KEYWORDS = [
  'adult', 'adulto', 'adultos', 'xxx', '18+', '18 +', 'erotic',
  'erotico', 'erotica', 'porno', 'porn', 'sex', 'sexo', 'hot',
  'hentai', 'hardcore', 'playboy', 'prive', 'privê', 'vip adulto',
];

export function isAdultCategory(categoryName: string): boolean {
  const lower = categoryName.toLowerCase();
  return ADULT_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Hidden Channels ─────────────────────────────────────────────────

export async function getHiddenChannels(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_CHANNELS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function hideChannel(channelKey: string): Promise<void> {
  try {
    const list = await getHiddenChannels();
    if (!list.includes(channelKey)) {
      list.push(channelKey);
      await AsyncStorage.setItem(HIDDEN_CHANNELS_KEY, JSON.stringify(list));
    }
  } catch {}
}

export async function showChannel(channelKey: string): Promise<void> {
  try {
    const list = await getHiddenChannels();
    const filtered = list.filter(k => k !== channelKey);
    await AsyncStorage.setItem(HIDDEN_CHANNELS_KEY, JSON.stringify(filtered));
  } catch {}
}

export async function clearHiddenChannels(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HIDDEN_CHANNELS_KEY);
  } catch {}
}

// ─── Hidden Categories ────────────────────────────────────────────────

export async function getHiddenCategories(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_CATEGORIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function hideCategory(categoryId: string): Promise<void> {
  try {
    const list = await getHiddenCategories();
    if (!list.includes(categoryId)) {
      list.push(categoryId);
      await AsyncStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(list));
    }
  } catch {}
}

export async function showCategory(categoryId: string): Promise<void> {
  try {
    const list = await getHiddenCategories();
    const filtered = list.filter(k => k !== categoryId);
    await AsyncStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(filtered));
  } catch {}
}

export async function clearHiddenCategories(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HIDDEN_CATEGORIES_KEY);
  } catch {}
}

// ─── Adult Block ──────────────────────────────────────────────────────

export async function isAdultBlocked(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ADULT_BLOCK_KEY);
    if (raw === null) {
      // Default: NOT blocked — client decides if they want to hide
      await AsyncStorage.setItem(ADULT_BLOCK_KEY, 'false');
      return false;
    }
    return raw === 'true';
  } catch {
    return false;
  }
}

export async function setAdultBlocked(blocked: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ADULT_BLOCK_KEY, blocked ? 'true' : 'false');
  } catch {}
}

// ─── Parental PIN ─────────────────────────────────────────────────────

export async function getParentalPin(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(PARENTAL_PIN_KEY);
    return raw || DEFAULT_PIN;
  } catch {
    return DEFAULT_PIN;
  }
}

export async function setParentalPin(pin: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PARENTAL_PIN_KEY, pin);
  } catch {}
}

export async function verifyParentalPin(pin: string): Promise<boolean> {
  const stored = await getParentalPin();
  return pin === stored;
}

// ─── Load all filters at once ─────────────────────────────────────────

export interface FilterState {
  hiddenChannels: string[];
  hiddenCategories: string[];
  adultBlocked: boolean;
}

export async function loadFilterState(): Promise<FilterState> {
  const [hiddenChannels, hiddenCategories, adultBlocked] = await Promise.all([
    getHiddenChannels(),
    getHiddenCategories(),
    isAdultBlocked(),
  ]);
  return { hiddenChannels, hiddenCategories, adultBlocked };
}
