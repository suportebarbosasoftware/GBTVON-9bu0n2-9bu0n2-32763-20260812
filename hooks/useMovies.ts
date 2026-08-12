import { useState, useEffect } from 'react';
import {
  getVodCategories,
  getVodStreams,
  getVodStreamUrl,
  VodCategory,
  VodStream,
} from '@/services/xtreamApi';
import { useAuth } from '@/hooks/useAuth';

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

  async function loadData() {
    if (!auth) return;
    setLoading(true);
    try {
      const [cats, vods] = await Promise.all([
        getVodCategories(auth),
        getVodStreams(auth),
      ]);
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
    refresh: loadData,
  };
}
