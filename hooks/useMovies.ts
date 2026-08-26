import { useState, useEffect } from 'react';
import {
  getVodCategories,
  getVodStreams,
  getVodStreamUrl,
  VodCategory,
  VodStream,
} from '@/services/xtreamApi';
import { useAuth } from '@/hooks/useAuth';

interface MoviesCatalogCache {
  accountKey: string;
  categories: VodCategory[];
  movies: VodStream[];
}

// The tab layout unmounts inactive screens. Keeping this small in-memory
// cache prevents a full IPTV catalog download every time the user returns
// from the player or switches tabs. It is cleared naturally when the app
// process closes and is bypassed by an explicit refresh.
let moviesCatalogCache: MoviesCatalogCache | null = null;

function getAccountKey(auth: NonNullable<ReturnType<typeof useAuth>['auth']>): string {
  return `${auth.server}|${auth.username}|${auth.password}`;
}

export function useMovies() {
  const { auth } = useAuth();
  const [categories, setCategories] = useState<VodCategory[]>([]);
  const [movies, setMovies] = useState<VodStream[]>([]);
  const [filteredMovies, setFilteredMovies] = useState<VodStream[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (auth) loadData();
  }, [auth]);

  async function loadData(forceRefresh = false) {
    if (!auth) return;
    const accountKey = getAccountKey(auth);

    if (!forceRefresh && moviesCatalogCache?.accountKey === accountKey) {
      setCategories(moviesCatalogCache.categories);
      setMovies(moviesCatalogCache.movies);
      setFilteredMovies(moviesCatalogCache.movies);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [cats, vods] = await Promise.all([
        getVodCategories(auth),
        getVodStreams(auth),
      ]);
      moviesCatalogCache = { accountKey, categories: cats, movies: vods };
      setCategories(cats);
      setMovies(vods);
      setFilteredMovies(vods);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let result = movies;
    if (selectedCategory !== 'all') {
      result = result.filter(m => m.category_id === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m => m.name.toLowerCase().includes(q));
    }
    setFilteredMovies(result);
  }, [selectedCategory, searchQuery, movies]);

  /**
   * Returns the best URL for the movie.
   * Uses direct_source if available (some servers provide CDN links),
   * otherwise builds standard Xtream URL with correct extension.
   */
  function getMovieUrl(streamId: number, ext: string = 'mp4', directSource?: string): string {
    if (!auth) return '';
    return getVodStreamUrl(auth, streamId, ext || 'mp4', directSource);
  }

  return {
    categories,
    movies: filteredMovies,
    selectedCategory,
    loading,
    searchQuery,
    setSearchQuery,
    selectCategory: setSelectedCategory,
    getMovieUrl,
    refresh: () => loadData(true),
  };
}
