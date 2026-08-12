import { useState, useEffect } from 'react';
import {
  getSeriesCategories,
  getSeriesList,
  getSeriesInfo,
  getSeriesEpisodeUrl,
  SeriesCategory,
  Series,
  SeriesInfo,
} from '@/services/xtreamApi';
import { useAuth } from '@/hooks/useAuth';

export function useSeries() {
  const { auth } = useAuth();
  const [categories, setCategories] = useState<SeriesCategory[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [filteredSeries, setFilteredSeries] = useState<Series[]>([]);
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
      const [cats, series] = await Promise.all([
        getSeriesCategories(auth),
        getSeriesList(auth),
      ]);
      setCategories(cats);
      setSeriesList(series);
      setFilteredSeries(series);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let result = seriesList;
    if (selectedCategory !== 'all') {
      result = result.filter(s => s.category_id === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s => s.name.toLowerCase().includes(q));
    }
    setFilteredSeries(result);
  }, [selectedCategory, searchQuery, seriesList]);

  async function fetchSeriesInfo(seriesId: number): Promise<SeriesInfo | null> {
    if (!auth) return null;
    return getSeriesInfo(auth, seriesId);
  }

  function getEpisodeUrl(episodeId: string, ext: string = 'mp4', directSource?: string): string {
    if (!auth) return '';
    return getSeriesEpisodeUrl(auth, episodeId, ext || 'mp4', directSource);
  }

  return {
    categories,
    seriesList: filteredSeries,
    selectedCategory,
    loading,
    searchQuery,
    setSearchQuery,
    selectCategory: setSelectedCategory,
    fetchSeriesInfo,
    getEpisodeUrl,
    refresh: loadData,
  };
}
