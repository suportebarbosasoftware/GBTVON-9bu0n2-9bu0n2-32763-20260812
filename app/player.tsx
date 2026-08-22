/**
 * GBTVON — Video Player
 * Supports: Live TV, Movies (VOD), Series Episodes
 * D-Pad: left/right = seek ±10s (VOD), up/down = channel switch (live), OK = play/pause
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Animated,
  BackHandler,
  Platform,
  FlatList,
  TVEventHandler,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { getLiveStreamUrl, getLiveStreams, LiveStream, getShortEpg, EpgProgram, epgTimeLabel } from '@/services/xtreamApi';
import { saveProgress, addToHistory, getProgress, WatchProgress } from '@/services/favoritesService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import { Colors } from '@/constants/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function formatTime(s: number): string {
  if (!s || isNaN(s) || s <= 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function PlayerScreen() {
  const { url, title, type, poster, contentId, seriesId, seriesName, resumePosition } =
    useLocalSearchParams<{
      url: string;
      title: string;
      type: 'live' | 'movie' | 'episode';
      poster?: string;
      contentId?: string;
      seriesId?: string;
      seriesName?: string;
      resumePosition?: string;
    }>();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { auth } = useAuth();
  const isLive = type === 'live';

  // ── Player ──────────────────────────────────────────────────────────────
  const player = useVideoPlayer(url || '', p => {
    p.loop = isLive;
    p.play();
  });

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);

  // Stable refs so TVEventHandler closure always has latest values
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(true);
  const seekRef = useRef<(t: number) => void>(() => {});
  const togglePlayRef = useRef<() => void>(() => {});
  const showControlsRef = useRef<() => void>(() => {});
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Controls auto-hide
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  function showControlsNow() {
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    setShowControls(true);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    hideControlsTimerRef.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() =>
        setShowControls(false)
      );
    }, 4000);
  }

  useEffect(() => {
    showControlsRef.current = showControlsNow;
  });

  useEffect(() => {
    showControlsNow();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, []);

  // ── Playback state sync ────────────────────────────────────────────────
  useEffect(() => {
    const sub = player.addListener('playingChange', (evt: any) => {
      const playing = evt?.isPlaying ?? false;
      setIsPlaying(playing);
      isPlayingRef.current = playing;
    });
    return () => sub?.remove?.();
  }, [player]);

  useEffect(() => {
    const sub = player.addListener('statusChange', (evt: any) => {
      setIsBuffering(evt?.status === 'loading' || evt?.status === 'buffering');
    });
    return () => sub?.remove?.();
  }, [player]);

  // Poll current time (no currentTime event in expo-video)
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const ct = (player as any).currentTime ?? 0;
        const dur = (player as any).duration ?? 0;
        setCurrentTime(ct);
        setDuration(dur);
        currentTimeRef.current = ct;
      } catch {}
    }, 500);
    return () => clearInterval(interval);
  }, [player]);

  // Resume position
  useEffect(() => {
    if (!isLive && resumePosition) {
      const pos = parseFloat(resumePosition);
      if (pos > 5) {
        setTimeout(() => {
          try { player.seekBy(pos); } catch {}
        }, 1500);
      }
    }
  }, []);

  // ── Seek & play/pause ──────────────────────────────────────────────────
  function seekTo(t: number) {
    try {
      const clamp = Math.max(0, duration > 0 ? Math.min(t, duration - 1) : t);
      const delta = clamp - currentTimeRef.current;
      player.seekBy(delta);
      currentTimeRef.current = clamp;
      setCurrentTime(clamp);
    } catch {}
    showControlsNow();
  }

  function togglePlay() {
    try {
      if (isPlayingRef.current) {
        player.pause();
      } else {
        player.play();
      }
    } catch {}
    showControlsNow();
  }

  useEffect(() => {
    seekRef.current = seekTo;
  });
  useEffect(() => {
    togglePlayRef.current = togglePlay;
  });

  // ── Watch progress auto-save ───────────────────────────────────────────
  useEffect(() => {
    if (isLive || !contentId) return;
    const interval = setInterval(() => {
      const ct = currentTimeRef.current;
      const dur = duration;
      if (ct > 5) {
        saveProgress({
          id: contentId,
          type: type === 'episode' ? 'episode' : 'movie',
          position: ct,
          duration: dur,
          updatedAt: Date.now(),
          seriesId: seriesId,
          seriesName: seriesName,
          title: title,
          poster: poster,
        });
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [duration, contentId, isLive]);

  // Add to history when leaving
  useEffect(() => {
    return () => {
      if (!isLive && contentId) {
        addToHistory({
          id: contentId,
          type: type === 'episode' ? 'episode' : 'movie',
          name: title || 'Desconhecido',
          poster: poster || '',
          seriesId,
          seriesName,
        });
      }
    };
  }, []);

  // ── Live: channels list ────────────────────────────────────────────────
  const [channelBrowserVisible, setChannelBrowserVisible] = useState(false);
  const [allChannels, setAllChannels] = useState<LiveStream[]>([]);
  const [currentChannelIndex, setCurrentChannelIndex] = useState(0);
  const channelListRef = useRef<FlatList>(null);
  const channelBrowserVisibleRef = useRef(false);
  const currentChannelIndexRef = useRef(0);
  const channelChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedChannelIndexRef = useRef<number | null>(null);
  const changeChannelRef = useRef<(idx: number) => void>(() => {});
  const openChannelBrowserRef = useRef<() => void>(() => {});

  useEffect(() => {
    channelBrowserVisibleRef.current = channelBrowserVisible;
  }, [channelBrowserVisible]);

  useEffect(() => {
    currentChannelIndexRef.current = currentChannelIndex;
  }, [currentChannelIndex]);

  useEffect(() => {
    if (isLive && auth) {
      getLiveStreams(auth).then(streams => {
        setAllChannels(streams);
        const idx = streams.findIndex(s => getLiveStreamUrl(auth, s.stream_id) === url);
        if (idx >= 0) {
          setCurrentChannelIndex(idx);
          currentChannelIndexRef.current = idx;
        }
      });
    }
  }, [isLive, auth]);

  function changeChannel(idx: number) {
    if (!auth || !allChannels[idx]) return;
    const stream = allChannels[idx];
    setCurrentChannelIndex(idx);
    currentChannelIndexRef.current = idx;
    requestedChannelIndexRef.current = idx;
    setIsBuffering(true);

    // A held D-pad key can emit several events quickly. Keep navigation
    // immediate, but replace the video source only once for the final channel.
    if (channelChangeTimerRef.current) clearTimeout(channelChangeTimerRef.current);
    channelChangeTimerRef.current = setTimeout(() => {
      const requestedIndex = requestedChannelIndexRef.current;
      if (requestedIndex === null || !allChannels[requestedIndex]) return;
      const requested = allChannels[requestedIndex];
      try {
        player.replace({ uri: getLiveStreamUrl(auth, requested.stream_id) });
        player.play();
      } catch {}
    }, IS_TV ? 120 : 0);

    try {
      channelListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.4 });
    } catch {}
  }

  function openChannelBrowser() {
    setChannelBrowserVisible(true);
    showControlsNow();
  }

  useEffect(() => {
    changeChannelRef.current = changeChannel;
    openChannelBrowserRef.current = openChannelBrowser;
  });

  useEffect(() => () => {
    if (channelChangeTimerRef.current) clearTimeout(channelChangeTimerRef.current);
  }, []);

  // ── EPG for current channel ────────────────────────────────────────────
  const [epgPrograms, setEpgPrograms] = useState<EpgProgram[]>([]);
  const epgRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isLive || !auth || !allChannels[currentChannelIndex]) return;
    const stream = allChannels[currentChannelIndex];
    const requestId = ++epgRequestIdRef.current;
    // EPG is auxiliary information. Delay it slightly so it never competes
    // with the stream request while the user is rapidly changing channels.
    const timer = setTimeout(() => {
      getShortEpg(auth, stream.stream_id, 3).then(progs => {
        if (epgRequestIdRef.current === requestId) setEpgPrograms(progs);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [currentChannelIndex, isLive, auth, allChannels]);

  // ── Back button ────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (channelBrowserVisibleRef.current) {
        setChannelBrowserVisible(false);
        return true;
      }
      try { player.pause(); } catch {}
      router.back();
      return true;
    });
    return () => sub.remove();
  }, []);

  // ── TV D-Pad handler ───────────────────────────────────────────────────
  useEffect(() => {
    if (!IS_TV) return;
    let tvHandler: any = null;
    try {
      const TVEvt = TVEventHandler as any;
      if (!TVEvt) return;
      tvHandler = new TVEvt();
      tvHandler.enable(null, (_cmp: any, evt: any) => {
        if (!evt) return;
        const key: string = evt.eventType ?? '';
        const keyCode: number = evt.eventKeyCode ?? 0;

        // OK / select / play-pause
        if (key === 'select' || keyCode === 23 || key === 'playPause') {
          if (channelBrowserVisibleRef.current) {
            changeChannelRef.current(currentChannelIndexRef.current);
            setChannelBrowserVisible(false);
          } else if (isLive) {
            openChannelBrowserRef.current();
          } else {
            togglePlayRef.current();
          }
          return;
        }

        // Up / Down
        if (key === 'up' || keyCode === 19) {
          if (isLive) {
            if (channelBrowserVisibleRef.current) {
              const next = Math.max(0, currentChannelIndexRef.current - 1);
              currentChannelIndexRef.current = next;
              setCurrentChannelIndex(next);
              try { channelListRef.current?.scrollToIndex({ index: next, animated: false, viewPosition: 0.4 }); } catch {}
            } else {
              const next = Math.max(0, currentChannelIndexRef.current - 1);
              changeChannelRef.current(next);
            }
          }
          showControlsRef.current();
          return;
        }

        if (key === 'down' || keyCode === 20) {
          if (isLive) {
            if (channelBrowserVisibleRef.current) {
              const next = Math.min(allChannels.length - 1, currentChannelIndexRef.current + 1);
              currentChannelIndexRef.current = next;
              setCurrentChannelIndex(next);
              try { channelListRef.current?.scrollToIndex({ index: next, animated: false, viewPosition: 0.4 }); } catch {}
            } else {
              const next = Math.min(allChannels.length - 1, currentChannelIndexRef.current + 1);
              changeChannelRef.current(next);
            }
          }
          showControlsRef.current();
          return;
        }

        // Left = rewind 10s (VOD only)
        if (key === 'left' || keyCode === 21) {
          if (!isLive) {
            seekRef.current(currentTimeRef.current - 10);
          } else {
            showControlsRef.current();
          }
          return;
        }

        // Right = forward 10s (VOD only)
        if (key === 'right' || keyCode === 22) {
          if (!isLive) {
            seekRef.current(currentTimeRef.current + 10);
          } else {
            showControlsRef.current();
          }
          return;
        }

        // Back / menu
        if (key === 'back' || keyCode === 4 || key === 'menu') {
          if (channelBrowserVisibleRef.current) {
            setChannelBrowserVisible(false);
            return;
          }
          try { player.pause(); } catch {}
          router.back();
        }
      });
    } catch {}
    return () => {
      try { tvHandler?.disable(); } catch {}
    };
  }, [isLive, allChannels.length]);

  // ── Seek bar touch handler ─────────────────────────────────────────────
  function handleSeekbarPress(evt: any) {
    if (isLive || duration <= 0) return;
    const { locationX, target } = evt.nativeEvent;
    // Measure the seekbar width via the event
    const barWidth = evt.nativeEvent.layout?.width ?? SCREEN_W - 32;
    const ratio = Math.min(1, Math.max(0, locationX / barWidth));
    seekRef.current(ratio * duration);
  }

  // ── Current EPG program ────────────────────────────────────────────────
  const now = Date.now() / 1000;
  const currentEpg = epgPrograms.find(p => p.start_timestamp <= now && p.stop_timestamp >= now);

  // ── Current channel name ───────────────────────────────────────────────
  const currentChannel = allChannels[currentChannelIndex];
  const displayTitle = isLive
    ? (currentChannel?.name ?? title ?? 'Ao Vivo')
    : (title ?? 'Reproduzindo');

  const progressPct = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* Video */}
      <Pressable style={StyleSheet.absoluteFill} onPress={showControlsNow}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          nativeControls={false}
        />
      </Pressable>

      {/* Buffering spinner */}
      {isBuffering && (
        <View style={styles.bufferingOverlay} pointerEvents="none">
          <View style={styles.bufferingBox}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.bufferingLogo}
              contentFit="contain"
            />
            <MaterialIcons name="autorenew" size={IS_TV ? 32 : 26} color={Colors.primary} />
            <Text style={styles.bufferingText}>Carregando...</Text>
          </View>
        </View>
      )}

      {/* Controls overlay */}
      {showControls && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.controlsOverlay, { opacity: controlsOpacity }]} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(0,0,0,0.75)', 'transparent', 'transparent', 'rgba(0,0,0,0.85)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* Top bar */}
          <View style={[styles.topBar, { paddingTop: Math.max(insets.top, IS_TV ? 16 : 8) }]}>
            <TVFocusable
              style={styles.backBtn}
              focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.3)', borderColor: '#E50000', borderWidth: 2, borderRadius: 8 }}
              onPress={() => { try { player.pause(); } catch {} router.back(); }}
            >
              <Ionicons name="arrow-back" size={IS_TV ? 30 : 24} color="#fff" />
            </TVFocusable>
            <View style={styles.titleBlock}>
              <Text style={styles.titleText} numberOfLines={1}>{displayTitle}</Text>
              {currentEpg ? (
                <Text style={styles.epgText} numberOfLines={1}>
                  {epgTimeLabel(currentEpg.start_timestamp)} – {epgTimeLabel(currentEpg.stop_timestamp)}  {currentEpg.title}
                </Text>
              ) : null}
            </View>
            {isLive && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>AO VIVO</Text>
              </View>
            )}
          </View>

          {/* Center play/pause (touch) */}
          <View style={styles.centerControls} pointerEvents="box-none">
            {!isLive && (
              <View style={styles.centerRow}>
                <TVFocusable
                  style={styles.seekBtn}
                  focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.4)', borderColor: '#E50000', borderWidth: 2, borderRadius: 50 }}
                  onPress={() => seekRef.current(currentTimeRef.current - 10)}
                >
                  <Ionicons name="play-back" size={IS_TV ? 38 : 28} color="#fff" />
                  <Text style={styles.seekLabel}>10s</Text>
                </TVFocusable>

                <TVFocusable
                  style={styles.playPauseBtn}
                  focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.4)', borderColor: '#E50000', borderWidth: 2, borderRadius: 50 }}
                  hasTVPreferredFocus={!isLive}
                  onPress={togglePlay}
                >
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={IS_TV ? 54 : 40}
                    color="#fff"
                  />
                </TVFocusable>

                <TVFocusable
                  style={styles.seekBtn}
                  focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.4)', borderColor: '#E50000', borderWidth: 2, borderRadius: 50 }}
                  onPress={() => seekRef.current(currentTimeRef.current + 10)}
                >
                  <Ionicons name="play-forward" size={IS_TV ? 38 : 28} color="#fff" />
                  <Text style={styles.seekLabel}>10s</Text>
                </TVFocusable>
              </View>
            )}
            {isLive && (
              <TVFocusable
                style={styles.playPauseBtn}
                focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.4)', borderColor: '#E50000', borderWidth: 2, borderRadius: 50 }}
                hasTVPreferredFocus={isLive}
                onPress={openChannelBrowser}
              >
                <Ionicons name="list" size={IS_TV ? 44 : 32} color="#fff" />
              </TVFocusable>
            )}
          </View>

          {/* Bottom bar */}
          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, IS_TV ? 20 : 12) }]}>
            {!isLive && (
              <>
                {/* Progress bar */}
                <Pressable style={styles.seekbarOuter} onPress={handleSeekbarPress}>
                  <View style={styles.seekbarTrack}>
                    <View style={[styles.seekbarFill, { width: `${progressPct * 100}%` }]} />
                    <View style={[styles.seekbarThumb, { left: `${progressPct * 100}%` as any }]} />
                  </View>
                </Pressable>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                  <Text style={styles.timeText}>{formatTime(duration)}</Text>
                </View>
              </>
            )}
            {isLive && (
              <TVFocusable
                style={styles.channelBrowserBtn}
                focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.3)', borderColor: '#E50000', borderWidth: 2, borderRadius: 8 }}
                onPress={openChannelBrowser}
              >
                <Ionicons name="list" size={IS_TV ? 22 : 18} color="#fff" />
                <Text style={styles.channelBrowserBtnText}>Canais</Text>
              </TVFocusable>
            )}
          </View>
        </Animated.View>
      )}

      {/* Channel browser (live) */}
      {isLive && channelBrowserVisible && (
        <View style={styles.channelBrowser}>
          <LinearGradient
            colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.97)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.browserHeader}>
            <Text style={styles.browserTitle}>Canais</Text>
            <TVFocusable
              style={styles.browserCloseBtn}
              focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.3)', borderColor: '#E50000', borderWidth: 2, borderRadius: 6 }}
              onPress={() => setChannelBrowserVisible(false)}
            >
              <Ionicons name="close" size={IS_TV ? 26 : 20} color="#fff" />
            </TVFocusable>
          </View>
          <FlatList
            ref={channelListRef}
            data={allChannels}
            keyExtractor={item => String(item.stream_id)}
            showsVerticalScrollIndicator={false}
            // The browser can contain thousands of streams. Rendering all of
            // them makes D-pad navigation sluggish on Android TV boxes.
            removeClippedSubviews={IS_TV}
            scrollEnabled={!IS_TV}
            windowSize={IS_TV ? 9 : 10}
            initialNumToRender={IS_TV ? 16 : 15}
            maxToRenderPerBatch={IS_TV ? 12 : 15}
            onScrollToIndexFailed={() => {}}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item, index }) => {
              const isActive = index === currentChannelIndex;
              return (
                <TVFocusable
                  style={[styles.browserChannelRow, isActive && styles.browserChannelRowActive]}
                  focusedStyle={{
                    backgroundColor: 'rgba(229,0,0,0.82)',
                    borderColor: '#FF0000',
                    borderWidth: 3,
                    shadowColor: '#FF0000',
                    shadowOpacity: 1,
                    shadowRadius: 14,
                    elevation: 24,
                  }}
                  focusScale={1.02}
                  onFocus={() => {
                    currentChannelIndexRef.current = index;
                    setCurrentChannelIndex(index);
                    try {
                      channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
                    } catch {}
                  }}
                  onPress={() => {
                    changeChannel(index);
                    setChannelBrowserVisible(false);
                  }}
                >
                  {item.stream_icon ? (
                    <Image
                      source={{ uri: item.stream_icon }}
                      style={styles.channelLogo}
                      contentFit="contain"
                      transition={150}
                    />
                  ) : (
                    <View style={[styles.channelLogo, styles.channelLogoPlaceholder]}>
                      <Ionicons name="tv-outline" size={IS_TV ? 22 : 16} color={Colors.textMuted} />
                    </View>
                  )}
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelName, isActive && styles.channelNameActive]} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                  {isActive && (
                    <View style={styles.channelActiveBadge}>
                      <View style={styles.channelActiveDot} />
                    </View>
                  )}
                </TVFocusable>
              );
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bufferingBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    padding: 20,
    gap: 8,
  },
  bufferingLogo: {
    width: IS_TV ? 80 : 60,
    height: IS_TV ? 80 : 60,
    borderRadius: IS_TV ? 20 : 14,
    marginBottom: 4,
  },
  bufferingText: {
    color: '#fff',
    fontSize: IS_TV ? 18 : 14,
    fontWeight: '600',
  },
  controlsOverlay: {
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: IS_TV ? 24 : 14,
    paddingBottom: 10,
    gap: 10,
  },
  backBtn: {
    width: IS_TV ? 52 : 44,
    height: IS_TV ? 52 : 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  titleBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    color: '#fff',
    fontSize: IS_TV ? 22 : 16,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  epgText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: IS_TV ? 14 : 11,
    marginTop: 3,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  liveText: {
    color: '#fff',
    fontSize: IS_TV ? 14 : 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  centerControls: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: IS_TV ? 32 : 20,
  },
  seekBtn: {
    width: IS_TV ? 72 : 56,
    height: IS_TV ? 72 : 56,
    borderRadius: IS_TV ? 36 : 28,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekLabel: {
    color: '#fff',
    fontSize: IS_TV ? 12 : 10,
    fontWeight: '700',
    marginTop: 2,
  },
  playPauseBtn: {
    width: IS_TV ? 90 : 68,
    height: IS_TV ? 90 : 68,
    borderRadius: IS_TV ? 45 : 34,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  bottomBar: {
    paddingHorizontal: IS_TV ? 24 : 14,
    paddingTop: 8,
  },
  seekbarOuter: {
    paddingVertical: 12,
  },
  seekbarTrack: {
    height: IS_TV ? 6 : 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 3,
    overflow: 'visible',
    position: 'relative',
  },
  seekbarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  seekbarThumb: {
    position: 'absolute',
    top: IS_TV ? -5 : -4,
    width: IS_TV ? 16 : 12,
    height: IS_TV ? 16 : 12,
    borderRadius: IS_TV ? 8 : 6,
    backgroundColor: '#fff',
    marginLeft: -(IS_TV ? 8 : 6),
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: IS_TV ? 16 : 12,
    fontWeight: '600',
  },
  channelBrowserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  channelBrowserBtnText: {
    color: '#fff',
    fontSize: IS_TV ? 16 : 13,
    fontWeight: '600',
  },
  // Channel browser
  channelBrowser: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: IS_TV ? Math.min(360, SCREEN_W * 0.35) : Math.min(280, SCREEN_W * 0.55),
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(229,0,0,0.15)',
  },
  browserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: IS_TV ? 16 : 12,
    paddingVertical: IS_TV ? 16 : 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  browserTitle: {
    color: '#fff',
    fontSize: IS_TV ? 20 : 15,
    fontWeight: '700',
  },
  browserCloseBtn: {
    width: IS_TV ? 40 : 32,
    height: IS_TV ? 40 : 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  browserChannelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: IS_TV ? 14 : 10,
    paddingVertical: IS_TV ? 12 : 8,
    marginHorizontal: IS_TV ? 6 : 4,
    marginVertical: IS_TV ? 3 : 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 10,
  },
  browserChannelRowActive: {
    backgroundColor: 'rgba(229,0,0,0.12)',
    borderColor: 'rgba(229,0,0,0.3)',
  },
  channelLogo: {
    width: IS_TV ? 44 : 36,
    height: IS_TV ? 44 : 36,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  channelLogoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: {
    flex: 1,
  },
  channelName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: IS_TV ? 16 : 13,
    fontWeight: '500',
  },
  channelNameActive: {
    color: '#fff',
    fontWeight: '700',
  },
  channelActiveBadge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
});
