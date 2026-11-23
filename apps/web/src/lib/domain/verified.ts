/**
 * The Verified tick for studios (migration 0027). Prices are in paise.
 * - Paid: ₹49 for 30 days or ₹399 for 365 days, extending from the later of now and the current end.
 * - Founding studios: the first 100 studios get it free for their first year.
 * - The house studio (BrainStorming Studios) wears its own "BS Official" badge instead.
 * Benefits: the tick, a 24-hour review promise instead of 72, a "Verified studios" row on the
 * home page and one free Spotlight Boost a month.
 */
export const VERIFIED_PLANS = {
  month: { price: 4900, days: 30 },
  year: { price: 39900, days: 365 },
} as const;
export type VerifiedPlan = keyof typeof VERIFIED_PLANS;

export const FOUNDING_STUDIOS = 100;
export const FOUNDING_DAYS = 365;
export const VERIFIED_REVIEW_HOURS = 24;

export interface VerifiedStatus {
  verified: boolean;
  /** Why the tick is on: a founding studio, a paid tick, or set by staff (never ends). */
  source: 'founding' | 'paid' | 'staff' | null;
  until: string | null;
  foundingNumber: number | null;
  /** The house studio: shown as BS Official, its games are BS Originals. */
  firstParty: boolean;
}

/** Extends a paid tick from the later of now and the current end. */
export function extendVerifiedUntil(current: string | null, plan: VerifiedPlan, now = Date.now()): string {
  const from = Math.max(now, current ? new Date(current).getTime() : 0);
  return new Date(from + VERIFIED_PLANS[plan].days * 86_400_000).toISOString();
}
