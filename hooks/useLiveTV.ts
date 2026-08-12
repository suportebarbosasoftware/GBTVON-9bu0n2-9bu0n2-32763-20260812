import { useState, useEffect } from 'react';
import { getLiveCategories, getLiveStreams, getLiveStreamUrl, LiveCategory, LiveStream } from '@/services/xtreamApi';
import { groupChannels, GroupedChannel } from '@/services/channelGrouper';
import { useAuth } from '@/hooks/useAuth';
import {
  loadFilterState,
  FilterState,
  hideChannel,
  hideCategory,
  showChannel,
  showCategory,
  isAdultCategory,
} from '@/services/channelFilterService';
import {
  getSelectedChannelKeys,
  makeChannelKey,
  isSetupDone,
} from '@/services/channelSetupService';
import {
  buildChannelNumbers,
  loadChannelNumbers,
  applyChannelNumbers,
  NumberedChannel,
} from '@/services/channelNumberService';

export function useLiveTV() {
  const { auth } = useAuth();
  const [categories, setCategories] = useState<LiveCategory[]>([]);
  const [allStreams, setAllStreams] = useState<LiveStream[]>([]);
  const [groupedChannels, setGroupedChannels] = useState<NumberedChannel[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<FilterState>({
    hiddenChannels: [],
    hiddenCategories: [],
    adultBlocked: true,
  });
  const [selectedChannelKeys, setSelectedChannelKeys] = useState<Set<string>>(new Set());
  const [setupDone, setSetupDone] = useState(false);
  const [channelNumberMap, setChannelNumberMap] = useState<Map<string, number>>(new Map());
  const [allGrouped, setAllGrouped] = useState<GroupedChannel[]>([]);

  useEffect(() => {
    if (auth) loadData();
  }, [auth]);

  async function loadData() {
    if (!auth) return;
    setLoading(true);
    try {
      // ── Parallel fetch: API calls + local prefs at the same time ─────────
      const [
        [cats, strs],
        [filters, setupCompleted, channelKeys, existingNumbers],
      ] = await Promise.all([
        // Network calls in parallel
        Promise.all([
          getLiveCategories(auth),
          getLiveStreams(auth),
        ]),
        // Local AsyncStorage reads in parallel
        Promise.all([
          loadFilterState(),
          isSetupDone(),
          getSelectedChannelKeys(),
          loadChannelNumbers(),
        ]),
      ]);

      setFilterState(filters);
      setSetupDone(setupCompleted);
      setSelectedChannelKeys(channelKeys);

      // Filter categories
      const visibleCats = cats.filter(c => {
        if (filters.hiddenCategories.includes(c.category_id)) return false;
        // Adult content visible by default — client can hide manually
        return true;
      });
      setCategories(visibleCats);
      setAllStreams(strs);

      // Group and filter channels
      const grouped = groupChannels(strs);

      let visible = grouped.filter(g => {
        const key = makeChannelKey(g.baseName, g.categoryId);
        if (filters.hiddenChannels.includes(key)) return false;
        // Adult channels visible by default — client can hide manually
        return true;
      });

      let masterList = visible;
      if (setupCompleted && channelKeys.size > 0) {
        masterList = visible.filter(g => channelKeys.has(makeChannelKey(g.baseName, g.categoryId)));
      }

      // Build or reuse channel numbers
      let numberMap = existingNumbers;
      if (existingNumbers.size === 0 || existingNumbers.size !== masterList.length) {
        numberMap = await buildChannelNumbers(masterList);
      }
      setChannelNumberMap(numberMap);
      setAllGrouped(masterList);

      applyFilters(strs, selectedCategory, searchQuery, filters, channelKeys, setupCompleted, numberMap, masterList);
    } catch {
      // ignore errors
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(
    streams: LiveStream[],
    catId: string,
    query: string,
    filters: FilterState,
    channelKeys: Set<string>,
    setupComplete: boolean,
    numberMap: Map<string, number>,
    master: GroupedChannel[]
  ) {
    let result = master;

    if (catId !== 'all') {
      result = result.filter(g => g.categoryId === catId);
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(g => g.baseName.toLowerCase().includes(q));
    }

    const numbered = applyChannelNumbers(result, numberMap);
    numbered.sort((a, b) => a.channelNumber - b.channelNumber);
    setGroupedChannels(numbered);
  }

  // Re-apply filters when selectedCategory or searchQuery changes
  useEffect(() => {
    applyFilters(allStreams, selectedCategory, searchQuery, filterState, selectedChannelKeys, setupDone, channelNumberMap, allGrouped);
  }, [selectedCategory, searchQuery, allStreams, filterState, selectedChannelKeys, setupDone, channelNumberMap, allGrouped]);

  function selectCategory(id: string) {
    setSelectedCategory(id);
  }

  function getStreamUrl(streamId: number): string {
    if (!auth) return '';
    return getLiveStreamUrl(auth, streamId);
  }

  function getAllNumberedChannels(): NumberedChannel[] {
    return applyChannelNumbers(allGrouped, channelNumberMap).sort((a, b) => a.channelNumber - b.channelNumber);
  }

  async function hideChannelByKey(baseName: string, categoryId: string) {
    const key = makeChannelKey(baseName, categoryId);
    await hideChannel(key);
    const newFilters = { ...filterState, hiddenChannels: [...filterState.hiddenChannels, key] };
    setFilterState(newFilters);
    const newMaster = allGrouped.filter(g => makeChannelKey(g.baseName, g.categoryId) !== key);
    setAllGrouped(newMaster);
    applyFilters(allStreams, selectedCategory, searchQuery, newFilters, selectedChannelKeys, setupDone, channelNumberMap, newMaster);
  }

  async function showChannelByKey(baseName: string, categoryId: string) {
    const key = makeChannelKey(baseName, categoryId);
    await showChannel(key);
    const newFilters = { ...filterState, hiddenChannels: filterState.hiddenChannels.filter(k => k !== key) };
    setFilterState(newFilters);
    await loadData();
  }

  async function hideCategoryById(categoryId: string) {
    await hideCategory(categoryId);
    const newFilters = { ...filterState, hiddenCategories: [...filterState.hiddenCategories, categoryId] };
    setFilterState(newFilters);
    setCategories(prev => prev.filter(c => c.category_id !== categoryId));
    const newMaster = allGrouped.filter(g => g.categoryId !== categoryId);
    setAllGrouped(newMaster);
    applyFilters(
      allStreams,
      selectedCategory === categoryId ? 'all' : selectedCategory,
      searchQuery,
      newFilters,
      selectedChannelKeys,
      setupDone,
      channelNumberMap,
      newMaster
    );
    if (selectedCategory === categoryId) setSelectedCategory('all');
  }

  async function showCategoryById(categoryId: string) {
    await showCategory(categoryId);
    const newFilters = { ...filterState, hiddenCategories: filterState.hiddenCategories.filter(k => k !== categoryId) };
    setFilterState(newFilters);
    await loadData();
  }

  return {
    categories,
    groupedChannels,
    selectedCategory,
    loading,
    searchQuery,
    setSearchQuery,
    selectCategory,
    getStreamUrl,
    refresh: loadData,
    hideChannelByKey,
    showChannelByKey,
    hideCategoryById,
    filterState,
    getAllNumberedChannels,
  };
}
