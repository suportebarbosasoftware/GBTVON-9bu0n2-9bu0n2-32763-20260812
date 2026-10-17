/**
 * Public sports calendar shared by every GBTVON platform.
 *
 * The panel owns the API-Football credential and caches the daily result.
 * Client apps receive only the public fixture data, never the provider key.
 */

export interface SportsTeam {
  id: number;
  name: string;
  logo: string;
}

export interface SportsFixture {
  id: number;
  starts_at: number;
  status: string;
  status_text: string;
  competition_id: number;
  competition: string;
  competition_logo: string;
  round: string;
  home: SportsTeam;
  away: SportsTeam;
}

interface SportsCalendarResponse {
  date: string;
  fixtures: SportsFixture[];
}

export interface SportsStanding {
  rank: number;
  points: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goals_for: number;
  goals_against: number;
  goals_diff: number;
  form: string;
  team: SportsTeam;
}

export interface SportsStandingsResponse {
  league_id: number;
  league: string;
  league_logo: string;
  season: number;
  standings: SportsStanding[];
}

export const FEATURED_COMPETITIONS = [
  { id: 71, label: 'Brasileirão Série A' },
  { id: 39, label: 'Premier League' },
  { id: 140, label: 'La Liga' },
  { id: 135, label: 'Serie A TIM' },
  { id: 78, label: 'Bundesliga' },
  { id: 94, label: 'Liga Portugal' },
  { id: 2, label: 'Liga dos Campeões' },
  { id: 13, label: 'Copa Libertadores' },
  { id: 11, label: 'Copa Sul-Americana' },
] as const;

const SPORTS_CALENDAR_URL = 'https://painel.controledeassinatura.com.br/api/sports/today';

/** API-Football statuses that mean the match is currently in progress. */
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);

export function isLiveFixture(fixture: SportsFixture) {
  return LIVE_STATUSES.has(String(fixture.status || '').toUpperCase());
}

/**
 * The panel already returns the São Paulo calendar date. Only scheduled
 * matches still in the future and matches in play belong in the shortcut.
 */
export function isAvailableFixture(fixture: SportsFixture, nowSeconds = Math.floor(Date.now() / 1000)) {
  return isLiveFixture(fixture) || (String(fixture.status || '').toUpperCase() === 'NS' && fixture.starts_at >= nowSeconds);
}

export async function getTodaySportsFixtures(): Promise<SportsFixture[]> {
  const response = await fetch(SPORTS_CALENDAR_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Sports calendar unavailable (${response.status})`);

  const data = await response.json() as SportsCalendarResponse;
  if (!Array.isArray(data?.fixtures)) return [];

  return data.fixtures
    .filter(item => item && typeof item.id === 'number' && item.home && item.away)
    .filter(isAvailableFixture)
    .sort((a, b) => a.starts_at - b.starts_at);
}

export async function getSportsStandings(leagueId: number): Promise<SportsStandingsResponse> {
  const response = await fetch(`${SPORTS_CALENDAR_URL.replace('/today', '/standings')}?league=${encodeURIComponent(String(leagueId))}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Sports standings unavailable (${response.status})`);
  const data = await response.json() as SportsStandingsResponse;
  return {
    league_id: Number(data?.league_id) || leagueId,
    league: String(data?.league || ''),
    league_logo: String(data?.league_logo || ''),
    season: Number(data?.season) || new Date().getFullYear(),
    standings: Array.isArray(data?.standings) ? data.standings : [],
  };
}

export function sportsTimeLabel(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}
