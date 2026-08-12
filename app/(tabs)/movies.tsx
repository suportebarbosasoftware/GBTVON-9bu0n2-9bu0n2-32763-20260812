/**
 * Movies Screen — Netflix-style layout
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
import { useMovies } from '@/hooks/useMovies';
import { Colors, Spacing, BorderRadius } from '@/constants/theme';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import {
  addFavorite, removeFavorite, getFavorites, getHistory,
  FavoriteItem, HistoryItem,
} from '@/services/favoritesService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = IS_TV ? 160 : 110;
const CARD_H = Math.round(CARD_W * 1.45);
const HERO_H = IS_TV ? 220 : 180;
const NUM_COLS = Math.max(2, Math.floor(SCREEN_W / (CARD_W + 16)));

// TV focus style reused across movie cards — strong red for TV visibility
const TV_FOCUS: any = {
  borderColor: '#FF0000',
  borderWidth: 5,
  borderRadius: 10,
  shadowColor: '#FF0000',
  shadowOpacity: 1,
  shadowRadius: 24,
  elevation: 40,
  backgroundColor: 'rgba(229,0,0,0.82)',
};

type ActiveTab = 'browse' | 'favorites' | 'history';

export default function MoviesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    categories, movies, selectedCategory, loading,
    searchQuery, setSearchQuery, selectCategory, getMovieUrl,
  } = useMovies();

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<ActiveTab>('browse');
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs for TV D-Pad focus-based scrolling
  const mainListRef = useRef<FlatList>(null);

  useEffect(() => { loadFavoritesAndHistory(); }, []);

  useEffect(() => {
    if (movies.length === 0) return;
    heroTimer.current = setInterval(() => {
      setHeroIndex(i => (i + 1) % Math.min(8, movies.length));
    }, 5000);
    return () => { if (heroTimer.current) clearInterval(heroTimer.current); };
  }, [movies.length]);

  async function loadFavoritesAndHistory() {
    const [favs, hist] = await Promise.all([getFavorites(), getHistory()]);
    setFavorites(new Set(favs.filter(f => f.type === 'movie').map(f => f.id)));
    setWatched(new Set(hist.filter(h => h.type === 'movie').map(h => h.id)));
    setFavoriteItems(favs.filter(f => f.type === 'movie'));
    setHistoryItems(hist.filter(h => h.type === 'movie'));
  }

  async function toggleFavorite(streamId: number, name: string, poster: string) {
    const id = String(streamId);
    if (favorites.has(id)) {
      await removeFavorite(id, 'movie');
      setFavorites(prev => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      await addFavorite({ id, type: 'movie', name, poster });
      setFavorites(prev => new Set(prev).add(id));
    }
    loadFavoritesAndHistory();
  }

  function handlePlay(
    streamId: number, name: string, ext: string, poster: string, directSource?: string
  ) {
    router.push({
      pathname: '/player',
      params: {
        url: getMovieUrl(streamId, ext || 'mp4', directSource),
        title: name,
        type: 'movie',
        poster,
        contentId: String(streamId),
      },
    });
  }

  // Group movies by category for Netflix-style rows (only in browse/all mode)
  const categoryRows = useMemo(() => {
    if (selectedCategory !== 'all' || searchQuery.trim()) return null;
    const rows: { id: string; name: string; items: typeof movies }[] = [];
    for (const cat of categories.slice(0, 12)) {
      const items = movies.filter(m => m.category_id === cat.category_id).slice(0, 20);
      if (items.length > 0) rows.push({ id: cat.category_id, name: cat.category_name, items });
    }
    return rows;
  }, [movies, categories, selectedCategory, searchQuery]);

  const heroMovie = movies[heroIndex];

  // ── Card renderer ─────────────────────────────────────────────────────────
  const renderMovieCard = useCallback((item: typeof movies[0], listIndex?: number) => {
    const id = String(item.stream_id);
    const isFav = favorites.has(id);
    const isWatched = watched.has(id);
    return (
      <TVFocusable
        key={`card-${item.stream_id}`}
        style={styles.movieCard}
        focusedStyle={TV_FOCUS}
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
        onPress={() =>
          handlePlay(item.stream_id, item.name, item.container_extension, item.stream_icon, item.direct_source)
        }
      >
        <View style={styles.posterWrap}>
          <View style={styles.posterClip}>
            {item.stream_icon ? (
              <Image source={{ uri: item.stream_icon }} style={styles.poster} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.posterClip, styles.posterPlaceholder]}>
                <MaterialIcons name="movie" size={24} color={Colors.textMuted} />
              </View>
            )}
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
          <Pressable
            style={styles.favBtn}
            onPress={() => toggleFavorite(item.stream_id, item.name, item.stream_icon)}
            hitSlop={6}
          >
            <Ionicons
              name={isFav ? 'heart' : 'heart-outline'}
              size={14}
              color={isFav ? '#E50000' : 'rgba(255,255,255,0.7)'}
            />
          </Pressable>
        </View>
        <Text style={styles.movieName} numberOfLines={2}>{item.name}</Text>
      </TVFocusable>
    );
  }, [favorites, watched]);

  // ── Header component for main browse FlatList ─────────────────────────────
  const BrowseHeader = useMemo(() => (
    <View>
      {/* Hero */}
      {heroMovie && !searchQuery.trim() && selectedCategory === 'all' && (
        <TVFocusable
          style={styles.hero}
          focusedStyle={{ borderColor: '#FFDD00', borderWidth: 3, borderRadius: 0 }}
          focusScale={1.0}
          overlayBorderRadius={0}
          onPress={() =>
            handlePlay(heroMovie.stream_id, heroMovie.name, heroMovie.container_extension, heroMovie.stream_icon, heroMovie.direct_source)
          }
        >
          {heroMovie.stream_icon ? (
            <Image source={{ uri: heroMovie.stream_icon }} style={styles.heroPoster} contentFit="cover" transition={400} />
          ) : (
            <View style={[styles.heroPoster, { backgroundColor: '#1a0000', alignItems: 'center', justifyContent: 'center' }]}>
              <MaterialIcons name="movie" size={48} color={Colors.primary} />
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.97)']}
            style={styles.heroGradient}
          >
            <View style={styles.heroContent}>
              {heroMovie.rating_5based > 0 && (
                <View style={styles.heroRating}>
                  <Ionicons name="star" size={10} color="#FFD700" />
                  <Text style={styles.heroRatingText}>{heroMovie.rating_5based.toFixed(1)}</Text>
                </View>
              )}
              <Text style={styles.heroTitle} numberOfLines={2}>{heroMovie.name}</Text>
              <View style={styles.heroActions}>
                <Pressable
                  style={styles.heroPlayBtn}
                  onPress={() =>
                    handlePlay(heroMovie.stream_id, heroMovie.name, heroMovie.container_extension, heroMovie.stream_icon, heroMovie.direct_source)
                  }
                >
                  <Ionicons name="play" size={16} color="#000" />
                  <Text style={styles.heroPlayText}>Assistir</Text>
                </Pressable>
                <Pressable
                  style={styles.heroFavBtn}
                  onPress={() => toggleFavorite(heroMovie.stream_id, heroMovie.name, heroMovie.stream_icon)}
                >
                  <Ionicons
                    name={favorites.has(String(heroMovie.stream_id)) ? 'heart' : 'heart-outline'}
                    size={16}
                    color="#fff"
                  />
                </Pressable>
              </View>
            </View>
            <View style={styles.heroDots}>
              {Array.from({ length: Math.min(8, movies.length) }).map((_, i) => (
                <View key={i} style={[styles.heroDot, i === heroIndex && styles.heroDotActive]} />
              ))}
            </View>
          </LinearGradient>
        </TVFocusable>
      )}

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={14} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar filme..."
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
            <Text style={[styles.chipText, selectedCategory === 'all' && styles.chipTextActive]}>Todos</Text>
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
                keyExtractor={item => `h-${item.stream_id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
                renderItem={({ item }) => renderMovieCard(item)}
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

      {/* Grid header when searching/filtering */}
      {(!categoryRows || searchQuery.trim()) ? (
        <View style={styles.gridPadding} />
      ) : null}
    </View>
  ), [heroMovie, heroIndex, movies.length, searchQuery, selectedCategory, categories, categoryRows, favorites, watched]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Carregando filmes...</Text>
      </View>
    );
  }

  // ── Favorites tab ──────────────────────────────────────────────────────────
  if (activeTab === 'favorites') {
    return (
      <View style={styles.container}>
        <TabHeader
          activeTab={activeTab}
          count={movies.length}
          onChange={tab => { setActiveTab(tab); if (tab !== 'browse') loadFavoritesAndHistory(); }}
        />
        <FlatList
          data={favoriteItems}
          keyExtractor={item => `fav-${item.id}`}
          numColumns={NUM_COLS}
          key={`fav-${NUM_COLS}`}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={NUM_COLS > 1 ? { gap: 8, justifyContent: 'flex-start' } : undefined}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const movie = movies.find(m => String(m.stream_id) === item.id);
            if (!movie) {
              return (
                <View style={styles.movieCard}>
                  <View style={[styles.posterWrap, styles.posterPlaceholder]}>
                    {item.poster
                      ? <Image source={{ uri: item.poster }} style={styles.poster} contentFit="cover" />
                      : <MaterialIcons name="movie" size={24} color={Colors.textMuted} />}
                  </View>
                  <Text style={styles.movieName} numberOfLines={2}>{item.name}</Text>
                </View>
              );
            }
            return renderMovieCard(movie);
          }}
          ListEmptyComponent={<EmptyState icon="heart-outline" label="Sem favoritos" />}
        />
      </View>
    );
  }

  // ── History tab ────────────────────────────────────────────────────────────
  if (activeTab === 'history') {
    return (
      <View style={styles.container}>
        <TabHeader
          activeTab={activeTab}
          count={movies.length}
          onChange={tab => { setActiveTab(tab); if (tab !== 'browse') loadFavoritesAndHistory(); }}
        />
        <FlatList
          data={historyItems}
          keyExtractor={item => `hist-${item.id}-${item.watchedAt}`}
          contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const movie = movies.find(m => String(m.stream_id) === item.id);
            return (
              <TVFocusable
                style={styles.historyRow}
                focusedStyle={{ borderColor: '#FFDD00', borderWidth: 2 }}
                overlayBorderRadius={10}
                onPress={() =>
                  movie && handlePlay(movie.stream_id, movie.name, movie.container_extension, movie.stream_icon, movie.direct_source)
                }
              >
                <View style={styles.historyThumb}>
                  {item.poster
                    ? <Image source={{ uri: item.poster }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    : <MaterialIcons name="movie" size={20} color={Colors.textMuted} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.historyDate}>{new Date(item.watchedAt).toLocaleDateString('pt-BR')}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
              </TVFocusable>
            );
          }}
          ListEmptyComponent={<EmptyState icon="time-outline" label="Sem histórico" />}
        />
      </View>
    );
  }

  // ── Browse tab ─────────────────────────────────────────────────────────────
  const showGrid = !categoryRows || !!searchQuery.trim();

  return (
    <View style={styles.container}>
      <TabHeader
        activeTab={activeTab}
        count={movies.length}
        onChange={tab => { setActiveTab(tab); if (tab !== 'browse') loadFavoritesAndHistory(); }}
      />
      {showGrid ? (
        // Flat grid mode (search or category selected)
        <FlatList
          ref={mainListRef}
          data={movies}
          keyExtractor={item => `g-${item.stream_id}`}
          numColumns={NUM_COLS}
          key={`grid-${NUM_COLS}`}
          ListHeaderComponent={BrowseHeader}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={NUM_COLS > 1 ? { gap: 8, justifyContent: 'flex-start' } : undefined}
          showsVerticalScrollIndicator={false}
          // TV D-Pad: keep items mounted + disable scroll so only programmatic
          // scrollToIndex triggers item-by-item jumps (no smooth mouse-like scroll)
          removeClippedSubviews={false}
          scrollEnabled={!IS_TV}
          windowSize={IS_TV ? 21 : 10}
          renderItem={({ item, index }) => renderMovieCard(item, index)}
          ListEmptyComponent={<EmptyState icon="movie" label="Nenhum filme encontrado" />}
          initialNumToRender={IS_TV ? 30 : 20}
          maxToRenderPerBatch={IS_TV ? 30 : 20}
          onScrollToIndexFailed={() => {}}
        />
      ) : (
        // Netflix rows mode (all categories, no search)
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
function TabHeader({
  activeTab, count, onChange,
}: {
  activeTab: ActiveTab;
  count: number;
  onChange: (tab: ActiveTab) => void;
}) {
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Filmes</Text>
        <Text style={styles.countBadge}>{count}</Text>
      </View>
      <View style={styles.tabRow}>
        {(['browse', 'favorites', 'history'] as ActiveTab[]).map(tab => (
          <TVFocusable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            focusedStyle={{ borderColor: '#E50000', borderWidth: 2, shadowColor: '#E50000', shadowOpacity: 0.7, shadowRadius: 8 }}
            onPress={() => onChange(tab)}
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

function EmptyState({ icon, label }: { icon: string; label: string }) {
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
  heroActions: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  heroPlayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7,
  },
  heroPlayText: { color: '#000', fontSize: 13, fontWeight: '700' },
  heroFavBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  heroDots: { flexDirection: 'row', gap: 5, justifyContent: 'center' },
  heroDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  heroDotActive: { backgroundColor: Colors.primary, width: 14 },
  // Search & filters
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
  // Category rows
  categoryRow: { marginTop: 14 },
  categoryRowHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, marginBottom: 8,
  },
  categoryRowTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  seeAll: { color: Colors.primary, fontSize: 11, fontWeight: '600' },
  // Cards
  gridPadding: { height: 8 },
  grid: { paddingHorizontal: 14, paddingBottom: 20 },
  movieCard: { width: CARD_W, marginBottom: 12 },
  posterWrap: {
    // overflow:hidden removed — would clip the TV focus border applied on the TVFocusable parent.
    // borderRadius is now on posterClip (inner view) so images stay rounded.
    width: CARD_W, height: CARD_H, marginBottom: 5,
    backgroundColor: Colors.bgCardElevated,
  },
  posterClip: {
    width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden',
  },
  poster: { width: '100%', height: '100%' },
  posterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  watchedBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: 2,
  },
  ratingBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(229,0,0,0.85)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
  ratingText: { color: '#fff', fontSize: 8, fontWeight: '700' },
  favBtn: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 3,
  },
  movieName: { color: Colors.textSecondary, fontSize: 10, textAlign: 'center', lineHeight: 13 },
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
