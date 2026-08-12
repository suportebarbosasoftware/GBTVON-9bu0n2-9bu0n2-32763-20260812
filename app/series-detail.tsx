import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSeries } from '@/hooks/useSeries';
import { SeriesInfo, Episode } from '@/services/xtreamApi';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { getCompletedEpisodes, getProgressForSeries, WatchProgress } from '@/services/favoritesService';
import TVFocusable from '@/components/ui/TVFocusable';
import { IS_TV } from '@/hooks/useTV';

export default function SeriesDetailScreen() {
  const { seriesId, name, cover } = useLocalSearchParams<{ seriesId: string; name: string; cover: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fetchSeriesInfo, getEpisodeUrl } = useSeries();
  const [seriesInfo, setSeriesInfo] = useState<SeriesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<string>('');

  const [completedEpisodes, setCompletedEpisodes] = useState<Set<string>>(new Set());
  const [episodeProgress, setEpisodeProgress] = useState<Record<string, WatchProgress>>({});

  // D-Pad focus tracking — driven exclusively by native onFocus/onBlur
  const episodeListRef = useRef<FlatList>(null);
  const isUnmounted = useRef(false);

  useEffect(() => {
    loadInfo();
    loadProgress();
    return () => { isUnmounted.current = true; };
  }, [seriesId]);

  // Android back button
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.back();
      return true;
    });
    return () => sub.remove();
  }, []);

  async function loadInfo() {
    if (!seriesId) return;
    setLoading(true);
    const info = await fetchSeriesInfo(Number(seriesId));
    setSeriesInfo(info);
    if (info && info.episodes) {
      const seasons = Object.keys(info.episodes);
      if (seasons.length > 0) setSelectedSeason(seasons[0]);
    }
    setLoading(false);
  }

  async function loadProgress() {
    if (!seriesId) return;
    const [completed, progress] = await Promise.all([
      getCompletedEpisodes(),
      getProgressForSeries(seriesId),
    ]);
    setCompletedEpisodes(completed);
    setEpisodeProgress(progress);
  }

  function handlePlayEpisode(episode: Episode, resumePosition?: number) {
    const ext = episode.container_extension || 'mp4';
    const url = getEpisodeUrl(episode.id, ext, episode.direct_source);
    router.push({
      pathname: '/player',
      params: {
        url,
        title: `${name} - T${episode.season}:E${episode.episode_num} ${episode.title}`,
        type: 'episode',
        poster: episode.info?.movie_image || cover,
        contentId: episode.id,
        seriesId,
        seriesName: name,
        resumePosition: resumePosition ? String(Math.floor(resumePosition)) : undefined,
      },
    });
  }

  function findContinueEpisode(): { episode: Episode; season: string; progress?: WatchProgress } | null {
    if (!seriesInfo) return null;
    const seasons = Object.keys(seriesInfo.episodes).sort();
    for (const season of seasons) {
      const episodes = seriesInfo.episodes[season] || [];
      for (const ep of episodes) {
        const prog = episodeProgress[ep.id];
        if (prog && prog.position > 10) return { episode: ep, season, progress: prog };
      }
    }
    for (const season of seasons) {
      const episodes = seriesInfo.episodes[season] || [];
      for (const ep of episodes) {
        if (!completedEpisodes.has(ep.id)) return { episode: ep, season };
      }
    }
    return null;
  }

  const seasons = seriesInfo ? Object.keys(seriesInfo.episodes).sort() : [];
  const currentEpisodes = seriesInfo && selectedSeason ? seriesInfo.episodes[selectedSeason] || [] : [];
  const continueEntry = seriesInfo ? findContinueEpisode() : null;
  const completedInSeason = currentEpisodes.filter(ep => completedEpisodes.has(ep.id)).length;

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Carregando episódios...</Text>
      </View>
    );
  }

  // ── Header rendered as ListHeaderComponent ────────────────────────────────
  const ListHeader = (
    <View>
      {/* Back */}
      <TVFocusable
        style={styles.backBtn}
        focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.3)', borderColor: '#E50000', borderWidth: 2, borderRadius: 10 }}
        overlayBorderRadius={10}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={IS_TV ? 28 : 22} color="#fff" />
        <Text style={[styles.backText, IS_TV && { fontSize: 18 }]}>Séries</Text>
      </TVFocusable>

      {/* Hero */}
      <View style={styles.hero}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.heroImg} contentFit="cover" />
        ) : (
          <View style={styles.heroPlaceholder}>
            <MaterialIcons name="video-library" size={60} color={Colors.textMuted} />
          </View>
        )}
        <View style={styles.heroOverlay} />
        <View style={styles.heroInfo}>
          <Text style={[styles.heroTitle, IS_TV && { fontSize: 26 }]}>{name}</Text>
          {seriesInfo?.info?.genre ? (
            <Text style={styles.heroGenre}>{seriesInfo.info.genre}</Text>
          ) : null}
          {seriesInfo?.info?.rating ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color="#FACC15" />
              <Text style={styles.rating}> {seriesInfo.info.rating}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Continue watching */}
      {continueEntry ? (
        <View style={styles.continueSection}>
          <TVFocusable
            style={styles.continueBtn}
            focusedStyle={{ borderWidth: 3, borderColor: '#fff', shadowColor: '#fff', shadowOpacity: 0.6, shadowRadius: 12, elevation: 18 }}
            overlayBorderRadius={14}
            onPress={() => handlePlayEpisode(continueEntry.episode, continueEntry.progress?.position)}
          >
            <View style={styles.continueBtnLeft}>
              <Ionicons name="play-circle" size={IS_TV ? 42 : 32} color="#fff" />
              <View>
                <Text style={[styles.continueBtnLabel, IS_TV && { fontSize: 16 }]}>
                  {continueEntry.progress ? 'Continuar assistindo' : 'Próximo episódio'}
                </Text>
                <Text style={styles.continueBtnEp} numberOfLines={1}>
                  T{continueEntry.episode.season}:E{continueEntry.episode.episode_num}
                  {continueEntry.episode.title ? ` - ${continueEntry.episode.title}` : ''}
                </Text>
                {continueEntry.progress && continueEntry.progress.duration > 0 ? (
                  <View style={styles.continueProgressBar}>
                    <View style={[
                      styles.continueProgressFill,
                      { width: `${Math.min(100, (continueEntry.progress.position / continueEntry.progress.duration) * 100)}%` as any }
                    ]} />
                  </View>
                ) : null}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TVFocusable>
        </View>
      ) : null}

      {/* Plot */}
      {seriesInfo?.info?.plot ? (
        <View style={styles.plotSection}>
          <Text style={styles.plotText} numberOfLines={4}>{seriesInfo.info.plot}</Text>
        </View>
      ) : null}

      {/* Season selector */}
      {seasons.length > 0 && (
        <View style={styles.seasonSection}>
          <Text style={[styles.sectionTitle, IS_TV && { fontSize: 20 }]}>Temporadas</Text>
          <View style={styles.seasonRow}>
            {seasons.map(season => {
              const eps = seriesInfo?.episodes[season] || [];
              const done = eps.filter(e => completedEpisodes.has(e.id)).length;
              const allDone = done === eps.length && eps.length > 0;
              return (
                <TVFocusable
                  key={season}
                  style={[styles.seasonChip, selectedSeason === season && styles.seasonChipActive]}
                  focusedStyle={{
                    borderWidth: 3,
                    borderColor: '#E50000',
                    backgroundColor: 'rgba(229,0,0,0.45)',
                    shadowColor: '#E50000',
                    shadowOpacity: 1,
                    shadowRadius: 10,
                    elevation: 16,
                  }}
                  overlayBorderRadius={999}
                  onPress={() => setSelectedSeason(season)}
                >
                  <Text style={[styles.seasonText, selectedSeason === season && styles.seasonTextActive, IS_TV && { fontSize: 16 }]}>
                    T{season}
                  </Text>
                  {allDone ? (
                    <Ionicons name="checkmark-circle" size={12} color={selectedSeason === season ? '#fff' : '#4CAF50'} />
                  ) : done > 0 ? (
                    <Text style={[styles.seasonProgress, selectedSeason === season && { color: 'rgba(255,255,255,0.8)' }]}>
                      {done}/{eps.length}
                    </Text>
                  ) : null}
                </TVFocusable>
              );
            })}
          </View>
        </View>
      )}

      {/* Episodes header */}
      <View style={styles.episodesSectionHeader}>
        <Text style={[styles.sectionTitle, IS_TV && { fontSize: 20 }]}>
          Episódios ({currentEpisodes.length})
        </Text>
        {completedInSeason > 0 ? (
          <Text style={styles.completedCount}>
            {completedInSeason}/{currentEpisodes.length} concluídos
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        ref={episodeListRef}
        data={currentEpisodes}
        keyExtractor={(ep, index) => `${ep.id}-${index}`}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        // TV D-Pad: keep items mounted + disable scroll so only programmatic
        // scrollToIndex triggers item-by-item jumps (no smooth mouse-like scroll)
        removeClippedSubviews={false}
        scrollEnabled={!IS_TV}
        windowSize={IS_TV ? 21 : 10}
        initialNumToRender={IS_TV ? 30 : 15}
        maxToRenderPerBatch={IS_TV ? 30 : 15}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item: ep, index }) => {
          const isCompleted = completedEpisodes.has(ep.id);
          const prog = episodeProgress[ep.id];
          const progressPct = prog && prog.duration > 0 ? prog.position / prog.duration : 0;
          const hasProgress = prog && prog.position > 10 && !isCompleted;

          return (
            <TVFocusable
              key={`${ep.id}-${index}`}
              style={[
                styles.episodeRow,
                IS_TV && styles.episodeRowTV,
                isCompleted && styles.episodeRowCompleted,
                hasProgress && styles.episodeRowInProgress,
              ]}
              focusedStyle={{
                backgroundColor: 'rgba(229,0,0,0.82)',
                borderColor: '#FF0000',
                borderWidth: 5,
                shadowColor: '#FF0000',
                shadowOpacity: 1,
                shadowRadius: 24,
                elevation: 40,
              }}
              overlayBorderRadius={IS_TV ? 14 : 10}
              focusScale={IS_TV ? 1.03 : 1.0}
              hasTVPreferredFocus={IS_TV && index === 0}
              onFocus={() => {
                try {
                  episodeListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
                } catch {}
              }}
              onPress={() => handlePlayEpisode(ep, hasProgress ? prog?.position : undefined)}
            >
              <View style={[
                styles.epNumBox,
                isCompleted && styles.epNumBoxCompleted,
                hasProgress && styles.epNumBoxProgress,
                IS_TV && styles.epNumBoxTV,
              ]}>
                {isCompleted ? (
                  <Ionicons name="checkmark" size={IS_TV ? 22 : 16} color="#4CAF50" />
                ) : (
                  <Text style={[styles.epNum, IS_TV && { fontSize: 18 }, hasProgress && { color: '#FF9800' }]}>
                    {ep.episode_num}
                  </Text>
                )}
              </View>
              <View style={styles.epInfo}>
                <Text style={[styles.epTitle, IS_TV && { fontSize: 16 }, isCompleted && styles.epTitleCompleted]} numberOfLines={1}>
                  {ep.title || `Episódio ${ep.episode_num}`}
                </Text>
                <View style={styles.epMeta}>
                  {ep.info?.duration ? (
                    <Text style={[styles.epDuration, IS_TV && { fontSize: 13 }]}>{ep.info.duration}</Text>
                  ) : null}
                  {hasProgress ? (
                    <Text style={[styles.epProgressText, IS_TV && { fontSize: 13 }]}>
                      {formatTime(prog!.position)} / {prog!.duration > 0 ? formatTime(prog!.duration) : '?'}
                    </Text>
                  ) : null}
                  {isCompleted ? (
                    <Text style={[styles.epCompletedText, IS_TV && { fontSize: 13 }]}>Assistido</Text>
                  ) : null}
                </View>
                {hasProgress ? (
                  <View style={styles.epProgressBar}>
                    <View style={[styles.epProgressFill, { width: `${Math.min(100, progressPct * 100)}%` as any }]} />
                  </View>
                ) : null}
              </View>
              <Ionicons
                name={hasProgress ? 'play-circle' : isCompleted ? 'checkmark-circle' : 'play-circle-outline'}
                size={IS_TV ? 40 : 30}
                color={hasProgress ? '#FF9800' : isCompleted ? '#4CAF50' : Colors.primary}
              />
            </TVFocusable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyEpisodes}>
            <Text style={styles.emptyText}>Nenhum episódio disponível</Text>
          </View>
        }
      />
    </View>
  );
}

function formatTime(s: number): string {
  if (!s || isNaN(s) || s <= 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingText: { color: Colors.textSecondary, marginTop: 12 },
  listContent: { paddingBottom: 40 },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  backText: { color: '#fff', fontSize: FontSize.md, marginLeft: 6, fontWeight: '500' },

  hero: {
    height: IS_TV ? 280 : 220,
    marginHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroImg: { width: '100%', height: '100%' },
  heroPlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: Colors.bgCardElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  heroOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  heroInfo: { position: 'absolute', bottom: 16, left: 16, right: 16 },
  heroTitle: { color: '#fff', fontSize: FontSize.xl, fontWeight: '700', marginBottom: 4 },
  heroGenre: { color: Colors.textSecondary, fontSize: FontSize.xs, marginBottom: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  rating: { color: '#FACC15', fontSize: FontSize.sm, fontWeight: '600' },

  continueSection: { paddingHorizontal: Spacing.md, marginBottom: 12 },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: IS_TV ? 16 : 12,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 8,
  },
  continueBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  continueBtnLabel: { color: '#fff', fontSize: 13, fontWeight: '700' },
  continueBtnEp: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2, maxWidth: 220 },
  continueProgressBar: {
    height: 3, backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2, marginTop: 6, width: 160, overflow: 'hidden',
  },
  continueProgressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },

  plotSection: { paddingHorizontal: Spacing.md, marginBottom: 16 },
  plotText: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },

  seasonSection: { marginBottom: 16, paddingHorizontal: Spacing.md },
  sectionTitle: {
    color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700', marginBottom: 10,
  },
  seasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seasonChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: IS_TV ? 20 : 16,
    paddingVertical: IS_TV ? 12 : 8,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.bgCardElevated,
    borderWidth: 1, borderColor: Colors.border,
    minWidth: IS_TV ? 72 : 56, alignItems: 'center', justifyContent: 'center',
  },
  seasonChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  seasonText: { color: Colors.textSecondary, fontSize: IS_TV ? 14 : FontSize.sm, fontWeight: '600' },
  seasonTextActive: { color: '#fff' },
  seasonProgress: { color: '#4CAF50', fontSize: 9, fontWeight: '700' },

  episodesSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, marginBottom: 8,
  },
  completedCount: { color: '#4CAF50', fontSize: 11, fontWeight: '700' },

  episodeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: BorderRadius.md,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
    marginHorizontal: Spacing.md,
  },
  episodeRowTV: {
    paddingVertical: 18, paddingHorizontal: 16, borderRadius: 14, marginBottom: 10,
  },
  episodeRowCompleted: { opacity: 0.65 },
  episodeRowInProgress: { borderColor: 'rgba(255,152,0,0.4)', backgroundColor: 'rgba(255,152,0,0.04)' },

  epNumBox: {
    width: 36, height: 36, borderRadius: 6,
    backgroundColor: Colors.bgCardElevated,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  epNumBoxTV: { width: 48, height: 48, borderRadius: 10, marginRight: 16 },
  epNumBoxCompleted: { backgroundColor: 'rgba(76,175,80,0.12)', borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)' },
  epNumBoxProgress: { backgroundColor: 'rgba(255,152,0,0.12)', borderWidth: 1, borderColor: 'rgba(255,152,0,0.3)' },
  epNum: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },

  epInfo: { flex: 1 },
  epTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '600', marginBottom: 3 },
  epTitleCompleted: { color: Colors.textMuted },
  epMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  epDuration: { color: Colors.textMuted, fontSize: FontSize.xs },
  epProgressText: { color: '#FF9800', fontSize: FontSize.xs, fontWeight: '600' },
  epCompletedText: { color: '#4CAF50', fontSize: FontSize.xs, fontWeight: '600' },
  epProgressBar: {
    height: 3, backgroundColor: 'rgba(255,152,0,0.2)',
    borderRadius: 2, marginTop: 6, overflow: 'hidden',
  },
  epProgressFill: { height: '100%', backgroundColor: '#FF9800', borderRadius: 2 },

  emptyEpisodes: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.sm },
});
