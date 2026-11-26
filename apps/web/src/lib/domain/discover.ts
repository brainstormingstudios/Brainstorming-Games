/**
 * Discover & daily fun: the Rising chart, the daily challenge pick, and swapping Brain Points
 * for Premium days. Pure functions, unit-tested; the SQL in 0018_discover.sql follows the same rules.
 */

/** Answers needed before a game can enter the Rising chart. */
export const RISING_MIN_ANSWERS = 3;
/** Days of playtest answers the chart looks at. */
export const RISING_WINDOW_DAYS = 30;
/** Brain Points every Early Access tester gets when a game they rated reaches Full Launch. */
export const DISCOVERY_POINTS = 50;

/**
 * How much testers loved a game, 0 to 1: 60% fun (1 to 5 stars) and 40% "would play again",
 * pulled towards 0.5 when there are few answers so one enthusiastic tester cannot top the chart.
 */
export function risingScore(funAvg: number, playAgainRate: number, answers: number): number {
  if (answers <= 0) return 0;
  const raw = ((Math.min(5, Math.max(1, funAvg)) - 1) / 4) * 0.6 + Math.min(1, Math.max(0, playAgainRate)) * 0.4;
  const prior = 5;
  return Math.round(((raw * answers + 0.5 * prior) / (answers + prior)) * 1000) / 1000;
}

/** FNV-1a: a small, stable hash, so the same day always picks the same game everywhere. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Today's challenge from the candidates: the same for every player on the same (UTC) day. */
export function dailyPick<T extends { id: string }>(candidates: readonly T[], day: string): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => hash(`${a.id}|${day}`) - hash(`${b.id}|${day}`) || a.id.localeCompare(b.id))[0]!;
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Milliseconds until the next challenge (midnight UTC, 05:30 in India). */
export function msUntilNextDay(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

export type PointsOptionId = 'plus_1d' | 'plus_7d' | 'max_1d';
export interface PointsOption {
  id: PointsOptionId;
  plan: 'plus' | 'max';
  days: number;
  cost: number;
}
export const POINTS_OPTIONS: readonly PointsOption[] = [
  { id: 'plus_1d', plan: 'plus', days: 1, cost: 400 },
  { id: 'plus_7d', plan: 'plus', days: 7, cost: 2400 },
  { id: 'max_1d', plan: 'max', days: 1, cost: 800 },
];
/** Premium days a player can get with points in one calendar month. */
export const MAX_POINT_DAYS_PER_MONTH = 14;

export type RedeemProblem = 'unknown' | 'points' | 'monthly_limit' | 'other_plan';

/** Whether a swap is allowed, and the new end of the membership if it is. */
export function redeemCheck(
  optionId: string,
  state: { points: number; daysThisMonth: number; plan: 'lite' | 'plus' | 'max' | null; until: string | null },
  now = new Date(),
): { ok: true; option: PointsOption; until: string } | { ok: false; problem: RedeemProblem } {
  const option = POINTS_OPTIONS.find((o) => o.id === optionId);
  if (!option) return { ok: false, problem: 'unknown' };
  if (state.points < option.cost) return { ok: false, problem: 'points' };
  if (state.daysThisMonth + option.days > MAX_POINT_DAYS_PER_MONTH) return { ok: false, problem: 'monthly_limit' };
  const active = state.plan && state.until && new Date(state.until) > now ? state.plan : null;
  // Points extend the plan you have; they never swap a paid plan for another one.
  if (active && active !== option.plan) return { ok: false, problem: 'other_plan' };
  const from = active ? new Date(state.until!).getTime() : now.getTime();
  return { ok: true, option, until: new Date(from + option.days * 86_400_000).toISOString() };
}
