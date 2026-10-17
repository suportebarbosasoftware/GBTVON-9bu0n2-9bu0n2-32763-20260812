/** LG webOS player: the remote controls live TV instead of pausing it. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { EpgProgram, epgTimeLabel, getLiveCategories, getLiveStreamUrl, getLiveStreams, getShortEpg } from '@/services/xtreamApi';
import { groupChannels } from '@/services/channelGrouper';
import { addToHistory, getProgress, saveProgress } from '@/services/favoritesService';
import { getSelectedChannelKeys, makeChannelKey } from '@/services/channelSetupService';
import { isAdultCategory } from '@/services/channelFilterService';
import { saveLastLiveChannel } from '@/services/lastLiveChannelService';
import { DEMO_LIVE_STREAMS, getDemoLiveUrl } from '@/services/demoCatalog';
import { updateCurrentContent } from '@/services/adminApiService';
import { getDeviceId } from '@/services/deviceIdService';

type Quality = { label: string; streamId: number; url?: string };
type Channel = { name: string; streamId: number; qualities: Quality[]; channelNumber: number; isAdult: boolean };
type NextEpisode = { id: string; url: string; title: string; poster?: string };
const MENU_SIZE = 11;

function parseQualities(raw?: string): Quality[] {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(item => item?.label && item?.streamId) : [];
  } catch { return []; }
}

function parseNextEpisodes(raw?: string): NextEpisode[] {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(item => item?.id && item?.url) : [];
  } catch { return []; }
}

function remoteKey(event: KeyboardEvent) {
  if (/^[0-9]$/.test(event.key)) return `digit:${event.key}`;
  if (event.keyCode >= 48 && event.keyCode <= 57) return `digit:${event.keyCode - 48}`;
  if (event.keyCode >= 96 && event.keyCode <= 105) return `digit:${event.keyCode - 96}`;
  if (event.key === 'ArrowUp' || event.keyCode === 38) return 'up';
  if (event.key === 'ArrowDown' || event.keyCode === 40) return 'down';
  if (event.key === 'ArrowLeft' || event.keyCode === 37) return 'left';
  if (event.key === 'ArrowRight' || event.keyCode === 39) return 'right';
  if (event.key === 'Enter' || event.keyCode === 13) return 'ok';
  if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'Backspace' || event.keyCode === 461) return 'back';
  return '';
}

function mediaType(source: string): string {
  const extension = source.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'm3u8') return 'application/vnd.apple.mpegurl';
  if (extension === 'ts') return 'video/mp2t';
  if (extension === 'mkv') return 'video/x-matroska';
  if (extension === 'webm') return 'video/webm';
  return 'video/mp4';
}

function playbackErrorMessage(code?: number) {
  if (code === 2) return 'A TV não conseguiu acessar o vídeo no servidor.';
  if (code === 3) return 'O formato de áudio ou vídeo deste conteúdo não é compatível com esta TV.';
  if (code === 4) return 'Formato de vídeo não suportado por esta TV.';
  return 'Não foi possível reproduzir este conteúdo nesta TV.';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function webOSVodSource(source: string): string {
  // The provider's MP4 VOD tracks contain codecs that this webOS model cannot
  // decode. Its equivalent Xtream .ts endpoint uses a TV-compatible stream.
  // Keep third-party direct sources untouched because their extension is not
  // an Xtream endpoint contract.
  if (!/\/(?:movie|series)\//i.test(source)) return source;
  return source.replace(/\.(?:mp4|mkv|avi|mov)(?=(?:\?|$))/i, '.ts');
}

export default function PlayerScreen() {
  const router = useRouter();
  const { auth, isDemoMode, macAddress } = useAuth();
  const { url, title, type, contentId, qualitiesJson, poster, seriesId, seriesName, resumePosition, nextEpisodesJson } = useLocalSearchParams<{
    url?: string; title?: string; type?: string; contentId?: string; qualitiesJson?: string;
    poster?: string; seriesId?: string; seriesName?: string; resumePosition?: string; nextEpisodesJson?: string;
  }>();
  const isLive = type === 'live';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qualityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelIndex, setChannelIndex] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [qualityId, setQualityId] = useState(Number(contentId) || 0);
  const [liveUrl, setLiveUrl] = useState(url || '');
  const [qualityOpen, setQualityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [epgOpen, setEpgOpen] = useState(false);
  const [programs, setPrograms] = useState<EpgProgram[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [vodControlsOpen, setVodControlsOpen] = useState(false);
  const [channelTagVisible, setChannelTagVisible] = useState(true);
  const [channelNumberInput, setChannelNumberInput] = useState('');
  const resumeTargetRef = useRef(0);
  const saveProgressRef = useRef<(completed?: boolean) => void>(() => {});
  const vodControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelTagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelNumberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelNumberRef = useRef('');
  const contentReportTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reportMacAddressRef = useRef<string | null>(null);
  const routeQualities = useMemo(() => parseQualities(qualitiesJson), [qualitiesJson]);
  const nextEpisodes = useMemo(() => parseNextEpisodes(nextEpisodesJson), [nextEpisodesJson]);
  const currentChannel = channels[channelIndex];
  const qualities = currentChannel?.qualities.length ? currentChannel.qualities : routeQualities;
  const source = isLive ? liveUrl : webOSVodSource(url || '');
  const displayTitle = isLive ? (currentChannel?.name || title || 'Ao vivo') : (title || 'Reproduzindo');

  const hideVodControls = useCallback(() => {
    if (vodControlsTimer.current) clearTimeout(vodControlsTimer.current);
    setVodControlsOpen(false);
  }, []);
  const showVodControls = useCallback(() => {
    if (isLive) return;
    if (vodControlsTimer.current) clearTimeout(vodControlsTimer.current);
    setVodControlsOpen(true);
    vodControlsTimer.current = setTimeout(() => setVodControlsOpen(false), 6000);
  }, [isLive]);
  const showChannelTag = useCallback(() => {
    if (!isLive) return;
    if (channelTagTimer.current) clearTimeout(channelTagTimer.current);
    setChannelTagVisible(true);
    channelTagTimer.current = setTimeout(() => setChannelTagVisible(false), 4200);
  }, [isLive]);

  const restorePosition = useCallback(() => {
    const video = videoRef.current;
    const target = resumeTargetRef.current;
    if (!video || target <= 5 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const position = Math.min(target, Math.max(0, video.duration - 4));
    video.currentTime = position;
    setCurrentTime(position);
    resumeTargetRef.current = 0;
  }, []);

  const savePlaybackProgress = useCallback((completed = false) => {
    if (isLive || !contentId) return;
    const video = videoRef.current;
    const totalDuration = Number(video?.duration) || duration;
    const position = completed ? totalDuration : (Number(video?.currentTime) || currentTime);
    if (position <= 5 || totalDuration <= 0) return;
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
  }, [contentId, currentTime, duration, isLive, poster, seriesId, seriesName, title, type]);

  useEffect(() => { saveProgressRef.current = savePlaybackProgress; }, [savePlaybackProgress]);

  const clearQuality = useCallback(() => {
    if (qualityTimer.current) clearTimeout(qualityTimer.current);
    setQualityOpen(false);
  }, []);
  const clearEpg = useCallback(() => {
    if (epgTimer.current) clearTimeout(epgTimer.current);
    setEpgOpen(false);
  }, []);
  const showQuality = useCallback(() => {
    if (!isLive || qualities.length < 2) return;
    clearEpg();
    if (qualityTimer.current) clearTimeout(qualityTimer.current);
    setQualityOpen(true);
    qualityTimer.current = setTimeout(() => setQualityOpen(false), 6000);
  }, [clearEpg, isLive, qualities.length]);
  const showEpg = useCallback(() => {
    if (!isLive) return;
    clearQuality();
    if (epgTimer.current) clearTimeout(epgTimer.current);
    setEpgOpen(true);
    epgTimer.current = setTimeout(() => setEpgOpen(false), 7000);
  }, [clearQuality, isLive]);

  useEffect(() => {
    if (!isLive) return;
    let disposed = false;
    if (isDemoMode) {
      const grouped: Channel[] = groupChannels(DEMO_LIVE_STREAMS).map((item, index) => ({
        name: item.baseName,
        streamId: item.primaryStreamId,
        qualities: item.qualities.map(quality => ({ label: quality.label, streamId: quality.streamId, url: quality.streamUrl })),
        channelNumber: index + 1,
        isAdult: false,
      }));
      setChannels(grouped);
      const initial = Math.max(0, grouped.findIndex(channel => String(channel.streamId) === String(contentId)));
      const channel = grouped[initial];
      if (channel) {
        setChannelIndex(initial); setMenuIndex(initial); setQualityId(channel.streamId);
      }
      return () => { disposed = true; };
    }
    if (!auth) return;
    void Promise.all([getLiveStreams(auth), getLiveCategories(auth), getSelectedChannelKeys()]).then(([streams, categories, selectedKeys]) => {
      if (disposed) return;
      const chosen = groupChannels(streams).filter(item => selectedKeys.has(makeChannelKey(item.baseName, item.categoryId)));
      const grouped: Channel[] = chosen.map((item, index) => ({
        name: item.baseName,
        streamId: item.primaryStreamId,
        qualities: item.qualities.map(quality => ({ label: quality.label, streamId: quality.streamId })),
        channelNumber: index + 1,
        isAdult: isAdultCategory(categories.find(category => category.category_id === item.categoryId)?.category_name || ''),
      }));
      setChannels(grouped);
      const found = grouped.findIndex(channel => channel.name === title || channel.qualities.some(quality => String(quality.streamId) === String(contentId)));
      const initial = found >= 0 ? found : 0;
      const channel = grouped[initial];
      if (!channel) return;
      setChannelIndex(initial); setMenuIndex(initial);
      setQualityId(channel.qualities.find(quality => String(quality.streamId) === String(contentId))?.streamId ?? channel.streamId);
    });
    return () => { disposed = true; };
  }, [auth, contentId, isDemoMode, isLive, title]);

  useEffect(() => {
    if (!isLive || !auth || isDemoMode || !currentChannel) return;
    let disposed = false;
    void getShortEpg(auth, currentChannel.streamId, 3).then(items => { if (!disposed) setPrograms(items); });
    return () => { disposed = true; };
  }, [auth, currentChannel?.streamId, isDemoMode, isLive]);

  useEffect(() => {
    if (!isLive || !currentChannel) return;
    void saveLastLiveChannel({ streamId: currentChannel.streamId, title: currentChannel.name, isAdult: currentChannel.isAdult });
  }, [currentChannel?.streamId, currentChannel?.isAdult, currentChannel?.name, isLive]);

  useEffect(() => {
    if (isLive && currentChannel) showChannelTag();
  }, [currentChannel?.streamId, isLive, showChannelTag]);

  // webOS uses this web-specific player, so it must report its playback here
  // instead of relying on the native player implementation. The panel uses
  // this heartbeat both for the online count and for "assistindo agora".
  useEffect(() => {
    if (isDemoMode) return;
    const contentType = isLive ? 'live' : type === 'episode' ? 'series' : 'movie';
    let cancelled = false;

    const report = (mac: string) => {
      // This is deliberately fire-and-forget: a temporary panel outage must
      // never slow the LG remote or interrupt video playback.
      void updateCurrentContent(mac, displayTitle, contentType);
    };

    const startReporting = async () => {
      const mac = macAddress || await getDeviceId();
      if (cancelled || !mac) return;
      reportMacAddressRef.current = mac;
      report(mac);
      contentReportTimer.current = setInterval(() => report(mac), 2 * 60 * 1000);
    };

    void startReporting();
    return () => {
      cancelled = true;
      if (contentReportTimer.current) {
        clearInterval(contentReportTimer.current);
        contentReportTimer.current = null;
      }
    };
  }, [currentChannel?.streamId, displayTitle, isDemoMode, isLive, macAddress, type]);

  // Clear the watching entry only when this player really closes. Changing a
  // live channel recreates its source but must not make the viewer disappear
  // from the panel between channels.
  useEffect(() => () => {
    if (contentReportTimer.current) clearInterval(contentReportTimer.current);
    if (reportMacAddressRef.current) {
      void updateCurrentContent(reportMacAddressRef.current, null, null);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    setCurrentTime(0); setDuration(0); resumeTargetRef.current = 0;
    video.load();
    void video.play().catch(() => {});
  }, [source]);

  // Restore both movie and episode progress. The stored position is applied
  // only after metadata arrives, which webOS requires before seeking.
  useEffect(() => {
    if (isLive || !contentId) return;
    let cancelled = false;
    void getProgress(contentId).then(saved => {
      if (cancelled) return;
      resumeTargetRef.current = Math.max(Number(resumePosition) || 0, saved?.position || 0);
      restorePosition();
    });
    return () => { cancelled = true; };
  }, [contentId, isLive, resumePosition, restorePosition]);

  useEffect(() => {
    if (isLive || !contentId) return;
    const timer = setInterval(() => saveProgressRef.current(), 5000);
    return () => clearInterval(timer);
  }, [contentId, isLive]);

  useEffect(() => () => {
    saveProgressRef.current();
    if (!isLive && contentId) {
      void addToHistory({
        id: contentId,
        type: type === 'episode' ? 'episode' : 'movie',
        name: title || 'Desconhecido',
        poster: poster || '',
        seriesId,
        seriesName,
      });
    }
  }, [contentId, isLive, poster, seriesId, seriesName, title, type]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = () => {
      const mediaError = video.error;
      console.error('[webOS player] media error', {
        code: mediaError?.code,
        message: mediaError?.message,
        source,
        networkState: video.networkState,
      });
      setLoading(false);
      setError(playbackErrorMessage(mediaError?.code));
    };
    video.addEventListener('error', onError);
    return () => video.removeEventListener('error', onError);
  }, [source]);

  useEffect(() => () => {
    if (qualityTimer.current) clearTimeout(qualityTimer.current);
    if (epgTimer.current) clearTimeout(epgTimer.current);
    if (vodControlsTimer.current) clearTimeout(vodControlsTimer.current);
    if (channelTagTimer.current) clearTimeout(channelTagTimer.current);
    if (channelNumberTimer.current) clearTimeout(channelNumberTimer.current);
  }, []);

  const changeChannel = useCallback((requested: number) => {
    if ((!auth && !isDemoMode) || !channels.length) return;
    const index = Math.max(0, Math.min(channels.length - 1, requested));
    const channel = channels[index];
    setChannelIndex(index); setMenuIndex(index); setQualityId(channel.streamId);
    setLiveUrl(isDemoMode ? getDemoLiveUrl(channel.streamId) : getLiveStreamUrl(auth!, channel.streamId));
    setLoading(true); clearEpg(); showChannelTag();
  }, [auth, channels, clearEpg, isDemoMode, showChannelTag]);

  const chooseQuality = useCallback((quality: Quality) => {
    if (!quality || quality.streamId === qualityId) return;
    setQualityId(quality.streamId);
    setLiveUrl(quality.url || (isDemoMode ? getDemoLiveUrl(quality.streamId) : (auth ? getLiveStreamUrl(auth, quality.streamId) : liveUrl)));
    setLoading(true); showQuality();
  }, [auth, isDemoMode, liveUrl, qualityId, showQuality]);

  const openMenu = useCallback(() => {
    if (!isLive || !channels.length) return;
    clearQuality(); clearEpg(); setMenuIndex(channelIndex); setMenuOpen(true);
  }, [channelIndex, channels.length, clearEpg, clearQuality, isLive]);
  const leavePlayer = useCallback(() => {
    saveProgressRef.current();
    try { videoRef.current?.pause(); } catch {}
    // The app can restore a live channel directly after the splash, leaving
    // no route behind the player. In that case Back must still open the main
    // menu instead of trapping the viewer on the channel.
    if (isLive) router.replace('/(tabs)' as any);
    else router.back();
  }, [isLive, router]);
  const typeChannelNumber = useCallback((digit: string) => {
    if (!channels.length) return;
    const next = `${channelNumberRef.current}${digit}`.slice(0, 4);
    channelNumberRef.current = next;
    setChannelNumberInput(next);
    showChannelTag();
    if (channelNumberTimer.current) clearTimeout(channelNumberTimer.current);
    channelNumberTimer.current = setTimeout(() => {
      const requested = Number(channelNumberRef.current);
      channelNumberRef.current = '';
      setChannelNumberInput('');
      const index = channels.findIndex(channel => channel.channelNumber === requested);
      if (index >= 0) changeChannel(index);
    }, 1200);
  }, [changeChannel, channels, showChannelTag]);
  const playNextEpisode = useCallback(() => {
    const next = nextEpisodes[0];
    if (!next) return;
    savePlaybackProgress(true);
    router.replace({
      pathname: '/player' as any,
      params: {
        url: next.url,
        title: next.title,
        type: 'episode',
        poster: next.poster || poster,
        contentId: next.id,
        seriesId,
        seriesName,
        nextEpisodesJson: nextEpisodes.length > 1 ? JSON.stringify(nextEpisodes.slice(1)) : undefined,
      },
    });
  }, [nextEpisodes, poster, router, savePlaybackProgress, seriesId, seriesName]);

  useEffect(() => {
    const onRemote = (event: KeyboardEvent) => {
      const key = remoteKey(event);
      if (!key) return;
      event.preventDefault(); event.stopPropagation();
      if (key === 'back') {
        if (qualityOpen) return clearQuality();
        if (epgOpen) return clearEpg();
        if (menuOpen) return setMenuOpen(false);
        return leavePlayer();
      }
      if (!isLive) {
        const video = videoRef.current;
        if (key === 'left' && video && Number.isFinite(video.duration)) {
          const position = Math.max(0, video.currentTime - 10);
          video.currentTime = position; setCurrentTime(position); showVodControls();
        }
        if (key === 'right' && video && Number.isFinite(video.duration)) {
          const position = Math.min(video.duration, video.currentTime + 10);
          video.currentTime = position; setCurrentTime(position); showVodControls();
        }
        if (key === 'down') return showVodControls();
        if (key === 'ok' && video) {
          if (video.paused) { void video.play(); hideVodControls(); }
          else { video.pause(); showVodControls(); }
        }
        return;
      }
      if (key.startsWith('digit:')) return typeChannelNumber(key.slice(6));
      if (menuOpen) {
        if (key === 'up') return setMenuIndex(value => Math.max(0, value - 1));
        if (key === 'down') return setMenuIndex(value => Math.min(channels.length - 1, value + 1));
        if (key === 'ok') { changeChannel(menuIndex); return setMenuOpen(false); }
        if (key === 'left') return setMenuOpen(false);
        return;
      }
      if (key === 'up') return changeChannel(channelIndex - 1);
      if (key === 'down') return changeChannel(channelIndex + 1);
      if (key === 'ok') return openMenu();
      if (key === 'left') {
        if (!qualityOpen) return showEpg();
        const index = Math.max(0, qualities.findIndex(quality => quality.streamId === qualityId));
        return chooseQuality(qualities[Math.max(0, index - 1)]);
      }
      if (key === 'right') {
        if (!qualityOpen) return showQuality();
        const index = Math.max(0, qualities.findIndex(quality => quality.streamId === qualityId));
        return chooseQuality(qualities[Math.min(qualities.length - 1, index + 1)]);
      }
    };
    window.addEventListener('keydown', onRemote, true);
    return () => window.removeEventListener('keydown', onRemote, true);
  }, [changeChannel, channelIndex, chooseQuality, clearEpg, clearQuality, epgOpen, hideVodControls, isLive, leavePlayer, menuIndex, menuOpen, openMenu, qualities, qualityId, qualityOpen, showEpg, showQuality, showVodControls, typeChannelNumber, channels.length]);

  const now = Date.now() / 1000;
  const current = programs.find(item => item.start_timestamp <= now && item.stop_timestamp >= now);
  const next = programs.find(item => item.start_timestamp > (current?.stop_timestamp ?? now));
  const progress = current ? Math.max(0, Math.min(1, (now - current.start_timestamp) / Math.max(1, current.stop_timestamp - current.start_timestamp))) : 0;
  const start = Math.max(0, menuIndex - Math.floor(MENU_SIZE / 2));
  const menuItems = channels.slice(start, start + MENU_SIZE);
  const channelName = currentChannel ? `${currentChannel.channelNumber}. ${currentChannel.name}` : (title || 'Ao vivo');

  if (!source) return <View style={styles.center}><Text style={styles.errorText}>Conteúdo indisponível</Text><Pressable style={styles.backButton} onPress={leavePlayer}><Text style={styles.backText}>Voltar</Text></Pressable></View>;
  const remaining = Math.max(0, duration - currentTime);
  const vodProgress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  return <View style={styles.root}>
    {React.createElement('video', {
      ref: videoRef, autoPlay: true, playsInline: true, controls: false, style: styles.video as any,
      onLoadStart: () => { setLoading(true); setError(''); },
      onLoadedMetadata: () => { const video = videoRef.current; const total = Number(video?.duration) || 0; setDuration(total); restorePosition(); },
      onTimeUpdate: () => { const video = videoRef.current; if (!video) return; setCurrentTime(Number(video.currentTime) || 0); if (Number.isFinite(video.duration)) setDuration(video.duration); },
      onEnded: () => {
        savePlaybackProgress(true);
        if (type === 'episode' && nextEpisodes.length) playNextEpisode();
      },
      onCanPlay: () => { setLoading(false); void videoRef.current?.play().catch(() => {}); },
    }, React.createElement('source', { src: source, type: mediaType(source) }))}
    {isLive && channelTagVisible ? <View pointerEvents="none" style={styles.channelTag}><Text style={styles.channelTagText}>{channelNumberInput ? `Canal ${channelNumberInput}` : channelName}</Text></View> : null}
    {!isLive && duration > 0 && vodControlsOpen ? <View pointerEvents="none" style={styles.vodProgressPanel}><Text numberOfLines={1} style={styles.vodTitle}>{title || 'Reprodução'}</Text><View style={styles.vodTrack}><View style={[styles.vodFill, { width: `${vodProgress * 100}%` }]} /></View><View style={styles.vodTimes}><Text style={styles.vodTime}>{formatDuration(currentTime)} / {formatDuration(duration)}</Text><Text style={styles.vodRemaining}>Faltam {formatDuration(remaining)}</Text></View><Text style={styles.vodHint}>↓ informações · OK continuar</Text></View> : null}
    {loading && !error ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator size="large" color="#E50000" /><Text style={styles.loadingText}>Carregando…</Text></View> : null}
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Pressable style={styles.backButton} onPress={leavePlayer}><Text style={styles.backText}>Voltar</Text></Pressable></View> : null}
    {isLive && qualityOpen && qualities.length > 1 ? <View style={styles.qualityPanel}><Text style={styles.title}>Qualidade</Text><Text style={styles.hint}>Use ← → para escolher</Text><View style={styles.qualityRow}>{qualities.map(quality => <View key={quality.streamId} style={[styles.quality, quality.streamId === qualityId && styles.qualityActive]}><Text style={styles.qualityText}>{quality.label}</Text></View>)}</View></View> : null}
    {isLive && epgOpen ? <View pointerEvents="none" style={styles.epg}><Text style={styles.epgChannel}>{channelName}</Text>{current ? <><View style={styles.epgLine}><Text style={styles.epgTime}>{epgTimeLabel(current.start_timestamp)} – {epgTimeLabel(current.stop_timestamp)}</Text><Text numberOfLines={1} style={styles.epgTitle}>{current.title || 'Programação ao vivo'}</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${progress * 100}%` }]} /></View><Text numberOfLines={1} style={styles.next}>A seguir: {next ? `${epgTimeLabel(next.start_timestamp)}  ${next.title}` : 'Programação não informada'}</Text></> : <Text style={styles.next}>Programação indisponível para este canal</Text>}</View> : null}
    {isLive && menuOpen ? <View style={styles.menu}><Text style={styles.menuTitle}>Canais</Text><Text style={styles.menuHint}>↑ ↓ navegar · OK assistir · Voltar fechar</Text><ScrollView showsVerticalScrollIndicator={false}>{menuItems.map((channel, offset) => { const index = start + offset; return <View key={channel.streamId} style={[styles.menuRow, index === menuIndex && styles.menuSelected]}><Text style={styles.number}>{channel.channelNumber}</Text><View style={styles.menuInfo}><Text numberOfLines={1} style={styles.menuName}>{channel.name}</Text>{index === channelIndex ? <Text style={styles.playing}>REPRODUZINDO</Text> : null}</View></View>; })}</ScrollView></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' }, video: { width: '100%', height: '100%', backgroundColor: '#000', objectFit: 'contain' }, center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  channelTag: { position: 'absolute', left: 32, top: 26, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.66)' }, channelTagText: { color: '#fff', fontSize: 19, fontWeight: '700' },
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }, loadingText: { color: '#fff', marginTop: 12, fontSize: 16 }, errorBox: { position: 'absolute', alignSelf: 'center', top: '36%', padding: 28, borderRadius: 14, alignItems: 'center', backgroundColor: 'rgba(20,20,20,0.96)' }, errorText: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' }, backButton: { marginTop: 20, borderRadius: 8, paddingHorizontal: 25, paddingVertical: 12, backgroundColor: '#E50000' }, backText: { color: '#fff', fontWeight: '700' },
  qualityPanel: { position: 'absolute', top: 98, right: 34, borderRadius: 12, minWidth: 330, padding: 18, backgroundColor: 'rgba(8,8,8,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }, title: { color: '#fff', fontSize: 21, fontWeight: '800' }, hint: { color: 'rgba(255,255,255,0.6)', marginTop: 4 }, qualityRow: { flexDirection: 'row', gap: 8, marginTop: 15 }, quality: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }, qualityActive: { backgroundColor: '#E50000', borderColor: '#FFD700' }, qualityText: { color: '#fff', fontWeight: '700' },
  epg: { position: 'absolute', left: '9%', right: '9%', bottom: 32, padding: 20, borderRadius: 12, backgroundColor: 'rgba(5,5,5,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }, epgChannel: { color: '#E50000', fontWeight: '800', marginBottom: 7 }, epgLine: { flexDirection: 'row', gap: 14, alignItems: 'center' }, epgTime: { color: '#9edfff', fontWeight: '700' }, epgTitle: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 18 }, track: { height: 6, overflow: 'hidden', borderRadius: 6, marginVertical: 12, backgroundColor: 'rgba(255,255,255,0.2)' }, fill: { height: '100%', backgroundColor: '#E50000' }, next: { color: 'rgba(255,255,255,0.72)', fontSize: 15 },
  vodProgressPanel: { position: 'absolute', left: '6%', right: '6%', bottom: 28, paddingHorizontal: 26, paddingVertical: 20, borderRadius: 14, backgroundColor: 'rgba(5,5,5,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }, vodTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 14 }, vodTrack: { height: 10, overflow: 'hidden', borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.25)' }, vodFill: { height: '100%', backgroundColor: '#E50000' }, vodTimes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }, vodTime: { color: 'rgba(255,255,255,0.78)', fontSize: 18, fontWeight: '600' }, vodRemaining: { color: '#fff', fontSize: 19, fontWeight: '800' }, vodHint: { color: 'rgba(255,255,255,0.58)', fontSize: 14, marginTop: 10, textAlign: 'center' },
  menu: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '39%', minWidth: 470, paddingHorizontal: 22, paddingTop: 34, backgroundColor: 'rgba(5,5,5,0.97)', borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.16)' }, menuTitle: { color: '#fff', fontSize: 28, fontWeight: '800' }, menuHint: { color: 'rgba(255,255,255,0.62)', marginTop: 5, marginBottom: 18 }, menuRow: { minHeight: 62, marginBottom: 6, paddingHorizontal: 14, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }, menuSelected: { backgroundColor: '#E50000', borderColor: '#FFD700', borderWidth: 2 }, number: { width: 52, color: '#fff', fontSize: 18, fontWeight: '800' }, menuInfo: { flex: 1 }, menuName: { color: '#fff', fontSize: 18, fontWeight: '700' }, playing: { color: '#ffd4d4', marginTop: 2, fontSize: 10, fontWeight: '800' },
});
