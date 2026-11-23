import type { HouseAd } from '@brainstorming/sdk/host';
import { SOCIAL_LINKS } from '@/lib/config';

/**
 * Our own ad, shown wherever an ad can go while no ad network fills the space: the Brainstorming
 * Studios promo (the Marvel-free ending of the channel trailer, 8.7 s, 9:16) linking to the
 * YouTube channel. Files are in apps/web/public/promo/.
 */
export const HOUSE_AD: HouseAd & { tagline: string } = {
  video: '/promo/bs-promo-9x16.mp4',
  poster: '/promo/bs-promo-poster.jpg',
  href: SOCIAL_LINKS.youtube,
  title: 'Brainstorming Studios',
  tagline: 'Movie scenes vs real physics. Every scene gets a verdict.',
  cta: 'Watch on YouTube',
};
