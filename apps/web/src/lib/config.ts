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

/**
 * Each game's own origin, e.g. `https://{game}.bgplay.net` (see lib/play/gameOrigin.ts). Locally
 * every game gets `http://{game}.localhost:4100`. The live build refuses to start without it.
 */
export const GAME_ORIGIN_PATTERN = trim(
  process.env.NEXT_PUBLIC_GAME_ORIGIN_PATTERN,
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(PLAY_ORIGIN) ? `http://{game}.localhost:${PLAY_ORIGIN.split(':').pop()}` : '',
);

export const SUPABASE_URL = trim(process.env.NEXT_PUBLIC_SUPABASE_URL, '');
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** No Supabase URL means the whole app runs on the in-browser mock data layer. */
export const IS_MOCK = SUPABASE_URL === '';

/**
 * The product is three separate sites built from this codebase: the player site, the developer
 * portal and the management portal. Each build is one of them (`NEXT_PUBLIC_BG_SITE`).
 */
export type SiteId = 'play' | 'developers' | 'manage';
const site = process.env.NEXT_PUBLIC_BG_SITE;
export const SITE: SiteId = site === 'developers' || site === 'manage' ? site : 'play';
export const DEVELOPERS_URL = trim(process.env.NEXT_PUBLIC_DEVELOPERS_URL, 'http://localhost:3001');
/**
 * The management portal's address exists only in the management build. The player site and the
 * developer portal never contain it (no link, no address in their code); staff open it from
 * their own bookmark, and Cloudflare Access guards it (docs/DEPLOY.md, "Management portal").
 */
// Compared on the raw build setting (inlined as a constant), so the minifier removes the address
// entirely from the other two builds.
export const MANAGE_URL = process.env.NEXT_PUBLIC_BG_SITE === 'manage' ? trim(process.env.NEXT_PUBLIC_MANAGE_URL, 'http://localhost:3002') : '';

/**
 * Live site: the parent domain shared by the three sites (for example `.brainstorming.games`).
 * When set, the sign-in is kept in a cookie on that domain, so signing in once covers the player
 * site and both portals. The game origin must NOT be under this domain (games could read it);
 * `scripts/postbuild.mjs` refuses to build otherwise. Empty: each site keeps its own sign-in.
 */
export const AUTH_COOKIE_DOMAIN = (process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN ?? '').trim();

/**
 * In mock mode on a developer machine the three sites are three origins, so the mock tables live
 * in the local services process (`scripts/dev-services.mjs`) instead of one origin's localStorage.
 * Empty anywhere else: the mock then falls back to localStorage.
 */
export const MOCK_DB_URL =
  IS_MOCK && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PLAY_ORIGIN) ? `${PLAY_ORIGIN}/__mock/db` : '';

export const ADSENSE_CLIENT = (process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? '').trim();
/**
 * In-game ad provider: `house` (our own promo, the default on the live site) | `adsense-h5` (Google
 * H5 games ads once approved, with the house ad filling any empty break) | `mock` | `none`.
 * Adding another network later is one adapter in packages/sdk/src/ads and one line in makeProvider.
 */
export const INGAME_AD_PROVIDER = (process.env.NEXT_PUBLIC_INGAME_ADS || (IS_MOCK ? 'mock' : 'house')).trim();

export const EVENTS_TRANSPORT: 'function' | 'rpc' =
  process.env.NEXT_PUBLIC_EVENTS_TRANSPORT === 'rpc' ? 'rpc' : 'function';

export const CF_ANALYTICS_TOKEN = (process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN ?? '').trim();
export const POSTHOG_KEY = (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim();
export const SENTRY_DSN = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim();

/**
 * Mock mode only: e-mail addresses that are owners of the site and get the admin role when they
 * sign in (comma separated, from `NEXT_PUBLIC_OWNER_EMAILS` in .env.local). On the live site the
 * role is stored in the database instead: see docs/DATABASE.md.
 */
export const OWNER_EMAILS = (process.env.NEXT_PUBLIC_OWNER_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Google sign-in: the OAuth client id from Google Cloud (free). With it, the "Continue with Google"
 * button is Google's own, and the same Google account always opens the same Brainstorming account.
 */
export const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
/** Cloudflare Turnstile site key: the bot check before a sign-in e-mail is sent. Empty = off. */
export const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();

/** Payments: Razorpay's public key id. Empty means the local test checkout (no money moves). */
export const RAZORPAY_KEY_ID = (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '').trim();
/** Payments work: Razorpay is set up (live), or the local test checkout (mock). Buy buttons wait otherwise. */
export const PAYMENTS_LIVE = IS_MOCK || Boolean(RAZORPAY_KEY_ID);

/** ISO time of this build. Games changed after it are fetched live on the client. */
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '1970-01-01T00:00:00.000Z';

/**
 * Games the build itself contains are those released before this time. The local build reads its
 * catalogue from the local database at run time, never at build time, so for it nothing is in the
 * build: every game is fetched live and opened through the client fallback page.
 */
export const PRERENDERED_UNTIL = IS_MOCK ? '1970-01-01T00:00:00.000Z' : BUILD_TIME;

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
  previewMaxSeconds: 30,
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
  youtube: (process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE ?? '').trim() || 'https://www.youtube.com/@BrainstormingStudios-Official',
  instagram: (process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM ?? '').trim(),
  x: (process.env.NEXT_PUBLIC_SOCIAL_X ?? '').trim(),
  discord: (process.env.NEXT_PUBLIC_SOCIAL_DISCORD ?? '').trim(),
} as const;

/** The official address: shown on the Contact page and used as the sender of automated e-mails. */
export const CONTACT_EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim() || 'brainstormingstudios26@gmail.com';

/** Current version of the developer terms; recorded when a studio accepts them. */
export const DEVELOPER_TERMS_VERSION = '2026-11-1';
