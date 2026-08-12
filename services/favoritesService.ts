import AsyncStorage from '@react-native-async-storage/async-storage';

const FAVORITES_KEY = 'gbtvon_favorites';
const HISTORY_KEY = 'gbtvon_history';
const PROGRESS_KEY = 'gbtvon_progress';
const COMPLETED_KEY = 'gbtvon_completed';

export interface FavoriteItem {
  id: string;
  type: 'movie' | 'series';
  name: string;
  poster: string;
  addedAt: number;
}

export interface HistoryItem {
  id: string;
  type: 'movie' | 'series' | 'episode';
  name: string;
  poster: string;
  watchedAt: number;
  progress?: number; // 0-1 for VOD
  seriesId?: string;
  seriesName?: string;
}

// ──────────────── FAVORITES ────────────────

export async function getFavorites(): Promise<FavoriteItem[]> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addFavorite(item: Omit<FavoriteItem, 'addedAt'>): Promise<void> {
  try {
    const list = await getFavorites();
    const exists = list.find(f => f.id === item.id && f.type === item.type);
    if (!exists) {
      list.unshift({ ...item, addedAt: Date.now() });
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    }
  } catch {}
}

export async function removeFavorite(id: string, type: 'movie' | 'series'): Promise<void> {
  try {
    const list = await getFavorites();
    const filtered = list.filter(f => !(f.id === id && f.type === type));
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(filtered));
  } catch {}
}

export async function isFavorite(id: string, type: 'movie' | 'series'): Promise<boolean> {
  try {
    const list = await getFavorites();
    return list.some(f => f.id === id && f.type === type);
  } catch {
    return false;
  }
}

// ──────────────── HISTORY ────────────────

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addToHistory(item: Omit<HistoryItem, 'watchedAt'>): Promise<void> {
  try {
    let list = await getHistory();
    // Remove existing entry with same id+type
    list = list.filter(h => !(h.id === item.id && h.type === item.type));
    list.unshift({ ...item, watchedAt: Date.now() });
    // Keep max 50 entries
    if (list.length > 50) list = list.slice(0, 50);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {}
}

export async function isWatched(id: string, type: string): Promise<boolean> {
  try {
    const list = await getHistory();
    return list.some(h => h.id === id && h.type === type);
  } catch {
    return false;
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch {}
}

// ──────────────── WATCH PROGRESS ────────────────
// Saves playback position for movies/episodes so user can resume

export interface WatchProgress {
  id: string;          // episodeId or streamId
  type: 'movie' | 'episode';
  position: number;    // seconds
  duration: number;    // total seconds (0 if unknown)
  updatedAt: number;
  seriesId?: string;
  seriesName?: string;
  title?: string;
  poster?: string;
}

export async function saveProgress(item: WatchProgress): Promise<void> {
  try {
    // Only save if watched > 5% and < 95% (not at start or fully done)
    const pct = item.duration > 0 ? item.position / item.duration : 0;
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    const map: Record<string, WatchProgress> = raw ? JSON.parse(raw) : {};
    if (pct >= 0.95 && item.duration > 0) {
      // Nearly complete — mark as completed, remove progress
      delete map[item.id];
      await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
      await markEpisodeCompleted(item.id, item.seriesId);
    } else if (pct >= 0.03 || item.position > 30) {
      map[item.id] = { ...item, updatedAt: Date.now() };
      await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
    }
  } catch {}
}

export async function getProgress(id: string): Promise<WatchProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    const map: Record<string, WatchProgress> = raw ? JSON.parse(raw) : {};
    return map[id] ?? null;
  } catch {
    return null;
  }
}

export async function getProgressForSeries(seriesId: string): Promise<Record<string, WatchProgress>> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    const map: Record<string, WatchProgress> = raw ? JSON.parse(raw) : {};
    const result: Record<string, WatchProgress> = {};
    for (const [id, p] of Object.entries(map)) {
      if (p.seriesId === seriesId) result[id] = p;
    }
    return result;
  } catch {
    return {};
  }
}

export async function clearProgress(id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    const map: Record<string, WatchProgress> = raw ? JSON.parse(raw) : {};
    delete map[id];
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {}
}

// ──────────────── COMPLETED EPISODES ────────────────
// Tracks which episodes are 95%+ watched per series

interface CompletedStore {
  episodes: Set<string>; // episode IDs
}

export async function markEpisodeCompleted(episodeId: string, seriesId?: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(COMPLETED_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(episodeId)) {
      list.push(episodeId);
      await AsyncStorage.setItem(COMPLETED_KEY, JSON.stringify(list));
    }
  } catch {}
}

export async function getCompletedEpisodes(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(COMPLETED_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

export async function isEpisodeCompleted(episodeId: string): Promise<boolean> {
  const set = await getCompletedEpisodes();
  return set.has(episodeId);
}
