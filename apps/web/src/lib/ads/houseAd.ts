import type { HouseAd, HouseTiming } from '@brainstorming/sdk/host';
import { SITE_URL, SOCIAL_LINKS } from '@/lib/config';
import { getRepo } from '@/lib/data';
import type { PremiumPlan } from '@/lib/domain/premium';
import { gameHref } from '@/lib/format';

/**
 * Our own ads, shown wherever an ad can go while no ad network fills the space. Files are in
 * apps/web/public/promo/. Absolute URLs, because ads are drawn on the game page and the files
 * live on the player site.
 */
const abs = (path: string) => (typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString());

/** The Brainstorming Studios channel ad (16:9, 20 s). */
export const HOUSE_AD: HouseAd & { tagline: string } = {
  video: '/promo/bs-ad-16x9.mp4',
  poster: '/promo/bs-ad-16x9-poster.jpg',
  href: SOCIAL_LINKS.youtube,
  title: 'Brainstorming Studios',
  tagline: 'Movie scenes vs real physics. Every scene gets a verdict.',
  cta: 'Watch on YouTube',
};

/** The earlier vertical promo (9:16, 8.7 s), kept in the rotation for variety. */
export const VERTICAL_PROMO: HouseAd = {
  video: '/promo/bs-promo-9x16.mp4',
  poster: '/promo/bs-promo-poster.jpg',
  href: SOCIAL_LINKS.youtube,
  title: 'Brainstorming Studios',
  cta: 'Watch on YouTube',
};

let originals: HouseAd[] = [];
let loading: Promise<void> | null = null;

/** BS Originals trailers join the rotation: each one links to its game. Loaded once per page. */
export function loadOriginalTrailers(): Promise<void> {
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
        }));
    })
    .catch(() => {});
  return loading;
}

/** Everything in rotation right now. The channel ad is listed twice, so it shows most often. */
export function houseAds(): HouseAd[] {
  return [HOUSE_AD, HOUSE_AD, VERTICAL_PROMO, ...originals].map((a) => ({ ...a, video: abs(a.video), poster: abs(a.poster) }));
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
