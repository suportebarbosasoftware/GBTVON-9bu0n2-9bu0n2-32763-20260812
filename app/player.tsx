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
  AppState,
  BackHandler,
  DeviceEventEmitter,
  NativeModules,
  FlatList,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { getLiveStreamUrl, getLiveStreams, getShortEpg, EpgProgram, epgTimeLabel } from '@/services/xtreamApi';
import { saveProgress, addToHistory, getProgress } from '@/services/favoritesService';
import { IS_TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import { Colors } from '@/constants/theme';
import { groupChannels } from '@/services/channelGrouper';
import { loadFilterState } from '@/services/channelFilterService';
import { getSelectedChannelKeys, isSetupDone, makeChannelKey } from '@/services/channelSetupService';
import { applyChannelNumbers, buildChannelNumbers, loadChannelNumbers } from '@/services/channelNumberService';

const { width: SCREEN_W } = Dimensions.get('window');
const tvDeviceInfo = NativeModules.TVDeviceInfo;

/** One item for each channel the user placed in their personal channel list. */
interface PlaybackChannel {
  streamId: number;
  streamIds: number[];
  qualities: { label: string; streamId: number }[];
  name: string;
  icon: string;
  channelNumber: number;
}

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

  // Stable refs keep remote actions aligned with the latest playback state.
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(true);
  const seekRef = useRef<(t: number) => void>(() => {});
  const togglePlayRef = useRef<() => void>(() => {});
  const showControlsRef = useRef<() => void>(() => {});
  const savePlaybackProgressRef = useRef<() => void>(() => {});
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
        durationRef.current = dur;
      } catch {}
    }, 500);
    return () => clearInterval(interval);
  }, [player]);

  // Restore a movie/episode from either the route or the persisted position.
  // Waiting for a real duration prevents seeking before expo-video is ready.
  useEffect(() => {
    if (isLive) return;
    let cancelled = false;
    let attempts = 0;
    let resumeTimer: ReturnType<typeof setInterval> | null = null;

    const restore = async () => {
      const routePosition = Number.parseFloat(resumePosition ?? '') || 0;
      const saved = contentId ? await getProgress(contentId) : null;
      const target = Math.max(routePosition, saved?.position ?? 0);
      if (cancelled || target <= 5) return;

      resumeTimer = setInterval(() => {
        attempts += 1;
        const video = player as any;
        const videoDuration = Number(video.duration) || durationRef.current;
        if (videoDuration <= 0 && attempts < 80) return;

        const position = videoDuration > 0 ? Math.min(target, Math.max(0, videoDuration - 1)) : target;
        try {
          video.currentTime = position;
          currentTimeRef.current = position;
          setCurrentTime(position);
        } catch {
          try { video.seekBy(position - currentTimeRef.current); } catch {}
        }
        if (resumeTimer) clearInterval(resumeTimer);
      }, 250);
    };

    void restore();
    return () => {
      cancelled = true;
      if (resumeTimer) clearInterval(resumeTimer);
    };
  }, [player, isLive, contentId, resumePosition]);

  // ── Seek & play/pause ──────────────────────────────────────────────────
  function seekTo(t: number) {
    try {
      const clamp = Math.max(0, duration > 0 ? Math.min(t, duration - 1) : t);
      const video = player as any;
      // Assigning the absolute time is reliable even after several rapid
      // D-pad presses; seekBy alone can queue stale relative seeks.
      video.currentTime = clamp;
      currentTimeRef.current = clamp;
      setCurrentTime(clamp);
    } catch {
      try { player.seekBy(t - currentTimeRef.current); } catch {}
    }
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
  const savePlaybackProgress = useCallback(() => {
    if (isLive || !contentId) return;
    let position = currentTimeRef.current;
    let totalDuration = durationRef.current;
    try {
      const video = player as any;
      position = Number(video.currentTime) || position;
      totalDuration = Number(video.duration) || totalDuration;
    } catch {}
    if (position <= 5) return;

    void saveProgress({
      id: contentId,
      type: type === 'episode' ? 'episode' : 'movie',
      position,
      duration: totalDuration,
      updatedAt: Date.now(),
      seriesId,
      seriesName,
      title,
      poster,
    });
  }, [player, contentId, isLive, poster, seriesId, seriesName, title, type]);

  useEffect(() => {
    savePlaybackProgressRef.current = savePlaybackProgress;
  }, [savePlaybackProgress]);

  useEffect(() => {
    if (isLive || !contentId) return;
    const interval = setInterval(savePlaybackProgress, 5000);
    return () => clearInterval(interval);
  }, [contentId, isLive, savePlaybackProgress]);

  // Persist immediately when Android backgrounds the app instead of waiting
  // for the periodic timer.
  useEffect(() => {
    if (isLive) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') savePlaybackProgressRef.current();
    });
    return () => subscription.remove();
  }, [isLive]);

  // Add to history when leaving
  useEffect(() => {
    return () => {
      savePlaybackProgressRef.current();
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
  const [allChannels, setAllChannels] = useState<PlaybackChannel[]>([]);
  const [currentChannelIndex, setCurrentChannelIndex] = useState(0);
  const [browserChannelIndex, setBrowserChannelIndex] = useState(0);
  const [activeQualityStreamId, setActiveQualityStreamId] = useState<number | null>(null);
  const [qualityPanelVisible, setQualityPanelVisible] = useState(false);
  const channelListRef = useRef<FlatList>(null);
  const browserChannelItemRefs = useRef<Record<number, any>>({});
  const channelBrowserVisibleRef = useRef(false);
  const currentChannelIndexRef = useRef(0);
  const browserChannelIndexRef = useRef(0);
  const channelChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityPanelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityPanelVisibleRef = useRef(false);
  const channelChangeGenerationRef = useRef(0);
  const changeChannelRef = useRef<(idx: number) => void>(() => {});
  const changeQualityRef = useRef<(direction: -1 | 1) => void>(() => {});
  const showQualityPanelRef = useRef<() => void>(() => {});
  const openChannelBrowserRef = useRef<() => void>(() => {});

  useEffect(() => {
    channelBrowserVisibleRef.current = channelBrowserVisible;
  }, [channelBrowserVisible]);

  useEffect(() => {
    currentChannelIndexRef.current = currentChannelIndex;
  }, [currentChannelIndex]);

  function selectBrowserChannel(index: number) {
    const safeIndex = Math.max(0, Math.min(allChannels.length - 1, index));
    browserChannelIndexRef.current = safeIndex;
    setBrowserChannelIndex(safeIndex);
  }

  useEffect(() => {
    if (!isLive || !auth) return;
    let cancelled = false;

    // The player must navigate the exact same numbered, mounted channel list
    // as the Live TV screen. Using the raw Xtream list here caused the quick
    // menu and Up/Down to expose channels the user had not selected.
    const loadMountedChannels = async () => {
      try {
        const [streams, filters, setupDone, selectedKeys, savedNumbers] = await Promise.all([
          getLiveStreams(auth),
          loadFilterState(),
          isSetupDone(),
          getSelectedChannelKeys(),
          loadChannelNumbers(),
        ]);
        if (cancelled) return;

        const visibleChannels = groupChannels(streams).filter(channel =>
          !filters.hiddenChannels.includes(makeChannelKey(channel.baseName, channel.categoryId))
        );
        const mountedChannels = setupDone && selectedKeys.size > 0
          ? visibleChannels.filter(channel => selectedKeys.has(makeChannelKey(channel.baseName, channel.categoryId)))
          : visibleChannels;

        // Keep the same persistent ordering/numbering used by the main Live
        // TV screen, including when this is the first player launch.
        const numbers = savedNumbers.size === 0 || savedNumbers.size !== mountedChannels.length
          ? await buildChannelNumbers(mountedChannels)
          : savedNumbers;
        if (cancelled) return;

        const channels = applyChannelNumbers(mountedChannels, numbers)
          .sort((a, b) => a.channelNumber - b.channelNumber)
          .map(channel => ({
            streamId: channel.primaryStreamId,
            streamIds: channel.qualities.map(quality => quality.streamId),
            qualities: channel.qualities.map(quality => ({ label: quality.label, streamId: quality.streamId })),
            name: channel.baseName,
            icon: channel.icon,
            channelNumber: channel.channelNumber,
          }));
        setAllChannels(channels);

        // The launch screen sends a stream id, which can be any quality of a
        // grouped channel. Match all qualities before falling back to title.
        let idx = channels.findIndex(channel =>
          channel.streamIds.some(streamId => String(streamId) === String(contentId ?? ''))
        );
        if (idx < 0) idx = channels.findIndex(channel => getLiveStreamUrl(auth, channel.streamId) === url);
        if (idx < 0 && title) idx = channels.findIndex(channel => channel.name === title);
        if (idx >= 0) {
          setCurrentChannelIndex(idx);
          currentChannelIndexRef.current = idx;
          browserChannelIndexRef.current = idx;
          setBrowserChannelIndex(idx);
          const selected = channels[idx].qualities.find(quality =>
            String(quality.streamId) === String(contentId ?? '')
          );
          setActiveQualityStreamId(selected?.streamId ?? channels[idx].streamId);
        } else if (channels[0]) {
          setActiveQualityStreamId(channels[0].streamId);
        }
      } catch {
        // Playback can continue with the route's original stream if the
        // supplemental channel list cannot be loaded.
      }
    };

    void loadMountedChannels();
    return () => { cancelled = true; };
  }, [isLive, auth, contentId, title, url]);

  function replaceLiveStream(streamId: number, delay: number) {
    if (!auth) return;
    const changeGeneration = ++channelChangeGenerationRef.current;
    setIsBuffering(true);
    if (channelChangeTimerRef.current) clearTimeout(channelChangeTimerRef.current);
    channelChangeTimerRef.current = setTimeout(() => {
      if (changeGeneration !== channelChangeGenerationRef.current) return;
      // Releasing the old source before attaching the next one prevents two
      // streams from continuing at once on Android TV hardware.
      try { player.pause(); } catch {}
      try { player.replace(null); } catch {}
      try {
        player.replace({ uri: getLiveStreamUrl(auth, streamId) });
        player.play();
      } catch {}
    }, delay);
  }

  function changeChannel(idx: number) {
    if (!auth || !allChannels[idx]) return;
    const channel = allChannels[idx];
    setCurrentChannelIndex(idx);
    currentChannelIndexRef.current = idx;
    browserChannelIndexRef.current = idx;
    setBrowserChannelIndex(idx);
    // A held D-pad key can emit several events quickly. Keep navigation
    // immediate, but replace the video source only once for the final channel.
    setActiveQualityStreamId(channel.streamId);
    replaceLiveStream(channel.streamId, IS_TV ? 120 : 0);

    try {
      channelListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.4 });
    } catch {}
  }

  function openChannelBrowser() {
    hideQualityPanel();
    selectBrowserChannel(currentChannelIndexRef.current);
    channelBrowserVisibleRef.current = true;
    setChannelBrowserVisible(true);
    showControlsNow();
  }

  function closeChannelBrowser() {
    channelBrowserVisibleRef.current = false;
    setChannelBrowserVisible(false);
  }

  function showQualityPanel() {
    const channel = allChannels[currentChannelIndexRef.current];
    if (!channel || channel.qualities.length < 2) return;
    if (qualityPanelTimerRef.current) clearTimeout(qualityPanelTimerRef.current);
    qualityPanelVisibleRef.current = true;
    setQualityPanelVisible(true);
    qualityPanelTimerRef.current = setTimeout(() => hideQualityPanel(), 5000);
  }

  function hideQualityPanel() {
    if (qualityPanelTimerRef.current) clearTimeout(qualityPanelTimerRef.current);
    qualityPanelVisibleRef.current = false;
    setQualityPanelVisible(false);
  }

  function selectQuality(streamId: number) {
    const channel = allChannels[currentChannelIndexRef.current];
    if (!channel || streamId === activeQualityStreamId) {
      showQualityPanel();
      return;
    }
    setActiveQualityStreamId(streamId);
    replaceLiveStream(streamId, 0);
    showQualityPanel();
  }

  function changeQuality(direction: -1 | 1) {
    const channel = allChannels[currentChannelIndexRef.current];
    if (!channel || channel.qualities.length < 2) return;
    const currentIndex = Math.max(0, channel.qualities.findIndex(quality => quality.streamId === activeQualityStreamId));
    const nextIndex = Math.max(0, Math.min(channel.qualities.length - 1, currentIndex + direction));
    selectQuality(channel.qualities[nextIndex].streamId);
  }

  useEffect(() => {
    changeChannelRef.current = changeChannel;
    openChannelBrowserRef.current = openChannelBrowser;
    changeQualityRef.current = changeQuality;
    showQualityPanelRef.current = showQualityPanel;
  });

  useEffect(() => () => {
    if (channelChangeTimerRef.current) clearTimeout(channelChangeTimerRef.current);
    if (qualityPanelTimerRef.current) clearTimeout(qualityPanelTimerRef.current);
  }, []);

  // The quick channel list must open around the channel already playing,
  // never at the top of a potentially thousands-long list.
  useEffect(() => {
    if (!isLive || !channelBrowserVisible || allChannels.length === 0) return;
    const index = Math.max(0, Math.min(allChannels.length - 1, browserChannelIndex));
    const scrollToCurrent = () => {
      try { channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 }); } catch {}
      // Moving native focus off the transparent video surface makes the blue
      // indicator frame the selected channel row, never the whole player.
      setTimeout(() => {
        try { browserChannelItemRefs.current[index]?.focus?.(); } catch {}
      }, 80);
    };
    const timer = setTimeout(scrollToCurrent, 0);
    return () => clearTimeout(timer);
  }, [isLive, channelBrowserVisible, allChannels.length, browserChannelIndex]);

  // Playback itself never gets a large focus border. The one native focus
  // indicator appears only on the selectable rows of the quick channel menu.
  useEffect(() => {
    if (!IS_TV) return;
    try { tvDeviceInfo?.setFocusIndicatorEnabled(channelBrowserVisible); } catch {}
    return () => {
      try { tvDeviceInfo?.setFocusIndicatorEnabled(true); } catch {}
    };
  }, [isLive, channelBrowserVisible]);

  // A phone must stay awake for the whole playback session. It is restored
  // automatically when the player screen is closed.
  useEffect(() => {
    if (IS_TV) return;
    try { tvDeviceInfo?.setKeepScreenOn(true); } catch {}
    return () => {
      try { tvDeviceInfo?.setKeepScreenOn(false); } catch {}
    };
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
      getShortEpg(auth, stream.streamId, 3).then(progs => {
        if (epgRequestIdRef.current === requestId) setEpgPrograms(progs);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [currentChannelIndex, isLive, auth, allChannels]);

  // ── Back button ────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (channelBrowserVisibleRef.current) {
        closeChannelBrowser();
        return true;
      }
      savePlaybackProgressRef.current();
      try { player.pause(); } catch {}
      router.back();
      return true;
    });
    return () => sub.remove();
  }, []);

  // ── TV remote handler ──────────────────────────────────────────────────
  // During normal playback the Activity sends keys directly to this screen,
  // so Up/Down can change a live channel and Left/Right can seek VOD. When
  // the channel browser is open we deliberately return control to Android's
  // native focus system, which can scroll the FlatList without a limit.
  useEffect(() => {
    if (!IS_TV) return;
    const subscription = DeviceEventEmitter.addListener('GBTVRemoteKey', (rawKeyCode: number) => {
      const keyCode = Number(rawKeyCode);
      if (keyCode === 23 || keyCode === 66 || keyCode === 96 || keyCode === 85) {
        if (isLive) openChannelBrowserRef.current();
        else togglePlayRef.current();
        return;
      }

      if (keyCode === 19 && isLive) {
        changeChannelRef.current(Math.max(0, currentChannelIndexRef.current - 1));
        return;
      }

      if (keyCode === 20 && isLive) {
        changeChannelRef.current(Math.min(allChannels.length - 1, currentChannelIndexRef.current + 1));
        return;
      }

      // Live TV uses Left/Right for quality selection. The first press opens
      // the right-side panel; subsequent presses choose a lower/higher stream.
      if (keyCode === 21 && isLive) {
        if (qualityPanelVisibleRef.current) changeQualityRef.current(-1);
        else showQualityPanelRef.current();
        return;
      }

      if (keyCode === 22 && isLive) {
        if (qualityPanelVisibleRef.current) changeQualityRef.current(1);
        else showQualityPanelRef.current();
        return;
      }

      if (keyCode === 21 && !isLive) {
        seekRef.current(currentTimeRef.current - 10);
        return;
      }

      if (keyCode === 22 && !isLive) {
        seekRef.current(currentTimeRef.current + 10);
      }
    });

    return () => subscription.remove();
  }, [isLive, allChannels.length]);

  // Native focus owns the open channel list so its ScrollView can render and
  // reach every item. Playback owns the remote keys for direct channel/seek.
  useEffect(() => {
    if (!IS_TV) return;
    try { tvDeviceInfo?.setPlayerRemoteKeysEnabled(!channelBrowserVisible); } catch {}
    return () => {
      try { tvDeviceInfo?.setPlayerRemoteKeysEnabled(false); } catch {}
    };
  }, [channelBrowserVisible]);

  // ── Seek bar touch handler ─────────────────────────────────────────────
  function handleSeekbarPress(evt: any) {
    if (isLive || duration <= 0) return;
    const { locationX } = evt.nativeEvent;
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
      <Pressable
        style={StyleSheet.absoluteFill}
        // On TV this surface must never keep native focus: otherwise it
        // consumes the remote and prevents the real playback controls from
        // receiving D-pad navigation.
        focusable={!IS_TV || (isLive && !channelBrowserVisible)}
        onPress={() => {
          // With live controls hidden, this is the TV's invisible OK target.
          // It opens the channel list directly without restoring the former
          // center-screen button or drawing a focus frame over the video.
          if (IS_TV && isLive) {
            openChannelBrowser();
            return;
          }
          showControlsNow();
        }}
      >
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
              onPress={() => {
                savePlaybackProgressRef.current();
                try { player.pause(); } catch {}
                router.back();
              }}
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
            {isLive && !IS_TV && (
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
                hasTVPreferredFocus={IS_TV}
                disabled={IS_TV && channelBrowserVisible}
                onPress={openChannelBrowser}
              >
                <Ionicons name="list" size={IS_TV ? 22 : 18} color="#fff" />
                <Text style={styles.channelBrowserBtnText}>Canais</Text>
              </TVFocusable>
            )}
          </View>
        </Animated.View>
      )}

      {/* Live quality selector: it uses only the variants supplied for the
          current mounted channel and never leaves the player screen. */}
      {isLive && !channelBrowserVisible && qualityPanelVisible && currentChannel && currentChannel.qualities.length > 1 && (
        <View style={styles.qualityPanel}>
          <Text style={styles.qualityPanelTitle}>Qualidade</Text>
          <Text style={styles.qualityPanelHint}>Use ← → para trocar</Text>
          <View style={styles.qualityOptions}>
            {currentChannel.qualities.map(quality => {
              const active = quality.streamId === activeQualityStreamId;
              return (
                <Pressable
                  key={String(quality.streamId)}
                  focusable={!IS_TV}
                  onPress={() => selectQuality(quality.streamId)}
                  style={[styles.qualityOption, active && styles.qualityOptionActive]}
                >
                  <Text style={[styles.qualityOptionText, active && styles.qualityOptionTextActive]}>
                    {quality.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
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
              onPress={closeChannelBrowser}
            >
              <Ionicons name="close" size={IS_TV ? 26 : 20} color="#fff" />
            </TVFocusable>
          </View>
          <FlatList
            ref={channelListRef}
            data={allChannels}
            keyExtractor={item => String(item.streamId)}
            showsVerticalScrollIndicator={false}
            // The browser can contain thousands of streams. Rendering all of
            // them makes D-pad navigation sluggish on Android TV boxes.
            removeClippedSubviews={IS_TV}
            scrollEnabled
            initialScrollIndex={Math.max(0, Math.min(allChannels.length - 1, browserChannelIndex))}
            getItemLayout={(_, index) => ({
              length: IS_TV ? 74 : 56,
              offset: 8 + (IS_TV ? 74 : 56) * index,
              index,
            })}
            windowSize={IS_TV ? 9 : 10}
            initialNumToRender={IS_TV ? 16 : 15}
            maxToRenderPerBatch={IS_TV ? 12 : 15}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                const index = Math.max(0, Math.min(allChannels.length - 1, browserChannelIndexRef.current));
                channelListRef.current?.scrollToOffset({ offset: info.averageItemLength * index, animated: false });
              }, 40);
            }}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item, index }) => {
              const isActive = index === currentChannelIndex;
              return (
                <TVFocusable
                  ref={(node: any) => {
                    if (node) browserChannelItemRefs.current[index] = node;
                    else delete browserChannelItemRefs.current[index];
                  }}
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
                  hasTVPreferredFocus={IS_TV && index === browserChannelIndex}
                  onFocus={() => {
                    selectBrowserChannel(index);
                    try {
                      channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
                    } catch {}
                  }}
                  onPress={() => {
                    changeChannel(index);
                    closeChannelBrowser();
                  }}
                >
                  {item.icon ? (
                    <Image
                      source={{ uri: item.icon }}
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
  qualityPanel: {
    position: 'absolute',
    right: IS_TV ? 28 : 14,
    top: IS_TV ? 86 : 64,
    minWidth: IS_TV ? 250 : 190,
    padding: IS_TV ? 16 : 12,
    borderRadius: 12,
    backgroundColor: 'rgba(5, 14, 25, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(46, 168, 255, 0.72)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 18,
  },
  qualityPanelTitle: {
    color: '#fff',
    fontSize: IS_TV ? 18 : 15,
    fontWeight: '800',
  },
  qualityPanelHint: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.68)',
    fontSize: IS_TV ? 13 : 11,
  },
  qualityOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: IS_TV ? 14 : 10,
  },
  qualityOption: {
    minWidth: IS_TV ? 56 : 46,
    alignItems: 'center',
    borderRadius: 7,
    paddingHorizontal: IS_TV ? 12 : 9,
    paddingVertical: IS_TV ? 8 : 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  qualityOptionActive: {
    backgroundColor: '#1677C8',
    borderColor: '#65C5FF',
  },
  qualityOptionText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: IS_TV ? 15 : 12,
    fontWeight: '800',
  },
  qualityOptionTextActive: {
    color: '#fff',
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
