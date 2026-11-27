import type { HouseAd, HouseTiming } from '@brainstorming/sdk/host';
import { SITE_URL, STUDIOS_YOUTUBE } from '@/lib/config';
import { getRepo } from '@/lib/data';
import type { PremiumPlan } from '@/lib/domain/premium';
import { gameHref } from '@/lib/format';
import { loadCountry } from '@/lib/hooks/useCountry';

/**
 * Who may see an ad. `kidSafe`: fine for children and school-safe mode (anything not marked is
 * treated as adults only). `countries`: ISO codes it is meant for (say an India-only offer);
 * leave it out for a general ad that shows everywhere.
 */
export interface Targeting {
  kidSafe: boolean;
  countries?: string[];
}

type TargetedAd = HouseAd & Targeting;

/**
 * Our own ads, shown wherever an ad can go while no ad network fills the space. Files are in
 * apps/web/public/promo/. Absolute URLs, because ads are drawn on the game page and the files
 * live on the player site.
 */
const abs = (path: string) => (typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString());

/** The Brainstorming Studios channel ad (16:9, 20 s). */
export const HOUSE_AD: TargetedAd & { tagline: string } = {
  kidSafe: true,
  video: '/promo/bs-ad-16x9.mp4',
  poster: '/promo/bs-ad-16x9-poster.jpg',
  href: STUDIOS_YOUTUBE,
  title: 'Brainstorming Studios',
  tagline: 'Movie scenes vs real physics. Every scene gets a verdict.',
  cta: 'Watch on YouTube',
};

/** The earlier vertical promo (9:16, 8.7 s), kept in the rotation for variety. */
export const VERTICAL_PROMO: TargetedAd = {
  kidSafe: true,
  video: '/promo/bs-promo-9x16.mp4',
  poster: '/promo/bs-promo-poster.jpg',
  href: STUDIOS_YOUTUBE,
  title: 'Brainstorming Studios',
  cta: 'Watch on YouTube',
};

let originals: TargetedAd[] = [];
let country: string | null = null;
let loading: Promise<void> | null = null;

/** BS Originals trailers join the rotation: each one links to its game. Loaded once per page. */
export function loadOriginalTrailers(): Promise<void> {
  void loadCountry().then((c) => (country = c));
  loading ??= getRepo()
    .then((repo) => repo.catalogue.list({ originals: true, limit: 24 }))
    .then((page) => {
      originals = page.items
        .filter((g) => g.preview?.url)
        .map((g) => ({
          video: g.preview!.url,
          poster: g.cover?.url ?? HOUSE_AD.poster,
          href: `${SITE_URL}${gameHref(g.slug)}`,
          title: g.title,
          cta: `Play ${g.title}`,
          // A game's trailer is fine for children when the game is school-safe.
          kidSafe: g.schoolSafe,
        }));
    })
    .catch(() => {});
  return loading;
}

/** Whether an ad may be shown to this viewer: kid-safe ads only for children, and country ads only in their countries. */
export function allowedFor(ad: Targeting, viewer: { kid: boolean; country: string | null }): boolean {
  if (viewer.kid && !ad.kidSafe) return false;
  if (ad.countries?.length) return Boolean(viewer.country && ad.countries.includes(viewer.country));
  return true;
}

/**
 * Everything in rotation right now for this viewer. `kid` is true for under-18 accounts and in
 * school-safe mode. The channel ad is listed twice, so it shows most often.
 */
export function houseAds(viewer: { kid: boolean } = { kid: false }): HouseAd[] {
  return [HOUSE_AD, HOUSE_AD, VERTICAL_PROMO, ...originals]
    .filter((a) => allowedFor(a, { kid: viewer.kid, country }))
    .map((a) => ({ ...a, video: abs(a.video), poster: abs(a.poster) }));
}

/**
 * How long our ads run for each plan. No plan: skip after 5 s, a reward after 15 s.
 * Lite: skip after 3 s, a reward after 10 s. Plus: skip after 2 s, rewards with no ad.
 * Max: no ads at all (rewards with no ad).
 */
export const AD_TIMING: Record<PremiumPlan | 'free', HouseTiming> = {
  free: { skipAfter: 5, rewardAfter: 15 },
  lite: { skipAfter: 3, rewardAfter: 10 },
  plus: { skipAfter: 2, rewardAfter: 0 },
  max: { skipAfter: 0, rewardAfter: 0 },
};
