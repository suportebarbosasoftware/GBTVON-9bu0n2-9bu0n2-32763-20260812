import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_LIVE_CHANNEL_KEY = 'gbtvon_last_live_channel';

export interface LastLiveChannel {
  streamId: number;
  title: string;
  isAdult: boolean;
}

export async function saveLastLiveChannel(channel: LastLiveChannel): Promise<void> {
  // Protected content is never restored automatically on a new app session.
  if (channel.isAdult) return;
  try { await AsyncStorage.setItem(LAST_LIVE_CHANNEL_KEY, JSON.stringify(channel)); } catch {}
}

export async function getLastLiveChannel(): Promise<LastLiveChannel | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_LIVE_CHANNEL_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value?.streamId && value?.title ? value : null;
  } catch { return null; }
}
