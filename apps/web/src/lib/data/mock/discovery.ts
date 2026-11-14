import { addDays, computeDailyKpis, dayRange, summarise } from '@/lib/domain/kpis';
import { rankScore, type RankInputs } from '@/lib/domain/ranking';
import type { DatabaseStats, DiscoveryReport, DiscoveryRow, SiteStats } from '../growthTypes';
import type { GameStatus } from '../types';
import { dayKey, mockDbStats, mutateTable, readTable } from './db';
import { kpiEvents, kpiRatings } from './dev';

/** The window the discovery algorithm looks at. */
const WINDOW_DAYS = 14;

interface Snapshot {
  at: number;
  byGame: Map<string, { inputs: RankInputs; score: number }>;
}
let snapshot: Snapshot | null = null;

/** Adds tile impressions and clicks to today's row of each game (mirror of record_tile_hits). */
export function addImpressions(hits: { gameId: string; impressions: number; clicks: number }[]): void {
  const today = dayKey();
  const cutoff = addDays(today, -45);
  mutateTable('impressions', (rows) => {
    const kept = rows.filter((r) => r.day >= cutoff);
    for (const h of hits) {
      let row = kept.find((r) => r.gameId === h.gameId && r.day === today);
      if (!row) kept.push((row = { gameId: h.gameId, day: today, impressions: 0, clicks: 0 }));
      row.impressions += h.impressions;
      row.clicks += h.clicks;
    }
    return kept;
  });
  snapshot = null;
}

/** Inputs and score of every released game, recomputed at most every 15 seconds. */
function compute(): Snapshot['byGame'] {
  if (snapshot && Date.now() - snapshot.at < 15_000) return snapshot.byGame;
  const today = dayKey();
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const events = kpiEvents();
  const ratings = kpiRatings();
  const impressions = readTable('impressions').filter((r) => r.day >= from);
  const byGame: Snapshot['byGame'] = new Map();
  for (const g of readTable('games')) {
    if (!g.releasedAt) continue;
    const s = summarise(computeDailyKpis(events, ratings, g.id, from, today));
    const mine = impressions.filter((r) => r.gameId === g.id);
    const inputs: RankInputs = {
      impressions: mine.reduce((n, r) => n + r.impressions, 0),
      clicks: mine.reduce((n, r) => n + r.clicks, 0),
      plays: s.plays,
      conversion: s.conversion,
      avgSessionSec: s.avgSessionSec,
      d1: s.d1,
      likes: s.likes,
      dislikes: s.dislikes,
      ageDays: Math.max(0, (Date.now() - new Date(g.releasedAt).getTime()) / 86_400_000),
    };
    byGame.set(g.id, { inputs, score: rankScore(inputs) });
  }
  snapshot = { at: Date.now(), byGame };
  return byGame;
}

export const rankOf = (gameId: string): number => compute().get(gameId)?.score ?? 0;

function byDayFor(gameId: string): DiscoveryReport['byDay'] {
  const today = dayKey();
  const rows = readTable('impressions').filter((r) => r.gameId === gameId);
  return dayRange(addDays(today, -29), today).map((day) => {
    const row = rows.find((r) => r.day === day);
    return { day, impressions: row?.impressions ?? 0, clicks: row?.clicks ?? 0 };
  });
}

export function discoveryFor(gameId: string): DiscoveryReport | null {
  const entry = compute().get(gameId);
  return entry ? { gameId, inputs: entry.inputs, score: entry.score, byDay: byDayFor(gameId) } : null;
}

export function discoveryAll(): DiscoveryRow[] {
  const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
  const all = compute();
  return readTable('games')
    .filter((g) => all.has(g.id))
    .map((g) => {
      const e = all.get(g.id)!;
      return { gameId: g.id, slug: g.slug, title: g.title, studioName: studios.get(g.studioId) ?? '', status: g.status, inputs: e.inputs, score: e.score, byDay: byDayFor(g.id) };
    })
    .sort((a, b) => b.score - a.score);
}

export function siteStats(): SiteStats {
  const today = dayKey();
  const week = addDays(today, -6);
  const days = dayRange(addDays(today, -29), today);
  const plays = new Map<string, number>();
  const players = new Map<string, Set<string>>();
  for (const e of readTable('events')) {
    if (e.type !== 'play_click') continue;
    const day = e.ts.slice(0, 10);
    plays.set(day, (plays.get(day) ?? 0) + 1);
    if (!players.has(day)) players.set(day, new Set());
    players.get(day)!.add(e.anonId);
  }
  const impressions = new Map<string, number>();
  for (const r of readTable('impressions')) impressions.set(r.day, (impressions.get(r.day) ?? 0) + r.impressions);
  const weekPlayers = new Set<string>();
  for (const [day, set] of players) if (day >= week) for (const id of set) weekPlayers.add(id);
  const gamesByStatus: Partial<Record<GameStatus, number>> = {};
  for (const g of readTable('games')) gamesByStatus[g.status] = (gamesByStatus[g.status] ?? 0) + 1;
  const sumFrom = (map: Map<string, number>, from: string) => [...map].reduce((n, [day, v]) => (day >= from ? n + v : n), 0);
  return {
    players7d: weekPlayers.size,
    plays7d: sumFrom(plays, week),
    playsToday: plays.get(today) ?? 0,
    impressions7d: sumFrom(impressions, week),
    accounts: readTable('users').filter((u) => u.username).length,
    studios: readTable('studios').length,
    gamesByStatus,
    inReview: readTable('versions').filter((v) => v.qaStatus === 'in_review').length,
    openReports: readTable('reports').filter((r) => r.status === 'open').length,
    byDay: days.map((day) => ({ day, plays: plays.get(day) ?? 0, players: players.get(day)?.size ?? 0, impressions: impressions.get(day) ?? 0 })),
  };
}

export function databaseStats(): DatabaseStats {
  const stats = mockDbStats();
  return {
    engine: stats.store === 'local-service' ? 'Local test database (mock mode, .local/mock-db.json)' : 'Browser storage (mock mode)',
    totalBytes: stats.totalBytes,
    limitBytes: null,
    connections: null,
    tables: stats.tables,
  };
}
