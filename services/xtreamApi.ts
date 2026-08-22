// Xtream Codes API Service for GBTVON
// Server: https://odira.sbs

const SERVER_URL = 'https://odira.sbs';

export interface XtreamAuth {
  username: string;
  password: string;
  server: string;
}

export interface UserInfo {
  username: string;
  password: string;
  message: string;
  auth: number;
  status: string;
  exp_date: string;
  is_trial: string;
  active_cons: string;
  max_connections: string;
}

export interface LiveCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface LiveStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}

const LIVE_STREAM_CACHE_TTL_MS = 5 * 60 * 1000;
const liveStreamCache = new Map<string, { expiresAt: number; streams: LiveStream[] }>();
const liveStreamRequests = new Map<string, Promise<LiveStream[]>>();

export interface VodCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface VodStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  rating: string;
  rating_5based: number;
  added: string;
  category_id: string;
  container_extension: string;
  custom_sid: string;
  direct_source: string;
}

export interface SeriesCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface Series {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  last_modified: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  category_id: string;
}

export interface SeriesInfo {
  info: {
    name: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    rating: string;
    releaseDate: string;
  };
  episodes: Record<string, Episode[]>;
}

export interface Episode {
  id: string;
  episode_num: number;
  title: string;
  container_extension: string;
  info: {
    movie_image: string;
    plot: string;
    duration_secs: number;
    duration: string;
    rating: string;
    releasedate: string;
  };
  added: string;
  season: number;
  direct_source: string;
}

async function apiCall(auth: XtreamAuth, params: Record<string, string>): Promise<any> {
  const queryParams = new URLSearchParams({
    username: auth.username,
    password: auth.password,
    ...params,
  });

  const url = `${auth.server}/player_api.php?${queryParams.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GBTVON/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  return response.json();
}

export async function authenticate(
  username: string,
  password: string
): Promise<{ success: boolean; userInfo?: UserInfo; error?: string }> {
  try {
    const auth: XtreamAuth = { username, password, server: SERVER_URL };
    const data = await apiCall(auth, {});

    if (data && data.user_info && data.user_info.auth === 1) {
      return { success: true, userInfo: data.user_info };
    } else if (data && data.user_info && data.user_info.auth === 0) {
      return { success: false, error: 'Usuário ou senha incorretos.' };
    } else {
      return { success: false, error: 'Falha na autenticação. Verifique suas credenciais.' };
    }
  } catch (error: any) {
    return { success: false, error: `Erro de conexão: ${error.message}` };
  }
}

export async function getLiveCategories(auth: XtreamAuth): Promise<LiveCategory[]> {
  try {
    const data = await apiCall(auth, { action: 'get_live_categories' });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getLiveStreams(
  auth: XtreamAuth,
  categoryId?: string,
  forceRefresh = false
): Promise<LiveStream[]> {
  const cacheKey = `${auth.server}|${auth.username}|${auth.password}|${categoryId ?? 'all'}`;
  const now = Date.now();
  const cached = liveStreamCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.streams;
  }

  const pendingRequest = liveStreamRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const params: Record<string, string> = { action: 'get_live_streams' };
  if (categoryId) params.category_id = categoryId;

  const request = apiCall(auth, params)
    .then(data => {
      const streams = Array.isArray(data) ? data : [];
      liveStreamCache.set(cacheKey, {
        streams,
        expiresAt: Date.now() + LIVE_STREAM_CACHE_TTL_MS,
      });
      return streams;
    })
    .catch(() => [])
    .finally(() => {
      liveStreamRequests.delete(cacheKey);
    });

  liveStreamRequests.set(cacheKey, request);
  return request;
}

export async function getVodCategories(auth: XtreamAuth): Promise<VodCategory[]> {
  try {
    const data = await apiCall(auth, { action: 'get_vod_categories' });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getVodStreams(auth: XtreamAuth, categoryId?: string): Promise<VodStream[]> {
  try {
    const params: Record<string, string> = { action: 'get_vod_streams' };
    if (categoryId) params.category_id = categoryId;
    const data = await apiCall(auth, params);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getSeriesCategories(auth: XtreamAuth): Promise<SeriesCategory[]> {
  try {
    const data = await apiCall(auth, { action: 'get_series_categories' });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getSeriesList(auth: XtreamAuth, categoryId?: string): Promise<Series[]> {
  try {
    const params: Record<string, string> = { action: 'get_series' };
    if (categoryId) params.category_id = categoryId;
    const data = await apiCall(auth, params);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getSeriesInfo(auth: XtreamAuth, seriesId: number): Promise<SeriesInfo | null> {
  try {
    const data = await apiCall(auth, { action: 'get_series_info', series_id: String(seriesId) });
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Live stream URL — uses .m3u8 (HLS) as primary format.
 * Xtream Codes servers expose HLS at /live/user/pass/id.m3u8
 */
export function getLiveStreamUrl(auth: XtreamAuth, streamId: number): string {
  return `${auth.server}/live/${auth.username}/${auth.password}/${streamId}.m3u8`;
}

/**
 * Live stream URL — .ts fallback if HLS fails
 */
export function getLiveStreamUrlTs(auth: XtreamAuth, streamId: number): string {
  return `${auth.server}/live/${auth.username}/${auth.password}/${streamId}.ts`;
}

/**
 * VOD (movie) stream URL.
 * Prefers direct_source when provided by the server, otherwise builds standard URL.
 */
export function getVodStreamUrl(auth: XtreamAuth, streamId: number, ext: string = 'mp4', directSource?: string): string {
  if (directSource && directSource.startsWith('http')) {
    return directSource;
  }
  const cleanExt = (ext && ext.trim()) ? ext.trim() : 'mp4';
  return `${auth.server}/movie/${auth.username}/${auth.password}/${streamId}.${cleanExt}`;
}

/**
 * Series episode URL.
 */
export function getSeriesEpisodeUrl(auth: XtreamAuth, episodeId: string, ext: string = 'mp4', directSource?: string): string {
  if (directSource && directSource.startsWith('http')) {
    return directSource;
  }
  const cleanExt = (ext && ext.trim()) ? ext.trim() : 'mp4';
  return `${auth.server}/series/${auth.username}/${auth.password}/${episodeId}.${cleanExt}`;
}

// ─── EPG ─────────────────────────────────────────────────────────────────────

export interface EpgProgram {
  id: string;
  epg_id: string;
  title: string;
  lang: string;
  start: string;      // Unix timestamp string
  end: string;        // Unix timestamp string
  description: string;
  channel_id: string;
  start_timestamp: number;
  stop_timestamp: number;
}

export interface EpgData {
  epg_listings: EpgProgram[];
}

/**
 * Fetch short EPG for a single stream (current + next programs).
 * limit=3 returns current + 2 upcoming entries.
 */
export async function getShortEpg(
  auth: XtreamAuth,
  streamId: number,
  limit = 3
): Promise<EpgProgram[]> {
  try {
    const data = await apiCall(auth, {
      action: 'get_short_epg',
      stream_id: String(streamId),
      limit: String(limit),
    });
    return data?.epg_listings ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch full EPG listings for a specific date (YYYY-MM-DD).
 * Returns listings for the given stream.
 */
export async function getFullEpg(
  auth: XtreamAuth,
  streamId: number
): Promise<EpgProgram[]> {
  try {
    const data = await apiCall(auth, {
      action: 'get_simple_data_table',
      stream_id: String(streamId),
    });
    return data?.epg_listings ?? [];
  } catch {
    return [];
  }
}

/**
 * Parse EPG timestamp to human-readable HH:MM
 */
export function epgTimeLabel(timestamp: number | string): string {
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) * 1000 : timestamp * 1000;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export { SERVER_URL };
