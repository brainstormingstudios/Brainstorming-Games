/**
 * Brain Rank: the discovery algorithm. One score from 0 to 100 per game decides who gets the
 * best shelf space ("Top picks", the default order of lists, the hero when nothing is pinned).
 *
 * It works like a video platform's recommender in miniature. Every tile shown is an impression.
 * The score asks, in this order of the funnel:
 *
 *   1. Click rate     do people who see the cover click it?            (clicks / impressions)
 *   2. Conversion     do people who click actually play?               (plays of 1 minute+ / plays)
 *   3. Playtime       do they stay?                                    (average session)
 *   4. Retention      do they come back tomorrow?                      (day-1 return rate)
 *   5. Rating         do they say they liked it?                       (likes / votes)
 *
 * Rules that keep it fair:
 *   - Every rate is smoothed towards a site average, so 3 clicks out of 4 impressions does not
 *     beat 700 out of 1,000. A game earns a strong score only with evidence.
 *   - A new game gets an exploration bonus that fades over its first 1,000 impressions: every
 *     submission is guaranteed a real audience before the numbers judge it.
 *   - A small freshness bonus fades over two weeks.
 *   - Nothing here can be bought, and ad revenue is not an input.
 *
 * The same formula is written in SQL (`app.rank_score` in 0011_discovery.sql); a unit test pins
 * the numbers so the two cannot drift.
 */

export interface RankInputs {
  /** Tile impressions in the last 14 days. */
  impressions: number;
  /** Tile clicks in the last 14 days. */
  clicks: number;
  /** Plays (Play pressed) in the last 14 days. */
  plays: number;
  /** Share of plays that lasted a minute or more, 0 to 1. */
  conversion: number | null;
  /** Average session length in seconds. */
  avgSessionSec: number | null;
  /** Share of new players who came back the next day, 0 to 1. */
  d1: number | null;
  likes: number;
  dislikes: number;
  /** Days since release. */
  ageDays: number;
}

export interface RankParts {
  clickRate: number;
  conversion: number;
  playtime: number;
  retention: number;
  rating: number;
  /** Bonus for games still inside their first 1,000 impressions. */
  exploration: number;
  freshness: number;
}

export const RANK = {
  weights: { clickRate: 0.25, conversion: 0.25, playtime: 0.25, retention: 0.15, rating: 0.1 },
  /** A value at or above the target earns the full part. */
  targets: { clickRate: 0.2, conversion: 0.8, avgSessionSec: 600, d1: 0.15 },
  /** Site averages that thin data is pulled towards, and how much evidence outweighs them. */
  priors: { clickRate: 0.08, clickWeight: 100, conversion: 0.5, playWeight: 20, avgSessionSec: 150, d1: 0.05, likeRatio: 0.75, voteWeight: 4 },
  explorationImpressions: 1000,
  explorationBonus: 0.15,
  freshnessBonus: 0.08,
  freshnessDays: 14,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Pulls an observed rate towards a prior; `n` observations against `weight` imaginary ones. */
const smooth = (value: number, n: number, prior: number, weight: number) => (value * n + prior * weight) / (n + weight);

/** Each part as a share (0 to 1) of what it can contribute. */
export function rankParts(i: RankInputs): RankParts {
  const { targets: t, priors: p } = RANK;
  const impressions = Math.max(0, i.impressions);
  const plays = Math.max(0, i.plays);
  const votes = Math.max(0, i.likes + i.dislikes);
  const ctr = smooth(impressions > 0 ? Math.min(i.clicks, impressions) / impressions : 0, impressions, p.clickRate, p.clickWeight);
  const conversion = smooth(i.conversion ?? p.conversion, i.conversion == null ? 0 : plays, p.conversion, p.playWeight);
  const session = smooth(i.avgSessionSec ?? p.avgSessionSec, i.avgSessionSec == null ? 0 : plays, p.avgSessionSec, p.playWeight);
  const d1 = smooth(i.d1 ?? p.d1, i.d1 == null ? 0 : plays, p.d1, p.playWeight);
  const liked = smooth(votes > 0 ? i.likes / votes : 0, votes, p.likeRatio, p.voteWeight);
  return {
    clickRate: clamp01(ctr / t.clickRate),
    conversion: clamp01(conversion / t.conversion),
    playtime: clamp01(session / t.avgSessionSec),
    retention: clamp01(d1 / t.d1),
    rating: clamp01(liked),
    exploration: clamp01(1 - impressions / RANK.explorationImpressions),
    freshness: Math.exp(-Math.max(0, i.ageDays) / RANK.freshnessDays),
  };
}

/** The score from 0 to 100, rounded to one decimal. */
export function rankScore(i: RankInputs): number {
  const p = rankParts(i);
  const w = RANK.weights;
  const quality = p.clickRate * w.clickRate + p.conversion * w.conversion + p.playtime * w.playtime + p.retention * w.retention + p.rating * w.rating;
  const total = quality + p.exploration * RANK.explorationBonus + p.freshness * RANK.freshnessBonus;
  return Math.round(clamp01(total) * 1000) / 10;
}

/** Points (out of 100) each part adds to the score, for the "why this score" breakdown. */
export function rankBreakdown(i: RankInputs): Record<keyof RankParts, number> {
  const p = rankParts(i);
  const w = RANK.weights;
  const r = (v: number) => Math.round(v * 1000) / 10;
  return {
    clickRate: r(p.clickRate * w.clickRate),
    conversion: r(p.conversion * w.conversion),
    playtime: r(p.playtime * w.playtime),
    retention: r(p.retention * w.retention),
    rating: r(p.rating * w.rating),
    exploration: r(p.exploration * RANK.explorationBonus),
    freshness: r(p.freshness * RANK.freshnessBonus),
  };
}

/** How many more impressions a game is still guaranteed before the bonus is gone. */
export const explorationLeft = (impressions: number) => Math.max(0, RANK.explorationImpressions - Math.max(0, impressions));
