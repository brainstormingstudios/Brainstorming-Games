/**
 * Site-wide constants and feature flags.
 * Every NEXT_PUBLIC_* value is read here and nowhere else, so the mock fallbacks live in one place.
 */

/** The mascot's name is still to be decided. Change it here only. */
export const MASCOT_NAME = 'Brainy';

export const SITE_NAME = 'Brainstorming Games';
export const STUDIO_NAME = 'Brainstorming Studios';
export const SITE_TAGLINE = 'Free games. Zero downloads. Play in one tap.';

const trim = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback).replace(/\/+$/, '');

/** Public origin of the site, no trailing slash. */
export const SITE_URL = trim(process.env.NEXT_PUBLIC_SITE_URL, 'http://localhost:3000');

/** Origin that serves game builds. It must differ from SITE_URL (games are sandboxed by origin). */
export const PLAY_ORIGIN = trim(process.env.NEXT_PUBLIC_PLAY_ORIGIN, 'http://localhost:4100');

export const SUPABASE_URL = trim(process.env.NEXT_PUBLIC_SUPABASE_URL, '');
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** No Supabase URL means the whole app runs on the in-browser mock data layer. */
export const IS_MOCK = SUPABASE_URL === '';

export const ADSENSE_CLIENT = (process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? '').trim();
/** In-game ad provider: `mock` | `adsense-h5` | `none`. */
export const INGAME_AD_PROVIDER = (process.env.NEXT_PUBLIC_INGAME_ADS ?? (IS_MOCK ? 'mock' : 'none')).trim();

export const EVENTS_TRANSPORT: 'function' | 'rpc' =
  process.env.NEXT_PUBLIC_EVENTS_TRANSPORT === 'rpc' ? 'rpc' : 'function';

export const CF_ANALYTICS_TOKEN = (process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN ?? '').trim();
export const POSTHOG_KEY = (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim();
export const SENTRY_DSN = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim();

/** ISO time of this build. Games changed after it are fetched live on the client. */
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '1970-01-01T00:00:00.000Z';

export const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Age gate (India DPDP Rules: under 18 needs verifiable parental consent).
 * We ask for a birth year only. `conservative` treats anyone who could still be 17 this year
 * (year difference of 18 or less) as a minor.
 */
export const AGE_GATE = {
  enabled: true,
  adultAge: 18,
  conservative: true,
  minBirthYear: 1900,
} as const;

/** Hero switches from the "publish your game" banner to the carousel at this many live games. */
export const HERO_MIN_GAMES = 3;

export const LIMITS = {
  shortDescription: 160,
  maxTags: 10,
  minFaq: 3,
  zipMaxBytes: 250 * 1024 * 1024,
  zipMaxFiles: 1500,
  previewMaxBytes: 50 * 1024 * 1024,
  previewMinSeconds: 15,
  previewMaxSeconds: 20,
  cloudSaveMaxBytes: 1024 * 1024,
  under10Mb: 10 * 1024 * 1024,
  adGridInterval: 24,
} as const;

export const COVER_SPECS = {
  cover_landscape: { width: 1920, height: 1080 },
  cover_portrait: { width: 800, height: 1200 },
  cover_square: { width: 800, height: 800 },
} as const;

export const COVER_WIDTHS = {
  cover_landscape: [320, 640, 960, 1280, 1920],
  cover_portrait: [200, 400, 800],
  cover_square: [200, 400, 800],
} as const;

export const SOCIAL_LINKS = {
  youtube: (process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE ?? '').trim(),
  instagram: (process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM ?? '').trim(),
  x: (process.env.NEXT_PUBLIC_SOCIAL_X ?? '').trim(),
  discord: (process.env.NEXT_PUBLIC_SOCIAL_DISCORD ?? '').trim(),
} as const;

export const CONTACT_EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim();

/** Current version of the developer terms; recorded when a studio accepts them. */
export const DEVELOPER_TERMS_VERSION = '2026-11-draft-1';
