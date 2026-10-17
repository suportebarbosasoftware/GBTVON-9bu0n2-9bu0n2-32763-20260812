/**
 * Series Screen — Netflix-style layout
 * Single top-level FlatList with ListHeaderComponent to avoid nested VirtualizedList bugs.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSeries } from '@/hooks/useSeries';
import { Colors, Spacing, BorderRadius } from '@/constants/theme';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { addFavorite, getFavorites, getHistory, HistoryItem, FavoriteItem, removeFavorite } from '@/services/favoritesService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import TVCatalogSearch from '@/components/ui/TVCatalogSearch';
import AdultPinModal from '@/components/ui/AdultPinModal';
import { isAdultCategory } from '@/services/channelFilterService';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = IS_TV ? 160 : 110;
const CARD_H = Math.round(CARD_W * 1.45);
const HERO_H = IS_TV ? 220 : 180;
const NUM_COLS = Math.max(2, Math.floor(SCREEN_W / (CARD_W + 16)));

type ActiveTab = 'browse' | 'favorites' | 'history';

export default function SeriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { categories, seriesList, selectedCategory, loading, searchQuery, setSearchQuery, selectCategory } = useSeries();

  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('browse');
  const [heroIndex, setHeroIndex] = useState(0);
  const [adultPinVisible, setAdultPinVisible] = useState(false);
  const [pendingAdultCategory, setPendingAdultCategory] = useState<string | null>(null);
  const [unlockedAdultCategories, setUnlockedAdultCategories] = useState<Set<string>>(new Set());
  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref for TV D-Pad focus-based scrolling
  const mainListRef = useRef<FlatList>(null);

  useEffect(() => { loadFavoritesAndHistory(); }, []);

  useEffect(() => {
    if (seriesList.length === 0) return;
    heroTimer.current = setInterval(() => {
      setHeroIndex(i => (i + 1) % Math.min(8, seriesList.length));
    }, 5500);
    return () => { if (heroTimer.current) clearInterval(heroTimer.current); };
  }, [seriesList.length]);

  const adultCategoryIds = useMemo(() => new Set(categories.filter(category => isAdultCategory(category.category_name)).map(category => category.category_id)), [categories]);
  const visibleSeries = useMemo(() => seriesList.filter(series => !adultCategoryIds.has(series.category_id) || unlockedAdultCategories.has(series.category_id)), [adultCategoryIds, seriesList, unlockedAdultCategories]);
  const selectProtectedCategory = useCallback((categoryId: string) => {
    if (adultCategoryIds.has(categoryId) && !unlockedAdultCategories.has(categoryId)) {
      setPendingAdultCategory(categoryId); setAdultPinVisible(true); return;
    }
    selectCategory(categoryId);
  }, [adultCategoryIds, selectCategory, unlockedAdultCategories]);

  async function loadFavoritesAndHistory() {
    const [favs, hist] = await Promise.all([getFavorites(), getHistory()]);
    const seriesFavorites = favs.filter(item => item.type === 'series');
    setFavorites(new Set(seriesFavorites.map(item => item.id)));
    setFavoriteItems(seriesFavorites);
    const seriesHistory = hist.filter(h => h.type === 'episode' || h.type === 'series');
    setWatched(new Set(seriesHistory.map(h => h.seriesId || h.id)));

    // O histórico de séries mostra uma entrada por série, não o último
    // episódio isolado. Assim o usuário volta à página da série e continua de
    // onde parou sem perder o contexto.
    const grouped = new Map<string, HistoryItem>();
    for (const entry of seriesHistory) {
      const seriesId = entry.seriesId || entry.id;
      const existing = grouped.get(seriesId);
      if (!existing || entry.watchedAt > existing.watchedAt) {
        grouped.set(seriesId, {
          ...entry,
          id: seriesId,
          type: 'series',
          name: entry.seriesName || entry.name,
          seriesId,
          seriesName: entry.seriesName || entry.name,
          poster: entry.poster || existing?.poster || '',
        });
      }
    }
    setHistoryItems(Array.from(grouped.values()).sort((a, b) => b.watchedAt - a.watchedAt));
  }

  async function toggleFavorite(seriesId: number, name: string, cover: string) {
    const id = String(seriesId);
    if (favorites.has(id)) {
      await removeFavorite(id, 'series');
      setFavorites(previous => { const next = new Set(previous); next.delete(id); return next; });
    } else {
      await addFavorite({ id, type: 'series', name, poster: cover });
      setFavorites(previous => new Set(previous).add(id));
    }
    void loadFavoritesAndHistory();
  }

  function handleSeriesPress(seriesId: number, name: string, cover: string) {
    router.push({
      pathname: '/series-detail',
      params: { seriesId: String(seriesId), name, cover },
    });
  }

  // Group by category for Netflix rows
  const categoryRows = useMemo(() => {
    if (selectedCategory !== 'all' || searchQuery.trim()) return null;
    const rows: { id: string; name: string; items: typeof seriesList }[] = [];
    for (const cat of categories.filter(category => !adultCategoryIds.has(category.category_id) || unlockedAdultCategories.has(category.category_id)).slice(0, 12)) {
      const items = visibleSeries.filter(s => s.category_id === cat.category_id).slice(0, 20);
      if (items.length > 0) rows.push({ id: cat.category_id, name: cat.category_name, items });
    }
    return rows;
  }, [visibleSeries, categories, selectedCategory, searchQuery, adultCategoryIds, unlockedAdultCategories]);

  const heroSeries = visibleSeries[heroIndex % Math.max(1, visibleSeries.length)];

  // ── Card renderer ──────────────────────────────────────────────────────────
  const renderCard = useCallback((item: typeof seriesList[0], listIndex?: number) => {
    const isWatched = watched.has(String(item.series_id));
    const isFavorite = favorites.has(String(item.series_id));
    return (
      <TVFocusable
        key={`card-${item.series_id}`}
        style={styles.card}
        focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.82)', borderColor: '#FF0000', borderWidth: 5, borderRadius: 8, shadowColor: '#FF0000', shadowOpacity: 1, shadowRadius: 24, elevation: 40 }}
        focusScale={1.06}
        overlayBorderRadius={8}
        onFocus={() => {
          if (IS_TV && listIndex !== undefined) {
            try {
              mainListRef.current?.scrollToIndex({ index: listIndex, animated: false, viewPosition: 0.4 });
            } catch {}
          }
        }}
        hasTVPreferredFocus={IS_TV && listIndex === 0}
        onPress={() => handleSeriesPress(item.series_id, item.name, item.cover)}
        onLongPress={() => void toggleFavorite(item.series_id, item.name, item.cover)}
        delayLongPress={550}
      >
        <View style={styles.posterWrap}>
          <View style={styles.posterClip}>
            {item.cover ? (
              <Image source={{ uri: item.cover }} style={styles.poster} contentFit="cover" transition={200} />
            ) : (
              <View style={styles.posterPlaceholder}>
                <MaterialIcons name="video-library" size={24} color={Colors.textMuted} />
              </View>
            )}
            <View style={styles.playOverlay}>
              <Ionicons name="chevron-forward-circle" size={28} color="rgba(255,255,255,0.85)" />
            </View>
          </View>
          {isWatched && (
            <View style={styles.watchedBadge}>
              <Ionicons name="checkmark-circle" size={12} color="#4CAF50" />
            </View>
          )}
          {item.rating_5based > 0 && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>{item.rating_5based.toFixed(1)}</Text>
            </View>
          )}
          <View pointerEvents="none" style={styles.favBtn}>
            <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={15} color={isFavorite ? '#E50000' : '#fff'} />
          </View>
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
      </TVFocusable>
    );
  }, [favorites, watched]);

  // ── Header component ───────────────────────────────────────────────────────
  const BrowseHeader = useMemo(() => (
    <View>
      {/* Hero */}
      {heroSeries && !searchQuery.trim() && selectedCategory === 'all' && (
        <Pressable
          style={styles.hero}
          onPress={() => handleSeriesPress(heroSeries.series_id, heroSeries.name, heroSeries.cover)}
        >
          {heroSeries.cover ? (
            <Image source={{ uri: heroSeries.cover }} style={styles.heroPoster} contentFit="cover" transition={400} />
          ) : (
            <View style={[styles.heroPoster, { backgroundColor: '#0d001a', alignItems: 'center', justifyContent: 'center' }]}>
              <MaterialIcons name="video-library" size={48} color={Colors.primary} />
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.96)']}
            style={styles.heroGradient}
          >
            <View style={styles.heroContent}>
              {heroSeries.rating_5based > 0 && (
                <View style={styles.heroRating}>
                  <Ionicons name="star" size={10} color="#FFD700" />
                  <Text style={styles.heroRatingText}>{heroSeries.rating_5based.toFixed(1)}</Text>
                </View>
              )}
              <Text style={styles.heroTitle} numberOfLines={2}>{heroSeries.name}</Text>
              <Pressable
                style={styles.heroPlayBtn}
                onPress={() => handleSeriesPress(heroSeries.series_id, heroSeries.name, heroSeries.cover)}
              >
                <Ionicons name="play" size={15} color="#000" />
                <Text style={styles.heroPlayText}>Ver Episódios</Text>
              </Pressable>
            </View>
            <View style={styles.heroDots}>
              {Array.from({ length: Math.min(8, visibleSeries.length) }).map((_, i) => (
                <View key={i} style={[styles.heroDot, i === heroIndex && styles.heroDotActive]} />
              ))}
            </View>
          </LinearGradient>
        </Pressable>
      )}

      {/* Search */}
      {IS_TV ? (
        <TVCatalogSearch
          label="Buscar série"
          value={searchQuery}
          onChangeText={setSearchQuery}
          hasTVPreferredFocus
        />
      ) : (
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={14} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar série..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      {/* Category chips */}
      <View style={styles.categoryBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryContent}>
          <Pressable
            testID="catalog-category-all"
            style={[styles.chip, selectedCategory === 'all' && styles.chipActive]}
            onPress={() => selectCategory('all')}
          >
            <Text style={[styles.chipText, selectedCategory === 'all' && styles.chipTextActive]}>Todas</Text>
          </Pressable>
          {categories.map(cat => (
            <Pressable
              key={cat.category_id}
              testID={`catalog-category-${cat.category_id}`}
              style={[styles.chip, selectedCategory === cat.category_id && styles.chipActive]}
              onPress={() => selectProtectedCategory(cat.category_id)}
            >
              <Text style={[styles.chipText, selectedCategory === cat.category_id && styles.chipTextActive]}>
                {cat.category_name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Netflix rows */}
      {categoryRows && !searchQuery.trim() ? (
        <View>
          {categoryRows.map(row => (
            <View key={row.id} style={styles.categoryRow}>
              <View style={styles.categoryRowHeader}>
                <Text style={styles.categoryRowTitle}>{row.name}</Text>
                <Pressable onPress={() => selectCategory(row.id)}>
                  <Text style={styles.seeAll}>Ver tudo</Text>
                </Pressable>
              </View>
              <FlatList
                data={row.items}
                keyExtractor={item => `h-${item.series_id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
                renderItem={({ item }) => renderCard(item)}
                initialNumToRender={8}
                maxToRenderPerBatch={8}
                windowSize={3}
                // TV: disable smooth scroll — D-Pad focus handlers use scrollToIndex
                scrollEnabled={!IS_TV}
                removeClippedSubviews={false}
              />
            </View>
          ))}
          <View style={{ height: 20 }} />
        </View>
      ) : null}

      {(!categoryRows || searchQuery.trim()) ? (
        <View style={{ height: 8 }} />
      ) : null}
    </View>
  ), [heroSeries, heroIndex, visibleSeries.length, searchQuery, selectedCategory, categories, categoryRows, favorites, watched, selectProtectedCategory]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Carregando séries...</Text>
      </View>
    );
  }

  // ── History tab ────────────────────────────────────────────────────────────
  if (activeTab === 'favorites') {
    return (
      <View style={styles.container}>
        <SeriesTabHeader activeTab={activeTab} count={seriesList.length} onChange={setActiveTab} onDataLoad={loadFavoritesAndHistory} />
        <FlatList
          data={favoriteItems}
          keyExtractor={item => `fav-${item.id}`}
          numColumns={NUM_COLS}
          key={`fav-series-${NUM_COLS}`}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={NUM_COLS > 1 ? { gap: 8, justifyContent: 'flex-start' } : undefined}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const series = seriesList.find(entry => String(entry.series_id) === item.id);
            return series ? renderCard(series) : (
              <View style={styles.card}>
                <View style={[styles.posterWrap, styles.posterPlaceholder]}>
                  {item.poster ? <Image source={{ uri: item.poster }} style={styles.poster} contentFit="cover" /> : <MaterialIcons name="video-library" size={24} color={Colors.textMuted} />}
                </View>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              </View>
            );
          }}
          ListEmptyComponent={<EmptyState label="Sem favoritos" icon="heart-outline" />}
        />
      </View>
    );
  }

  if (activeTab === 'history') {
    return (
      <View style={styles.container}>
        <SeriesTabHeader activeTab={activeTab} count={seriesList.length} onChange={setActiveTab} onDataLoad={loadFavoritesAndHistory} />
        <FlatList
          data={historyItems}
          keyExtractor={item => `hist-${item.id}-${item.watchedAt}`}
          contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TVFocusable
              style={styles.historyRow}
              focusedStyle={{ borderColor: '#FFDD00', borderWidth: 2 }}
              overlayBorderRadius={10}
              onPress={() => {
                if (item.seriesId) {
                  router.push({
                    pathname: '/series-detail',
                    params: { seriesId: item.seriesId, name: item.seriesName || item.name, cover: item.poster },
                  });
                }
              }}
            >
              <View style={styles.historyThumb}>
                {item.poster
                  ? <Image source={{ uri: item.poster }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  : <MaterialIcons name="video-library" size={20} color={Colors.textMuted} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.historyDate}>{new Date(item.watchedAt).toLocaleDateString('pt-BR')}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
            </TVFocusable>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="time-outline" size={52} color={Colors.textMuted} />
              <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '600', marginTop: 12 }}>
                Sem histórico
              </Text>
            </View>
          }
        />
      </View>
    );
  }

  // ── Browse tab ─────────────────────────────────────────────────────────────
  const showGrid = !categoryRows || !!searchQuery.trim();

  return (
    <>
    <View style={styles.container}>
      <SeriesTabHeader activeTab={activeTab} count={seriesList.length} onChange={setActiveTab} onDataLoad={loadFavoritesAndHistory} />
      {showGrid ? (
        <FlatList
          ref={mainListRef}
          data={visibleSeries}
          keyExtractor={item => `g-${item.series_id}`}
          numColumns={NUM_COLS}
          key={`grid-s-${NUM_COLS}`}
          ListHeaderComponent={BrowseHeader}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={NUM_COLS > 1 ? { gap: 8, justifyContent: 'flex-start' } : undefined}
          showsVerticalScrollIndicator={false}
          // TV D-Pad: keep items mounted + disable scroll so only programmatic
          // scrollToIndex triggers item-by-item jumps (no smooth mouse-like scroll)
          removeClippedSubviews={false}
          scrollEnabled={!IS_TV}
          windowSize={IS_TV ? 21 : 10}
          renderItem={({ item, index }) => renderCard(item, index)}
          ListEmptyComponent={<EmptyState />}
          initialNumToRender={IS_TV ? 30 : 20}
          maxToRenderPerBatch={IS_TV ? 30 : 20}
          onScrollToIndexFailed={() => {}}
        />
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => ''}
          ListHeaderComponent={BrowseHeader}
          renderItem={() => null}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
    <AdultPinModal visible={adultPinVisible} onCancel={() => { setAdultPinVisible(false); setPendingAdultCategory(null); }} onUnlock={() => {
      if (pendingAdultCategory) {
        setUnlockedAdultCategories(previous => new Set(previous).add(pendingAdultCategory));
        selectCategory(pendingAdultCategory);
      }
      setAdultPinVisible(false); setPendingAdultCategory(null);
    }} />
    </>
  );
}

// ── Tab Header ──────────────────────────────────────────────────────────────
function SeriesTabHeader({
  activeTab, count, onChange, onDataLoad,
}: {
  activeTab: ActiveTab;
  count: number;
  onChange: (tab: ActiveTab) => void;
  onDataLoad: () => void;
}) {
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Séries</Text>
        <Text style={styles.countBadge}>{count}</Text>
      </View>
      <View style={styles.tabRow}>
        {(['browse', 'favorites', 'history'] as ActiveTab[]).map(tab => (
          <TVFocusable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            focusedStyle={{ borderColor: '#E50000', borderWidth: 2, shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 8 }}
            onPress={() => { onChange(tab); if (tab !== 'browse') onDataLoad(); }}
          >
            <Ionicons
              name={tab === 'browse' ? 'grid-outline' : tab === 'favorites' ? 'heart' : 'time-outline'}
              size={13}
              color={activeTab === tab ? '#fff' : Colors.textMuted}
            />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'browse' ? 'Navegar' : tab === 'favorites' ? 'Favoritos' : 'Histórico'}
            </Text>
          </TVFocusable>
        ))}
      </View>
    </>
  );
}

function EmptyState({ label = 'Nenhuma série encontrada', icon = 'video-library' }: { label?: string; icon?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <MaterialIcons name={icon as any} size={52} color={Colors.textMuted} />
      <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '600', marginTop: 12 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8,
  },
  headerTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
  countBadge: {
    backgroundColor: Colors.primary, color: '#fff',
    fontSize: 10, fontWeight: '700',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
  },
  loadingText: { color: Colors.textSecondary, marginTop: 12, fontSize: 14 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'transparent', borderWidth: 0,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { color: Colors.textMuted, fontSize: 11, fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  // Hero
  hero: { width: '100%', height: HERO_H },
  heroPoster: { width: '100%', height: HERO_H, position: 'absolute' },
  heroGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: HERO_H,
    justifyContent: 'flex-end', paddingHorizontal: 14, paddingBottom: 10,
  },
  heroContent: {},
  heroRating: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  heroRatingText: { color: '#FFD700', fontSize: 10, fontWeight: '700' },
  heroTitle: {
    color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  heroPlayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7,
    alignSelf: 'flex-start', marginBottom: 6,
  },
  heroPlayText: { color: '#000', fontSize: 13, fontWeight: '700' },
  heroDots: { flexDirection: 'row', gap: 5, justifyContent: 'center' },
  heroDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  heroDotActive: { backgroundColor: Colors.primary, width: 14 },
  // Search
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'transparent', marginHorizontal: 14, marginTop: 8,
    borderRadius: 10, paddingHorizontal: 10, height: 36,
    borderWidth: 0, gap: 8,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 13 },
  categoryBar: { height: IS_TV ? 66 : 42, marginTop: 4 },
  categoryContent: { paddingHorizontal: IS_TV ? 18 : 14, alignItems: 'center', gap: IS_TV ? 12 : 6 },
  chip: {
    paddingHorizontal: IS_TV ? 20 : 12, paddingVertical: IS_TV ? 12 : 5, borderRadius: 999,
    backgroundColor: 'transparent', borderWidth: 0,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: IS_TV ? 17 : 11, fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  categoryRow: { marginTop: 14 },
  categoryRowHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, marginBottom: 8,
  },
  categoryRowTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  seeAll: { color: Colors.primary, fontSize: 11, fontWeight: '600' },
  // Cards
  grid: { paddingHorizontal: 14, paddingBottom: 20 },
  card: { width: CARD_W, marginBottom: 12 },
  posterWrap: {
    // overflow:hidden removed — would clip the TV focus border on the TVFocusable parent.
    // borderRadius moved to posterClip so images stay rounded.
    width: CARD_W, height: CARD_H, marginBottom: 5,
    backgroundColor: Colors.bgCardElevated,
  },
  posterClip: {
    width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden',
  },
  poster: { width: '100%', height: '100%' },
  posterPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  playOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, top: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  watchedBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: 2,
  },
  ratingBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(229,0,0,0.85)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
  favBtn: {
    position: 'absolute', right: 4, bottom: 4,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  ratingText: { color: '#fff', fontSize: 8, fontWeight: '700' },
  name: { color: Colors.textSecondary, fontSize: 10, textAlign: 'center', lineHeight: 13 },
  // History
  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'transparent', borderRadius: 10, padding: 10,
    marginBottom: 8, borderWidth: 0, gap: 10,
  },
  historyThumb: {
    width: 46, height: 62, borderRadius: 6,
    backgroundColor: 'rgba(7,7,7,0.20)', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  historyName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 3 },
  historyDate: { color: Colors.textMuted, fontSize: 11 },
});
