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
import { getHistory, HistoryItem } from '@/services/favoritesService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = IS_TV ? 160 : 110;
const CARD_H = Math.round(CARD_W * 1.45);
const HERO_H = IS_TV ? 220 : 180;
const NUM_COLS = Math.max(2, Math.floor(SCREEN_W / (CARD_W + 16)));

type ActiveTab = 'browse' | 'history';

export default function SeriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { categories, seriesList, selectedCategory, loading, searchQuery, setSearchQuery, selectCategory } = useSeries();

  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('browse');
  const [heroIndex, setHeroIndex] = useState(0);
  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref for TV D-Pad focus-based scrolling
  const mainListRef = useRef<FlatList>(null);

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (seriesList.length === 0) return;
    heroTimer.current = setInterval(() => {
      setHeroIndex(i => (i + 1) % Math.min(8, seriesList.length));
    }, 5500);
    return () => { if (heroTimer.current) clearInterval(heroTimer.current); };
  }, [seriesList.length]);

  async function loadHistory() {
    const hist = await getHistory();
    const sh = hist.filter(h => h.type === 'episode' || (h.type as string) === 'series');
    setWatched(new Set(sh.map(h => h.seriesId || h.id)));
    setHistoryItems(sh);
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
    for (const cat of categories.slice(0, 12)) {
      const items = seriesList.filter(s => s.category_id === cat.category_id).slice(0, 20);
      if (items.length > 0) rows.push({ id: cat.category_id, name: cat.category_name, items });
    }
    return rows;
  }, [seriesList, categories, selectedCategory, searchQuery]);

  const heroSeries = seriesList[heroIndex];

  // ── Card renderer ──────────────────────────────────────────────────────────
  const renderCard = useCallback((item: typeof seriesList[0], listIndex?: number) => {
    const isWatched = watched.has(String(item.series_id));
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
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
      </TVFocusable>
    );
  }, [watched]);

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
              {Array.from({ length: Math.min(8, seriesList.length) }).map((_, i) => (
                <View key={i} style={[styles.heroDot, i === heroIndex && styles.heroDotActive]} />
              ))}
            </View>
          </LinearGradient>
        </Pressable>
      )}

      {/* Search */}
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

      {/* Category chips */}
      <View style={styles.categoryBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryContent}>
          <Pressable
            style={[styles.chip, selectedCategory === 'all' && styles.chipActive]}
            onPress={() => selectCategory('all')}
          >
            <Text style={[styles.chipText, selectedCategory === 'all' && styles.chipTextActive]}>Todas</Text>
          </Pressable>
          {categories.map(cat => (
            <Pressable
              key={cat.category_id}
              style={[styles.chip, selectedCategory === cat.category_id && styles.chipActive]}
              onPress={() => selectCategory(cat.category_id)}
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
  ), [heroSeries, heroIndex, seriesList.length, searchQuery, selectedCategory, categories, categoryRows, watched]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Carregando séries...</Text>
      </View>
    );
  }

  // ── History tab ────────────────────────────────────────────────────────────
  if (activeTab === 'history') {
    return (
      <View style={styles.container}>
        <SeriesTabHeader activeTab={activeTab} count={seriesList.length} onChange={setActiveTab} onHistoryLoad={loadHistory} />
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
    <View style={styles.container}>
      <SeriesTabHeader activeTab={activeTab} count={seriesList.length} onChange={setActiveTab} onHistoryLoad={loadHistory} />
      {showGrid ? (
        <FlatList
          ref={mainListRef}
          data={seriesList}
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
  );
}

// ── Tab Header ──────────────────────────────────────────────────────────────
function SeriesTabHeader({
  activeTab, count, onChange, onHistoryLoad,
}: {
  activeTab: ActiveTab;
  count: number;
  onChange: (tab: ActiveTab) => void;
  onHistoryLoad: () => void;
}) {
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Séries</Text>
        <Text style={styles.countBadge}>{count}</Text>
      </View>
      <View style={styles.tabRow}>
        {(['browse', 'history'] as ActiveTab[]).map(tab => (
          <TVFocusable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            focusedStyle={{ borderColor: '#E50000', borderWidth: 2, shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 8 }}
            onPress={() => { onChange(tab); if (tab === 'history') onHistoryLoad(); }}
          >
            <Ionicons
              name={tab === 'browse' ? 'grid-outline' : 'time-outline'}
              size={13}
              color={activeTab === tab ? '#fff' : Colors.textMuted}
            />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'browse' ? 'Navegar' : 'Histórico'}
            </Text>
          </TVFocusable>
        ))}
      </View>
    </>
  );
}

function EmptyState() {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <MaterialIcons name="video-library" size={52} color={Colors.textMuted} />
      <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '600', marginTop: 12 }}>
        Nenhuma série encontrada
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
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
    backgroundColor: Colors.bgCardElevated, borderWidth: 1, borderColor: Colors.border,
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
    backgroundColor: Colors.bgInput, marginHorizontal: 14, marginTop: 8,
    borderRadius: 10, paddingHorizontal: 10, height: 36,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 13 },
  categoryBar: { height: 42, marginTop: 4 },
  categoryContent: { paddingHorizontal: 14, alignItems: 'center', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
    backgroundColor: Colors.bgCardElevated, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
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
  ratingText: { color: '#fff', fontSize: 8, fontWeight: '700' },
  name: { color: Colors.textSecondary, fontSize: 10, textAlign: 'center', lineHeight: 13 },
  // History
  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: 10, padding: 10,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  historyThumb: {
    width: 46, height: 62, borderRadius: 6,
    backgroundColor: Colors.bgCardElevated, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  historyName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 3 },
  historyDate: { color: Colors.textMuted, fontSize: 11 },
});
