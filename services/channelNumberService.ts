/**
 * Channel Number Service — GBTVON
 * Assigns sequential numbers to channels based on user setup order.
 * Numbers persist in AsyncStorage so they stay consistent across sessions.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GroupedChannel } from './channelGrouper';

const CHANNEL_NUMBERS_KEY = 'gbtvon_channel_numbers';

export interface NumberedChannel extends GroupedChannel {
  channelNumber: number;
}

/** Build and persist channel number map from ordered channel list */
export async function buildChannelNumbers(channels: GroupedChannel[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  channels.forEach((ch, index) => {
    const key = makeKey(ch);
    map.set(key, index + 1);
  });
  // Persist as JSON
  const obj: Record<string, number> = {};
  map.forEach((num, key) => { obj[key] = num; });
  try {
    await AsyncStorage.setItem(CHANNEL_NUMBERS_KEY, JSON.stringify(obj));
  } catch {}
  return map;
}

/** Load persisted channel numbers */
export async function loadChannelNumbers(): Promise<Map<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(CHANNEL_NUMBERS_KEY);
    if (!raw) return new Map();
    const obj: Record<string, number> = JSON.parse(raw);
    const map = new Map<string, number>();
    Object.entries(obj).forEach(([k, v]) => map.set(k, v));
    return map;
  } catch {
    return new Map();
  }
}

/** Apply channel numbers to a list, generating on-the-fly if missing */
export function applyChannelNumbers(
  channels: GroupedChannel[],
  numberMap: Map<string, number>
): NumberedChannel[] {
  return channels.map((ch, index) => {
    const key = makeKey(ch);
    const num = numberMap.get(key) ?? (index + 1);
    return { ...ch, channelNumber: num };
  });
}

/** Find a channel by its number */
export function findChannelByNumber(
  channels: NumberedChannel[],
  num: number
): NumberedChannel | undefined {
  return channels.find(ch => ch.channelNumber === num);
}

export function makeKey(ch: GroupedChannel): string {
  return `${ch.categoryId}::${ch.baseName.toLowerCase()}`;
}
