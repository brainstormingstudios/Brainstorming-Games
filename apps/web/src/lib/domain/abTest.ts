/**
 * Thumbnail A/B tests. A game with two or more labelled landscape covers shows each visitor one
 * of them (always the same one), counts tile impressions and clicks per cover, and keeps the
 * cover with the best click-through rate once every cover has 1,000 impressions.
 * The same rule as `pick_ab_winners` in 0008_growth.sql.
 */
import { hashString } from './spark';

export const AB_MIN_IMPRESSIONS = 1000;

export interface VariantCounts {
  label: string;
  impressions: number;
  clicks: number;
}

/** The cover a visitor sees: stable for a visitor and game, even across visits. */
export function variantFor(visitorId: string, gameId: string, labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const sorted = [...labels].sort();
  return sorted[hashString(`${visitorId}:${gameId}`) % sorted.length]!;
}

export function clickRate(v: Pick<VariantCounts, 'impressions' | 'clicks'>): number | null {
  return v.impressions > 0 ? v.clicks / v.impressions : null;
}

/**
 * The winning label, or null while the test is still running (fewer than two covers, or a cover
 * below 1,000 impressions). Ties go to the earlier label.
 */
export function pickWinner(stats: readonly VariantCounts[], minImpressions = AB_MIN_IMPRESSIONS): string | null {
  if (stats.length < 2 || stats.some((s) => s.impressions < minImpressions)) return null;
  return [...stats].sort((a, b) => (clickRate(b) ?? -1) - (clickRate(a) ?? -1) || a.label.localeCompare(b.label))[0]!.label;
}
