/**
 * Brainstorming Premium (players) and Boost (developers): plans, prices and what each one does.
 * Money is in paise (₹1 = 100). Every number the site uses lives here.
 */

export type PremiumPlan = 'lite' | 'plus' | 'max';

/** The order the plans are shown in, cheapest first. Plus is the one we point people to. */
export const PLAN_ORDER: PremiumPlan[] = ['lite', 'plus', 'max'];
export const POPULAR_PLAN: PremiumPlan = 'plus';
export const PLAN_LABEL: Record<PremiumPlan, string> = { lite: 'Lite', plus: 'Plus', max: 'Max' };

export interface PlanDef {
  id: PremiumPlan;
  /** Monthly price in paise. */
  price: number;
  /** Display ads allowed on the player site. */
  displayAds: 'some' | 'none';
  /** In-game midgame ads: minimum gap and minimum gameplay before the first one. Null: none at all. */
  midgame: { cooldownMs: number; minGameplayMs: number } | null;
  /** Rewarded ads give their reward straight away, without an ad. */
  instantRewards: boolean;
  /** Brain Points multiplier on quest rewards. */
  pointsMultiplier: number;
  /** Guest passes per month (7 days of Plus for a friend). */
  guestPasses: number;
}

export const PLANS: Record<PremiumPlan, PlanDef> = {
  lite: {
    id: 'lite',
    price: 4900,
    displayAds: 'some',
    midgame: { cooldownMs: 6 * 60_000, minGameplayMs: 2 * 60_000 },
    instantRewards: false,
    pointsMultiplier: 1,
    guestPasses: 0,
  },
  plus: {
    id: 'plus',
    price: 9900,
    displayAds: 'none',
    midgame: { cooldownMs: 15 * 60_000, minGameplayMs: 5 * 60_000 },
    instantRewards: true,
    pointsMultiplier: 1,
    guestPasses: 0,
  },
  max: {
    id: 'max',
    price: 17900,
    displayAds: 'none',
    midgame: null,
    instantRewards: true,
    pointsMultiplier: 2,
    guestPasses: 2,
  },
};

/** Brain Point packs for real money (adults only; on sale once payments start). */
export const BP_PACKS = [
  { id: 'bp200', points: 200, price: 1900, best: false },
  { id: 'bp600', points: 600, price: 4900, best: false },
  { id: 'bp1400', points: 1400, price: 9900, best: true },
  { id: 'bp3000', points: 3000, price: 19900, best: false },
] as const;

/** How long a guest pass lasts, and which plan it gives. */
export const GUEST_PASS = { days: 7, plan: 'plus' as PremiumPlan };

export interface PremiumState {
  plan: PremiumPlan;
  /** ISO time the paid period (or pass) ends. */
  until: string;
  /** Renews by itself at `until` (a subscription), or simply ends (a pass, or cancelled). */
  autoRenew: boolean;
  /** Came from a guest pass rather than a payment. */
  fromPass: boolean;
}

/** The plan in force right now, or null. */
export function activePlan(p: PremiumState | null | undefined, now: Date = new Date()): PremiumPlan | null {
  return p && p.until > now.toISOString() ? p.plan : null;
}

/** Display-ad placements a player on this plan still sees. Lite keeps one, between homepage rails. */
export function showsDisplayAd(plan: PremiumPlan | null, placement: string): boolean {
  if (!plan) return true;
  if (PLANS[plan].displayAds === 'none') return false;
  return placement === 'home-rail';
}

export const formatInr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------------------------
// Boost: paid promotion of a game
// ---------------------------------------------------------------------------------------------

export type BoostPackage = 'spotlight' | 'push' | 'launch';

export interface BoostDef {
  id: BoostPackage;
  price: number;
  /** YouTube Shorts and Instagram Reels we make and post on the official channels. */
  shorts: number;
  reels: number;
  /** Days of sponsored placement in the rails (always labelled "Sponsored"). */
  sponsoredDays: number;
  /** Days in the homepage hero, at the start of the sponsored period. */
  heroDays: number;
}

export const BOOSTS: Record<BoostPackage, BoostDef> = {
  spotlight: { id: 'spotlight', price: 49900, shorts: 1, reels: 1, sponsoredDays: 3, heroDays: 0 },
  push: { id: 'push', price: 149900, shorts: 2, reels: 2, sponsoredDays: 7, heroDays: 0 },
  launch: { id: 'launch', price: 399900, shorts: 4, reels: 4, sponsoredDays: 14, heroDays: 2 },
};

export type BoostStatus = 'pending_payment' | 'paid' | 'live' | 'done' | 'cancelled';

/** A boosted game's promotion right now: in the rails, and in the hero. */
export interface Promo {
  /** ISO end of the sponsored placement. */
  until: string;
  /** ISO end of the hero placement, if the package has one. */
  heroUntil: string | null;
}

export const isPromoActive = (p: Promo | null | undefined, now: Date = new Date()) => Boolean(p && p.until > now.toISOString());
export const isHeroActive = (p: Promo | null | undefined, now: Date = new Date()) => Boolean(p?.heroUntil && p.heroUntil > now.toISOString());
