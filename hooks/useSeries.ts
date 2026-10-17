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
import { DEMO_SERIES, DEMO_SERIES_CATEGORIES, DEMO_SERIES_INFO, getDemoEpisodeUrl } from '@/services/demoCatalog';

interface SeriesCatalogCache {
  accountKey: string;
  categories: SeriesCategory[];
  series: Series[];
}

let seriesCatalogCache: SeriesCatalogCache | null = null;

function getAccountKey(auth: NonNullable<ReturnType<typeof useAuth>['auth']>): string {
  return `${auth.server}|${auth.username}|${auth.password}`;
}

/** Set `loadCatalog` to false when only episode helpers are needed. */
export function useSeries(loadCatalog = true) {
  const { auth, isDemoMode } = useAuth();
  const [categories, setCategories] = useState<SeriesCategory[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [filteredSeries, setFilteredSeries] = useState<Series[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isDemoMode && loadCatalog) {
      setCategories(DEMO_SERIES_CATEGORIES);
      setSeriesList(DEMO_SERIES);
      setFilteredSeries(DEMO_SERIES);
      setLoading(false);
      return;
    }
    if (auth && loadCatalog) loadData();
    else if (loadCatalog) setLoading(false);
  }, [auth, isDemoMode, loadCatalog]);

  async function loadData(forceRefresh = false) {
    if (!auth) return;
    const accountKey = getAccountKey(auth);

    if (!forceRefresh && seriesCatalogCache?.accountKey === accountKey) {
      setCategories(seriesCatalogCache.categories);
      setSeriesList(seriesCatalogCache.series);
      setFilteredSeries(seriesCatalogCache.series);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [cats, series] = await Promise.all([
        getSeriesCategories(auth),
        getSeriesList(auth),
      ]);
      seriesCatalogCache = { accountKey, categories: cats, series };
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
    if (isDemoMode && seriesId === 920001) return DEMO_SERIES_INFO;
    if (!auth) return null;
    return getSeriesInfo(auth, seriesId);
  }

  function getEpisodeUrl(episodeId: string, ext: string = 'mp4', directSource?: string): string {
    if (isDemoMode) return getDemoEpisodeUrl(episodeId) || directSource || '';
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
    refresh: () => loadData(true),
  };
}
