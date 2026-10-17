/** Jogos de Hoje — agenda assistível e classificação oficial. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import TVFocusable from '@/components/ui/TVFocusable';
import { Colors } from '@/constants/theme';
import { IS_TV, TV } from '@/hooks/useTV';
import { useAuth } from '@/hooks/useAuth';
import { useLiveTV } from '@/hooks/useLiveTV';
import { EpgProgram, getShortEpg } from '@/services/xtreamApi';
import { NumberedChannel } from '@/services/channelNumberService';
import {
  FEATURED_COMPETITIONS,
  getSportsStandings,
  getTodaySportsFixtures,
  isLiveFixture,
  sportsTimeLabel,
  SportsFixture,
  SportsStandingsResponse,
} from '@/services/sportsCalendarService';

type Broadcast = { channel: NumberedChannel; program: EpgProgram };
type ScheduledGame = { fixture: SportsFixture; broadcast: Broadcast };
type CalendarView = 'games' | 'standings';

const SPORTS_CHANNEL_PATTERN = /sport|espn|premiere|dazn|disney|star\+?|combate|futebol|jogos?|nba|nfl|u?fc|globo|sbt|band|record|caz[eé]|tnt|paramount|amazon|prime\s*video/i;
const SPORTS_PROGRAM_PATTERN = /futebol|football|esporte|sport|premiere|espn|brasileir|serie\s*[ab]|liga|copa|champions|libertadores|sul[-\s]?americana|\b(?:x|vs)\b/i;
const MAX_CHANNELS_TO_SCAN = 180;
const FEATURED_LEAGUE_IDS = new Set<number>(FEATURED_COMPETITIONS.map(item => item.id));

function normalized(value: string) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:fc|cf|sc|ac|afc|ec|saf|club|futebol|football|de|da|do|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function featuredLeagueId(fixture: SportsFixture) {
  if (FEATURED_LEAGUE_IDS.has(Number(fixture.competition_id))) return Number(fixture.competition_id);
  const competition = normalized(fixture.competition);
  if (/brasileir/.test(competition)) return 71;
  if (/copa do brasil/.test(competition)) return 73;
  if (/serie b/.test(competition)) return 72;
  if (/premier league/.test(competition)) return 39;
  if (/la liga/.test(competition)) return 140;
  if (/serie a/.test(competition)) return 135;
  if (/bundesliga/.test(competition)) return 78;
  if (/portugal|primeira liga/.test(competition)) return 94;
  if (/champions league/.test(competition)) return 2;
  if (/libertadores/.test(competition)) return 13;
  if (/sudamericana/.test(competition)) return 11;
  return null;
}

function textMentionsTeam(text: string, teamName: string) {
  const source = normalized(text);
  const team = normalized(teamName);
  if (!source || !team) return false;
  if (source.includes(team)) return true;
  const parts = team.split(' ').filter(part => part.length >= 4);
  if (!parts.length) return false;
  // Schedules often shorten only one part of a long name (for example PR).
  // Since BOTH opponents must match, the strongest distinctive word is safe.
  return parts.every(part => source.includes(part)) || source.includes(parts.sort((a, b) => b.length - a.length)[0]);
}

function findBroadcast(fixture: SportsFixture, channelPrograms: Array<{ channel: NumberedChannel; programs: EpgProgram[] }>, now: number): Broadcast | undefined {
  let best: (Broadcast & { score: number }) | undefined;
  for (const item of channelPrograms) {
    for (const candidate of item.programs) {
      if (candidate.stop_timestamp < now || candidate.stop_timestamp < fixture.starts_at - 45 * 60 || candidate.start_timestamp > fixture.starts_at + 90 * 60) continue;
      const text = `${candidate.title || ''} ${candidate.description || ''}`;
      const homeMatch = textMentionsTeam(text, fixture.home.name);
      const awayMatch = textMentionsTeam(text, fixture.away.name);
      const competitionMatch = normalized(fixture.competition).split(' ').filter(word => word.length >= 4).some(word => normalized(text).includes(word));
      const sportsProgram = SPORTS_PROGRAM_PATTERN.test(text);
      // Exact team pairing is preferred. A single club plus a matching
      // football program/time is the safe fallback for EPG providers that
      // abbreviate one of the clubs or omit it from the title.
      const score = homeMatch && awayMatch ? 100 : (homeMatch || awayMatch) && sportsProgram ? 70 : competitionMatch && sportsProgram ? 40 : 0;
      if (score > (best?.score || 0)) best = { channel: item.channel, program: candidate, score };
    }
  }
  return best ? { channel: best.channel, program: best.program } : undefined;
}

async function loadEpgWithLimit(auth: NonNullable<ReturnType<typeof useAuth>['auth']>, channels: NumberedChannel[]) {
  const results: Array<{ channel: NumberedChannel; programs: EpgProgram[] }> = [];
  const queue = [...channels];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const channel = queue.shift();
      if (!channel) return;
      const programs = await getShortEpg(auth, channel.primaryStreamId, 24).catch(() => [] as EpgProgram[]);
      results.push({ channel, programs });
    }
  });
  await Promise.all(workers);
  return results;
}

function Crest({ uri, name, small = false }: { uri?: string; name: string; small?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return <View style={[styles.crestFrame, small && styles.crestFrameSmall]}>
    {uri ? <Image source={{ uri }} style={styles.crest} contentFit="contain" transition={160} /> : <Text style={[styles.crestFallback, small && styles.crestFallbackSmall]}>{initials}</Text>}
  </View>;
}

export default function GamesScreen() {
  const router = useRouter();
  const { auth, isDemoMode } = useAuth();
  const { categories, getAllNumberedChannels, getStreamUrl, loading: listLoading } = useLiveTV();
  const [view, setView] = useState<CalendarView>('games');
  const [games, setGames] = useState<ScheduledGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [leagueId, setLeagueId] = useState<number>(71);
  const [standings, setStandings] = useState<SportsStandingsResponse | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsError, setStandingsError] = useState(false);

  const eligibleChannels = useMemo(() => {
    const categoryNames = new Map(categories.map(category => [category.category_id, category.category_name]));
    return getAllNumberedChannels()
      .filter(channel => SPORTS_CHANNEL_PATTERN.test(`${channel.baseName} ${categoryNames.get(channel.categoryId) || ''}`))
      .slice(0, MAX_CHANNELS_TO_SCAN);
  }, [categories, getAllNumberedChannels]);

  const loadGames = useCallback(async (isRefresh = false) => {
    if (!auth || isDemoMode) {
      setGames([]); setLoading(false); setRefreshing(false); return;
    }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setApiUnavailable(false);
    try {
      const [fixtures, epgs] = await Promise.all([
        getTodaySportsFixtures(),
        loadEpgWithLimit(auth, eligibleChannels),
      ]);
      const now = Math.floor(Date.now() / 1000);
      const watchable = fixtures
        .filter(fixture => featuredLeagueId(fixture) !== null)
        .map(fixture => ({ fixture, broadcast: findBroadcast(fixture, epgs, now) }))
        .filter((game): game is ScheduledGame => !!game.broadcast);
      setGames(watchable);
    } catch {
      setGames([]); setApiUnavailable(true);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [auth, eligibleChannels, isDemoMode]);

  const loadStandings = useCallback(async () => {
    setStandingsLoading(true); setStandingsError(false);
    try { setStandings(await getSportsStandings(leagueId)); }
    catch { setStandings(null); setStandingsError(true); }
    finally { setStandingsLoading(false); }
  }, [leagueId]);

  useEffect(() => { void loadGames(); }, [loadGames]);
  useEffect(() => { if (view === 'standings') void loadStandings(); }, [loadStandings, view]);

  function openChannel(game: ScheduledGame) {
    const primary = game.broadcast.channel.qualities[0];
    if (!primary) return;
    router.push({
      pathname: '/player',
      params: {
        url: getStreamUrl(primary.streamId), title: game.broadcast.channel.baseName, type: 'live',
        poster: game.broadcast.channel.icon, contentId: String(primary.streamId),
        qualitiesJson: JSON.stringify(game.broadcast.channel.qualities.map(quality => ({ label: quality.label, streamId: quality.streamId, url: getStreamUrl(quality.streamId) }))),
      },
    } as any);
  }

  if (listLoading || loading) {
    return <View style={styles.centered}><ActivityIndicator color={Colors.primary} size="large" /><Text style={styles.loadingText}>Procurando jogos disponíveis na sua lista…</Text></View>;
  }

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadGames(true)} tintColor={Colors.primary} />}
  >
    <View style={styles.header}>
      <View><View style={styles.titleRow}><Ionicons name="calendar" size={IS_TV ? 28 : 22} color={Colors.primary} /><Text style={styles.title}>Futebol</Text></View><Text style={styles.subtitle}>Jogos das principais ligas que você pode assistir agora</Text></View>
      {view === 'games' && <View style={styles.count}><Text style={styles.countText}>{games.length} {games.length === 1 ? 'jogo' : 'jogos'}</Text></View>}
    </View>

    <View style={styles.viewTabs}>
      <TVFocusable style={[styles.viewTab, view === 'games' && styles.viewTabActive]} focusedStyle={styles.viewTabFocused} focusScale={IS_TV ? 1.04 : 1} onPress={() => setView('games')}><Ionicons name="play-circle-outline" color="#fff" size={IS_TV ? 23 : 18} /><Text style={styles.viewTabText}>Jogos para assistir</Text></TVFocusable>
      <TVFocusable style={[styles.viewTab, view === 'standings' && styles.viewTabActive]} focusedStyle={styles.viewTabFocused} focusScale={IS_TV ? 1.04 : 1} onPress={() => setView('standings')}><Ionicons name="podium-outline" color="#fff" size={IS_TV ? 23 : 18} /><Text style={styles.viewTabText}>Classificação</Text></TVFocusable>
    </View>

    {view === 'games' ? (games.length === 0 ? <View style={styles.empty}>
      <Ionicons name={apiUnavailable ? 'cloud-offline-outline' : 'football-outline'} size={IS_TV ? 58 : 46} color="rgba(255,255,255,0.28)" />
      <Text style={styles.emptyTitle}>{apiUnavailable ? 'Não foi possível atualizar os jogos' : 'Nenhum jogo disponível na sua lista'}</Text>
      <Text style={styles.emptyText}>{apiUnavailable ? 'Verifique a conexão e tente atualizar novamente.' : 'Mostramos apenas partidas das ligas principais que tenham canal disponível no seu aplicativo.'}</Text>
    </View> : games.map(game => {
      const live = isLiveFixture(game.fixture);
      return <TVFocusable key={game.fixture.id} style={styles.gameCard} focusedStyle={styles.gameCardFocused} focusScale={IS_TV ? 1.025 : 1} onPress={() => openChannel(game)}>
        <View style={styles.timeColumn}><View style={[styles.status, live ? styles.statusLive : styles.statusUpcoming]}>{live && <View style={styles.liveDot} />}<Text style={styles.statusText}>{live ? 'AO VIVO' : sportsTimeLabel(game.fixture.starts_at)}</Text></View></View>
        <View style={styles.teams}><View style={styles.team}><Crest uri={game.fixture.home.logo} name={game.fixture.home.name} /><Text style={styles.teamName} numberOfLines={1}>{game.fixture.home.name}</Text></View><Text style={styles.versus}>×</Text><View style={styles.team}><Crest uri={game.fixture.away.logo} name={game.fixture.away.name} /><Text style={styles.teamName} numberOfLines={1}>{game.fixture.away.name}</Text></View></View>
        <View style={styles.competitionBlock}>{game.fixture.competition_logo ? <Image source={{ uri: game.fixture.competition_logo }} style={styles.competitionLogo} contentFit="contain" transition={160} /> : <Ionicons name="trophy-outline" size={IS_TV ? 34 : 24} color="#FFD463" />}<View style={styles.competitionText}><Text style={styles.competition} numberOfLines={1}>{game.fixture.competition}</Text><Text style={styles.round} numberOfLines={1}>{game.fixture.round || 'Partida de hoje'}</Text></View></View>
        <View style={styles.broadcast}><Text style={styles.channelCaption}>ASSISTIR NA SUA LISTA</Text><View style={styles.channelRow}><Ionicons name="tv-outline" size={IS_TV ? 21 : 15} color="#9EDFFF" /><Text style={styles.channelText} numberOfLines={1}>Canal {game.broadcast.channel.channelNumber} · {game.broadcast.channel.baseName}</Text></View></View><Ionicons name="play-circle" size={IS_TV ? 44 : 34} color={Colors.primary} />
      </TVFocusable>;
    })) : <>
      <Text style={styles.sectionTitle}>Escolha o campeonato</Text>
      <View style={styles.leaguePicker}>{FEATURED_COMPETITIONS.map(league => <TVFocusable key={league.id} style={[styles.leagueChip, league.id === leagueId && styles.leagueChipActive]} focusedStyle={styles.leagueChipFocused} focusScale={IS_TV ? 1.04 : 1} onPress={() => setLeagueId(league.id)}><Text style={styles.leagueChipText}>{league.label}</Text></TVFocusable>)}</View>
      {standingsLoading ? <View style={styles.standingLoading}><ActivityIndicator color={Colors.primary} size="large" /><Text style={styles.loadingText}>Carregando classificação…</Text></View> : standingsError ? <View style={styles.empty}><Ionicons name="cloud-offline-outline" size={IS_TV ? 54 : 40} color="rgba(255,255,255,0.3)" /><Text style={styles.emptyTitle}>Classificação indisponível</Text><Text style={styles.emptyText}>Tente novamente em instantes.</Text></View> : standings ? <View style={styles.standingBox}>
        <View style={styles.standingHeader}>{standings.league_logo ? <Image source={{ uri: standings.league_logo }} style={styles.standingLeagueLogo} contentFit="contain" /> : <Ionicons name="trophy-outline" size={IS_TV ? 34 : 24} color="#FFD463" />}<View><Text style={styles.standingLeague}>{standings.league}</Text><Text style={styles.standingSeason}>Temporada {standings.season}</Text></View></View>
        <View style={[styles.tableRow, styles.tableHeading]}><Text style={styles.rankHeading}>#</Text><Text style={[styles.tableTeam, styles.tableHeadingText]}>TIME</Text><Text style={styles.statHeading}>J</Text><Text style={styles.statHeading}>V</Text><Text style={styles.statHeading}>E</Text><Text style={styles.statHeading}>D</Text><Text style={styles.statHeading}>SG</Text><Text style={styles.pointsHeading}>PTS</Text></View>
        {standings.standings.map(row => <View key={row.team.id || row.rank} style={styles.tableRow}><Text style={styles.rank}>{row.rank}</Text><View style={styles.tableTeam}><Crest uri={row.team.logo} name={row.team.name} small /><Text style={styles.tableTeamName} numberOfLines={1}>{row.team.name}</Text></View><Text style={styles.stat}>{row.played}</Text><Text style={styles.stat}>{row.win}</Text><Text style={styles.stat}>{row.draw}</Text><Text style={styles.stat}>{row.lose}</Text><Text style={styles.stat}>{row.goals_diff > 0 ? `+${row.goals_diff}` : row.goals_diff}</Text><Text style={styles.points}>{row.points}</Text></View>)}
      </View> : null}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' }, content: { padding: IS_TV ? 38 : 20, paddingBottom: IS_TV ? 70 : 36, gap: IS_TV ? 18 : 12 }, centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', gap: 14 }, loadingText: { color: 'rgba(255,255,255,0.72)', fontSize: IS_TV ? TV.fontSize.md : 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: IS_TV ? 3 : 0 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, title: { color: '#fff', fontSize: IS_TV ? 31 : 24, fontWeight: '800' }, subtitle: { color: 'rgba(255,255,255,0.57)', marginTop: 8, fontSize: IS_TV ? 16 : 13 }, count: { backgroundColor: 'rgba(229,0,0,0.17)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(229,0,0,0.45)', paddingHorizontal: IS_TV ? 17 : 12, paddingVertical: 8 }, countText: { color: '#fff', fontWeight: '800', fontSize: IS_TV ? 15 : 12 },
  viewTabs: { flexDirection: 'row', gap: IS_TV ? 14 : 9, marginBottom: IS_TV ? 7 : 2 }, viewTab: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 999, paddingHorizontal: IS_TV ? 22 : 14, paddingVertical: IS_TV ? 13 : 9, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }, viewTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary }, viewTabFocused: { borderWidth: 3, borderColor: '#F1ED00', backgroundColor: '#D60000' }, viewTabText: { color: '#fff', fontWeight: '800', fontSize: IS_TV ? 17 : 12 },
  gameCard: { minHeight: IS_TV ? 174 : 112, borderRadius: IS_TV ? 20 : 14, padding: IS_TV ? 21 : 14, flexDirection: 'row', alignItems: 'center', gap: IS_TV ? 22 : 12, backgroundColor: 'transparent', borderWidth: 0 }, gameCardFocused: { backgroundColor: 'rgba(229,0,0,0.2)', borderColor: '#F1ED00', borderWidth: 3 }, timeColumn: { width: IS_TV ? 108 : 73, alignItems: 'center' }, status: { minWidth: IS_TV ? 94 : 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingVertical: IS_TV ? 10 : 8, paddingHorizontal: 7 }, statusLive: { backgroundColor: '#D60000' }, statusUpcoming: { backgroundColor: 'rgba(79,130,255,0.24)' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' }, statusText: { color: '#fff', fontWeight: '800', fontSize: IS_TV ? 15 : 10 },
  teams: { flex: 1.12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_TV ? 14 : 8, minWidth: 0 }, team: { flex: 1, alignItems: 'center', gap: 7, minWidth: 0 }, crestFrame: { width: IS_TV ? 70 : 38, height: IS_TV ? 70 : 38, borderRadius: IS_TV ? 14 : 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.26)', overflow: 'hidden' }, crestFrameSmall: { width: IS_TV ? 34 : 25, height: IS_TV ? 34 : 25, borderRadius: 8 }, crest: { width: '86%', height: '86%' }, crestFallback: { color: '#fff', fontWeight: '900', fontSize: IS_TV ? 19 : 11 }, crestFallbackSmall: { fontSize: IS_TV ? 11 : 8 }, teamName: { color: '#fff', fontWeight: '800', fontSize: IS_TV ? 18 : 12, textAlign: 'center', width: '100%' }, versus: { color: Colors.primary, fontSize: IS_TV ? 34 : 22, fontWeight: '900' },
  competitionBlock: { width: IS_TV ? 245 : 135, flexDirection: 'row', gap: IS_TV ? 13 : 8, alignItems: 'center', minWidth: 0 }, competitionLogo: { width: IS_TV ? 46 : 30, height: IS_TV ? 46 : 30 }, competitionText: { flex: 1, minWidth: 0, gap: 4 }, competition: { color: '#FFD463', fontWeight: '800', fontSize: IS_TV ? 17 : 12 }, round: { color: 'rgba(255,255,255,0.54)', fontSize: IS_TV ? 14 : 10 }, broadcast: { flex: 1, minWidth: 0, gap: 7 }, channelCaption: { color: 'rgba(255,255,255,0.48)', fontSize: IS_TV ? 11 : 8, fontWeight: '900', letterSpacing: 0.6 }, channelRow: { flexDirection: 'row', gap: 7, alignItems: 'center' }, channelText: { color: 'rgba(255,255,255,0.87)', fontSize: IS_TV ? 17 : 12, flex: 1 },
  sectionTitle: { color: '#fff', fontSize: IS_TV ? 21 : 16, fontWeight: '800', marginTop: 4 }, leaguePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: IS_TV ? 13 : 8 }, leagueChip: { borderRadius: 999, paddingHorizontal: IS_TV ? 19 : 12, paddingVertical: IS_TV ? 12 : 8, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)' }, leagueChipActive: { backgroundColor: 'rgba(229,0,0,0.85)', borderColor: Colors.primary }, leagueChipFocused: { borderWidth: 3, borderColor: '#F1ED00', backgroundColor: '#D60000' }, leagueChipText: { color: '#fff', fontWeight: '800', fontSize: IS_TV ? 16 : 12 }, standingLoading: { minHeight: IS_TV ? 330 : 230, alignItems: 'center', justifyContent: 'center', gap: 14 },
  standingBox: { borderRadius: IS_TV ? 20 : 14, overflow: 'hidden', backgroundColor: 'transparent', borderWidth: 0 }, standingHeader: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: IS_TV ? 20 : 14, backgroundColor: 'rgba(229,0,0,0.15)' }, standingLeagueLogo: { width: IS_TV ? 46 : 32, height: IS_TV ? 46 : 32 }, standingLeague: { color: '#fff', fontWeight: '900', fontSize: IS_TV ? 22 : 17 }, standingSeason: { color: 'rgba(255,255,255,0.62)', marginTop: 3, fontSize: IS_TV ? 14 : 11 }, tableRow: { minHeight: IS_TV ? 57 : 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: IS_TV ? 18 : 10, borderTopWidth: 0 }, tableHeading: { minHeight: IS_TV ? 42 : 32, backgroundColor: 'transparent' }, rankHeading: { width: IS_TV ? 48 : 28, color: 'rgba(255,255,255,0.52)', fontSize: IS_TV ? 13 : 9, fontWeight: '800' }, tableHeadingText: { color: 'rgba(255,255,255,0.52)', fontSize: IS_TV ? 13 : 9, fontWeight: '800' }, tableTeam: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: IS_TV ? 10 : 6, minWidth: 0 }, statHeading: { width: IS_TV ? 47 : 25, color: 'rgba(255,255,255,0.52)', textAlign: 'center', fontSize: IS_TV ? 13 : 9, fontWeight: '800' }, pointsHeading: { width: IS_TV ? 57 : 32, color: '#FFD463', textAlign: 'center', fontSize: IS_TV ? 13 : 9, fontWeight: '900' }, rank: { width: IS_TV ? 48 : 28, color: '#fff', fontWeight: '900', fontSize: IS_TV ? 17 : 12 }, tableTeamName: { color: '#fff', fontWeight: '700', fontSize: IS_TV ? 16 : 11, flex: 1 }, stat: { width: IS_TV ? 47 : 25, color: 'rgba(255,255,255,0.82)', textAlign: 'center', fontSize: IS_TV ? 16 : 11 }, points: { width: IS_TV ? 57 : 32, color: '#FFD463', textAlign: 'center', fontWeight: '900', fontSize: IS_TV ? 17 : 12 },
  empty: { minHeight: IS_TV ? 380 : 260, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, gap: 14, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' }, emptyTitle: { color: '#fff', fontWeight: '800', fontSize: IS_TV ? 23 : 18, textAlign: 'center' }, emptyText: { color: 'rgba(255,255,255,0.57)', fontSize: IS_TV ? 16 : 13, textAlign: 'center', maxWidth: 650, lineHeight: IS_TV ? 23 : 18 },
});
