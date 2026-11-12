/**
 * Game KPIs. The same definitions as `refresh_daily_game_kpis` in 0002_events_kpis.sql:
 *   play        a session with a play_click
 *   playtime    the largest cumulative `t` (seconds) reported in that session
 *   conversion  share of plays with at least 60 s of playtime
 *   D1 / D7     share of a day's new players who play the same game again 1 / 7 days later
 */
export interface KpiEvent {
  anonId: string;
  sessionId: string | null;
  gameId: string | null;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
  country: string | null;
  refStudio?: string | null;
}

export interface KpiRating {
  gameId: string;
  value: 1 | -1;
  reason: string | null;
  createdAt: string;
}

export interface DailyKpi {
  day: string;
  plays: number;
  players: number;
  newPlayers: number;
  conversion1min: number | null;
  avgSessionSec: number | null;
  d1Retention: number | null;
  d7Retention: number | null;
  adImpressions: number;
  adImpressionsByCountry: Record<string, number>;
  refAdImpressions: number;
  likes: number;
  dislikes: number;
  dislikeReasons: Record<string, number>;
  loadMsP50: number | null;
  loadMsP90: number | null;
}

export interface KpiPercentiles {
  conversion: number;
  session: number;
  d1: number;
  plays: number;
}

export interface KpiResult {
  days: DailyKpi[];
  peers: number;
  percentiles: KpiPercentiles | null;
}

export const dayOf = (iso: string) => iso.slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo));
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Daily KPIs of one game for every day in [from, to]. */
export function computeDailyKpis(
  events: readonly KpiEvent[],
  ratings: readonly KpiRating[],
  gameId: string,
  from: string,
  to: string,
): DailyKpi[] {
  const mine = events.filter((e) => e.gameId === gameId);
  // First play day per player, over all time, for "new players" and retention.
  const firstDay = new Map<string, string>();
  const playDays = new Map<string, Set<string>>();
  for (const e of mine) {
    if (e.type !== 'play_click') continue;
    const d = dayOf(e.ts);
    const prev = firstDay.get(e.anonId);
    if (!prev || d < prev) firstDay.set(e.anonId, d);
    let set = playDays.get(e.anonId);
    if (!set) playDays.set(e.anonId, (set = new Set()));
    set.add(d);
  }

  const out: DailyKpi[] = [];
  for (const day of dayRange(from, to)) {
    const todays = mine.filter((e) => dayOf(e.ts) === day);
    const sessions = new Map<string, { anon: string; seconds: number; loadMs: number | null; played: boolean }>();
    for (const e of todays) {
      if (!e.sessionId) continue;
      let s = sessions.get(e.sessionId);
      if (!s) sessions.set(e.sessionId, (s = { anon: e.anonId, seconds: 0, loadMs: null, played: false }));
      if (e.type === 'play_click') s.played = true;
      s.seconds = Math.max(s.seconds, num(e.payload.t));
      if (e.type === 'loading_stop' && typeof e.payload.ms === 'number') s.loadMs = Math.max(s.loadMs ?? 0, e.payload.ms);
    }
    const plays = [...sessions.values()].filter((s) => s.played);
    const loads = plays.map((s) => s.loadMs).filter((v): v is number => v != null).sort((a, b) => a - b);
    const ads = todays.filter((e) => e.type === 'ad_started');
    const byCountry: Record<string, number> = {};
    for (const a of ads) byCountry[a.country ?? 'ZZ'] = (byCountry[a.country ?? 'ZZ'] ?? 0) + 1;
    const votes = ratings.filter((r) => r.gameId === gameId && dayOf(r.createdAt) === day);
    const reasons: Record<string, number> = {};
    for (const v of votes) if (v.value === -1 && v.reason) reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;

    const cohort = [...firstDay.entries()].filter(([, d]) => d === day).map(([anon]) => anon);
    const retention = (n: number) => {
      const target = addDays(day, n);
      if (cohort.length === 0 || target > to) return null;
      return cohort.filter((anon) => playDays.get(anon)?.has(target)).length / cohort.length;
    };

    out.push({
      day,
      plays: plays.length,
      players: new Set(plays.map((s) => s.anon)).size,
      newPlayers: cohort.length,
      conversion1min: plays.length ? plays.filter((s) => s.seconds >= 60).length / plays.length : null,
      avgSessionSec: plays.length ? plays.reduce((n, s) => n + s.seconds, 0) / plays.length : null,
      d1Retention: retention(1),
      d7Retention: retention(7),
      adImpressions: ads.length,
      adImpressionsByCountry: byCountry,
      refAdImpressions: ads.filter((a) => a.refStudio).length,
      likes: votes.filter((v) => v.value === 1).length,
      dislikes: votes.filter((v) => v.value === -1).length,
      dislikeReasons: reasons,
      loadMsP50: percentile(loads, 0.5),
      loadMsP90: percentile(loads, 0.9),
    });
  }
  return out;
}

export interface KpiSummary {
  plays: number;
  players: number;
  conversion: number | null;
  avgSessionSec: number | null;
  d1: number | null;
  d7: number | null;
  adImpressions: number;
  likes: number;
  dislikes: number;
  dislikeReasons: Record<string, number>;
  loadMsP50: number | null;
}

/** Totals over a range, with rates weighted by plays. */
export function summarise(days: readonly DailyKpi[]): KpiSummary {
  const plays = days.reduce((n, d) => n + d.plays, 0);
  const weighted = (pick: (d: DailyKpi) => number | null) => {
    let sum = 0;
    let weight = 0;
    for (const d of days) {
      const v = pick(d);
      if (v == null || d.plays === 0) continue;
      sum += v * d.plays;
      weight += d.plays;
    }
    return weight ? sum / weight : null;
  };
  const avgOf = (pick: (d: DailyKpi) => number | null) => {
    const vals = days.map(pick).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const reasons: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(d.dislikeReasons)) reasons[k] = (reasons[k] ?? 0) + v;
  return {
    plays,
    players: days.reduce((n, d) => n + d.players, 0),
    conversion: weighted((d) => d.conversion1min),
    avgSessionSec: weighted((d) => d.avgSessionSec),
    d1: avgOf((d) => d.d1Retention),
    d7: avgOf((d) => d.d7Retention),
    adImpressions: days.reduce((n, d) => n + d.adImpressions, 0),
    likes: days.reduce((n, d) => n + d.likes, 0),
    dislikes: days.reduce((n, d) => n + d.dislikes, 0),
    dislikeReasons: reasons,
    loadMsP50: avgOf((d) => d.loadMsP50),
  };
}

/** Share of peers strictly below `value` (0 to 1), like Postgres percent_rank. */
export function percentRank(value: number | null, peers: readonly (number | null)[]): number {
  const vals = peers.map((v) => v ?? Number.NEGATIVE_INFINITY);
  const v = value ?? Number.NEGATIVE_INFINITY;
  if (vals.length <= 1) return 1;
  return vals.filter((x) => x < v).length / (vals.length - 1);
}

/** Benchmarks shown beside each KPI ("great" is the bar from the developer docs). */
export const BENCHMARKS = {
  conversion: { great: 0.8, ok: 0.6 },
  d1: { great: 0.1, ok: 0.06 },
  avgSessionSec: { great: 600, ok: 240 },
} as const;

export type Grade = 'great' | 'ok' | 'low' | 'unknown';

export function grade(metric: keyof typeof BENCHMARKS, value: number | null): Grade {
  if (value == null) return 'unknown';
  const b = BENCHMARKS[metric];
  return value >= b.great ? 'great' : value >= b.ok ? 'ok' : 'low';
}

export interface SparkVerdict {
  recommend: 'promote' | 'decline';
  /** The weakest KPI, used to pre-fill the written reason. */
  shortfall: { metric: keyof typeof BENCHMARKS; value: number | null } | null;
  reason: string;
}

const LABEL: Record<keyof typeof BENCHMARKS, string> = {
  conversion: 'Conversion (plays that reach 1 minute)',
  d1: 'Day-1 retention',
  avgSessionSec: 'Average session length',
};

const ADVICE: Record<keyof typeof BENCHMARKS, string> = {
  conversion: 'Get players into gameplay faster: shorten loading, skip long intros and show the core loop in the first 30 seconds.',
  d1: 'Give players a reason to return: daily goals, unlocks, saved progress (link accounts through the SDK) and a clear next objective.',
  avgSessionSec: 'Lengthen sessions with a smoother difficulty curve, more levels or modes, and fewer dead ends after a loss.',
};

const fmt = (metric: keyof typeof BENCHMARKS, v: number | null) =>
  v == null ? 'not enough data' : metric === 'avgSessionSec' ? `${Math.round(v / 60)} min` : `${Math.round(v * 100)}%`;

/** Suggests a Spark decision. Staff always write (or edit) the reason before deciding. */
export function sparkVerdict(summary: KpiSummary, usesSdk: boolean): SparkVerdict {
  const metrics: { metric: keyof typeof BENCHMARKS; value: number | null }[] = [
    { metric: 'conversion', value: summary.conversion },
    { metric: 'd1', value: summary.d1 },
    { metric: 'avgSessionSec', value: summary.avgSessionSec },
  ];
  const weak = metrics.filter((m) => grade(m.metric, m.value) === 'low' || m.value == null);
  if (!usesSdk) {
    return {
      recommend: 'decline',
      shortfall: null,
      reason: 'Rise Launch needs the Brainstorming SDK with gameplayStart and gameplayStop so we can measure real playtime and run ads. Integrate the SDK and submit a new version.',
    };
  }
  if (weak.length === 0) {
    const parts = metrics.map((m) => `${LABEL[m.metric]} ${fmt(m.metric, m.value)}`).join(', ');
    return { recommend: 'promote', shortfall: null, reason: `Players responded well during Spark: ${parts}. Welcome to Rise Launch.` };
  }
  const worst = weak.sort((a, b) => {
    const ratio = (m: { metric: keyof typeof BENCHMARKS; value: number | null }) => (m.value ?? 0) / BENCHMARKS[m.metric].ok;
    return ratio(a) - ratio(b);
  })[0]!;
  return {
    recommend: 'decline',
    shortfall: worst,
    reason: `${LABEL[worst.metric]} was ${fmt(worst.metric, worst.value)} against a target of ${fmt(worst.metric, BENCHMARKS[worst.metric].ok)} or more. ${ADVICE[worst.metric]}`,
  };
}

/** CSV export of daily rows for the KPI page. */
export function kpisToCsv(days: readonly DailyKpi[]): string {
  const head = [
    'day', 'plays', 'players', 'new_players', 'conversion_1min', 'avg_session_sec', 'd1_retention', 'd7_retention',
    'ad_impressions', 'likes', 'dislikes', 'load_ms_p50', 'load_ms_p90',
  ];
  const cell = (v: number | null) => (v == null ? '' : String(Math.round(v * 10000) / 10000));
  const rows = days.map((d) =>
    [d.day, d.plays, d.players, d.newPlayers, cell(d.conversion1min), cell(d.avgSessionSec), cell(d.d1Retention),
      cell(d.d7Retention), d.adImpressions, d.likes, d.dislikes, cell(d.loadMsP50), cell(d.loadMsP90)].join(','),
  );
  return [head.join(','), ...rows].join('\n');
}
