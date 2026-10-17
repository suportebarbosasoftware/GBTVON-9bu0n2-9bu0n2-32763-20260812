import {
  LiveCategory,
  LiveStream,
  Series,
  SeriesCategory,
  SeriesInfo,
  VodCategory,
  VodStream,
} from './xtreamApi';

/**
 * Conteúdo de demonstração usado exclusivamente na revisão das lojas de TV.
 * O arquivo é empacotado junto com o aplicativo: não depende de playlist,
 * servidor de streaming ou conta de qualquer cliente real.
 */
export const DEMO_REPRESENTATIVE_CODE = '9999';

// O vídeo de abertura já é reproduzido no webOS e é incluído no IPK. Usá-lo
// aqui evita falhas em TVs que não alcançam ou não suportam vídeos externos.
const APP_DEMO_VIDEO = require('@/assets/images/intro.mp4') as string;

export const DEMO_LIVE_CATEGORIES: LiveCategory[] = [
  { category_id: 'demo-live', category_name: 'Demonstração', parent_id: 0 },
];

export const DEMO_LIVE_STREAMS: LiveStream[] = [
  {
    num: 1,
    name: 'Canal de Demonstração',
    stream_type: 'movie',
    stream_id: 900001,
    stream_icon: '',
    epg_channel_id: '',
    added: '0',
    category_id: 'demo-live',
    custom_sid: '',
    tv_archive: 0,
    direct_source: APP_DEMO_VIDEO,
    tv_archive_duration: 0,
  },
];

export const DEMO_MOVIE_CATEGORIES: VodCategory[] = [
  { category_id: 'demo', category_name: 'Vídeos de demonstração', parent_id: 0 },
];

const DEMO_MOVIES: VodStream[] = [
  { num: 1, name: 'Vídeo de demonstração', stream_type: 'movie', stream_id: 910001, stream_icon: '', rating: 'L', rating_5based: 0, added: '0', category_id: 'demo', container_extension: 'mp4', custom_sid: '', direct_source: APP_DEMO_VIDEO },
  { num: 2, name: 'Navegação de demonstração', stream_type: 'movie', stream_id: 910002, stream_icon: '', rating: 'L', rating_5based: 0, added: '0', category_id: 'demo', container_extension: 'mp4', custom_sid: '', direct_source: APP_DEMO_VIDEO },
  { num: 3, name: 'Reprodução de demonstração', stream_type: 'movie', stream_id: 910003, stream_icon: '', rating: 'L', rating_5based: 0, added: '0', category_id: 'demo', container_extension: 'mp4', custom_sid: '', direct_source: APP_DEMO_VIDEO },
];

export const DEMO_SERIES_CATEGORIES: SeriesCategory[] = [
  { category_id: 'demo-series', category_name: 'Demonstração', parent_id: 0 },
];

export const DEMO_SERIES: Series[] = [
  {
    num: 1, name: 'Série de Demonstração', series_id: 920001, cover: '',
    plot: 'Episódios públicos para verificar a navegação e a reprodução.',
    cast: '', director: '', genre: 'Demonstração', releaseDate: '2026',
    last_modified: '0', rating: 'L', rating_5based: 0, backdrop_path: [],
    youtube_trailer: '', episode_run_time: '', category_id: 'demo-series',
  },
];

export const DEMO_SERIES_INFO: SeriesInfo = {
  info: {
    name: 'Série de Demonstração', cover: '',
    plot: 'Episódios públicos para verificar a navegação e a reprodução.',
    cast: '', director: '', genre: 'Demonstração', rating: 'L', releaseDate: '2026',
  },
  episodes: {
    '1': [
      { id: '920101', episode_num: 1, title: 'Vídeo de teste 1', container_extension: 'mp4', info: { movie_image: '', plot: 'Vídeo incluído no aplicativo para a demonstração.', duration_secs: 0, duration: '', rating: 'L', releasedate: '2026' }, added: '0', season: 1, direct_source: APP_DEMO_VIDEO },
      { id: '920102', episode_num: 2, title: 'Vídeo de teste 2', container_extension: 'mp4', info: { movie_image: '', plot: 'Vídeo incluído no aplicativo para a demonstração.', duration_secs: 0, duration: '', rating: 'L', releasedate: '2026' }, added: '0', season: 1, direct_source: APP_DEMO_VIDEO },
    ],
  },
};

export function getDemoMovies(): VodStream[] { return DEMO_MOVIES; }
export function getDemoMovieUrl(streamId: number): string { return DEMO_MOVIES.find(movie => movie.stream_id === streamId)?.direct_source || ''; }
export function getDemoLiveUrl(streamId: number): string { return DEMO_LIVE_STREAMS.find(stream => stream.stream_id === streamId)?.direct_source || ''; }
export function getDemoEpisodeUrl(episodeId: string): string {
  for (const episodes of Object.values(DEMO_SERIES_INFO.episodes)) {
    const episode = episodes.find(item => item.id === episodeId);
    if (episode) return episode.direct_source;
  }
  return '';
}
