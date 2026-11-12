/**
 * Domain types shared by the mock and Supabase data layers, the build snapshot and the UI.
 * Dates are ISO strings so every value survives JSON (static props, localStorage, postMessage).
 */

export type GameStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'spark'
  | 'rise'
  | 'featured'
  | 'paused'
  | 'removed';

/** Statuses a player can see and play. */
export const PUBLIC_STATUSES: readonly GameStatus[] = ['spark', 'rise', 'featured'];

export type Orientation = 'landscape' | 'portrait' | 'any';
export type Platform = 'desktop' | 'mobile' | 'tablet';

export type MediaKind =
  | 'cover_landscape'
  | 'cover_portrait'
  | 'cover_square'
  | 'preview_landscape'
  | 'preview_portrait';

export interface MediaAsset {
  kind: MediaKind;
  /** URL of the largest variant. Smaller ones swap the `-<width>.webp` suffix. */
  url: string;
  /** Widths available for responsive `srcset`. Empty for videos. */
  widths: number[];
  width: number;
  height: number;
  /** Tiny inline preview (data URL) shown while the real image loads. */
  placeholder: string | null;
  /** Thumbnail A/B test label (`A`, `B`, ...). `null` when the game has one cover. */
  variantLabel: string | null;
}

export interface ControlRow {
  action: string;
  keyboard: string;
  touch: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface StudioRef {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  isFirstParty: boolean;
  verified: boolean;
}

export interface GameStats {
  plays: number;
  plays7d: number;
  /** Bayesian rating out of 10 from the last 180 days. `null` until there are votes. */
  rating10: number | null;
  votes: number;
  likes: number;
  dislikes: number;
}

/** Everything a tile, rail or search result needs. */
export interface GameSummary {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  tags: string[];
  orientation: Orientation;
  platforms: Platform[];
  isMultiplayer: boolean;
  sizeBytes: number;
  initialLoadBytes: number | null;
  status: GameStatus;
  schoolSafe: boolean;
  releasedAt: string | null;
  updatedAt: string;
  /** When the current Spark Launch started, for the exposure rotation. */
  sparkStartedAt: string | null;
  studio: StudioRef;
  cover: MediaAsset | null;
  coverPortrait: MediaAsset | null;
  coverSquare: MediaAsset | null;
  preview: MediaAsset | null;
  previewPortrait: MediaAsset | null;
  /** Extra landscape covers taking part in a thumbnail A/B test. */
  coverVariants: MediaAsset[];
  stats: GameStats;
  versionId: string | null;
  version: string | null;
  /** Path of the build on the play origin: `<gameId>/<version>/index.html`. */
  playPath: string | null;
  usesSdk: boolean;
}

export interface DevlogSummary {
  id: string;
  title: string;
  bodyMd: string;
  publishedAt: string;
}

/** The full game page. */
export interface GameDetail extends GameSummary {
  descriptionMd: string;
  howToPlayMd: string;
  controls: ControlRow[];
  faq: FaqItem[];
  featuresMd: string;
  tipsMd: string;
  engine: string | null;
  hasProgress: boolean;
  exclusiveUntil: string | null;
  createdAt: string;
  devlogs: DevlogSummary[];
}

export interface StudioDetail extends StudioRef {
  bio: string;
  avatarUrl: string | null;
  links: { label: string; url: string }[];
  level: 'rookie' | 'pro' | 'partner';
  followers: number;
  createdAt: string;
}

export type SortOrder = 'popular' | 'trending' | 'new' | 'updated' | 'rating';

export interface GameQuery {
  category?: string;
  tag?: string;
  studioSlug?: string;
  multiplayer?: boolean;
  /** Games that list a mobile platform. */
  mobile?: boolean;
  /** Upper bound on build size in bytes. */
  maxSize?: number;
  /** Released within this many days. */
  newWithinDays?: number;
  originals?: boolean;
  schoolSafeOnly?: boolean;
  status?: GameStatus[];
  sort?: SortOrder;
  offset?: number;
  limit?: number;
  /**
   * Only games changed after this ISO time, including ones that stopped being public (so a
   * pre-rendered list can drop them).
   */
  changedSince?: string;
}

export interface GamePage {
  items: GameSummary[];
  /** Total matches when the source can count them cheaply. */
  total: number | null;
}

/** Editorial configuration of the homepage, edited in the admin console. */
export interface SiteConfig {
  heroGameIds: string[];
  featuredGameIds: string[];
  railOrder: RailId[];
  hiddenRails: RailId[];
}

export type RailId =
  | 'fresh'
  | 'trending'
  | 'new'
  | 'originals'
  | 'multiplayer'
  | 'made-in-india'
  | 'under-10mb'
  | 'updated'
  | 'top-rated';

export const DEFAULT_RAIL_ORDER: RailId[] = [
  'trending',
  'fresh',
  'new',
  'originals',
  'multiplayer',
  'made-in-india',
  'under-10mb',
  'updated',
  'top-rated',
];

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  heroGameIds: [],
  featuredGameIds: [],
  railOrder: DEFAULT_RAIL_ORDER,
  hiddenRails: [],
};

/** What `scripts/build-catalogue.ts` writes and pages pre-render from. */
export interface CatalogueSnapshot {
  generatedAt: string;
  source: 'empty' | 'fixture' | 'supabase';
  games: GameDetail[];
  studios: StudioDetail[];
  config: SiteConfig;
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

export type RatingValue = 1 | -1;

export const DISLIKE_REASONS = [
  'bugs',
  'slow',
  'boring',
  'hard',
  'controls',
  'ads',
  'not-my-type',
] as const;
export type DislikeReason = (typeof DISLIKE_REASONS)[number];

export interface MyRating {
  value: RatingValue;
  reason: DislikeReason | null;
}

export interface HistoryEntry {
  gameId: string;
  slug: string;
  lastPlayedAt: string;
  playCount: number;
  secondsPlayed: number;
}

export const FEEDBACK_CATEGORIES = ['bug', 'wont-load', 'controls', 'content', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface FeedbackInput {
  gameId: string;
  versionId: string | null;
  category: FeedbackCategory;
  message: string;
  /** Game context set through the SDK (`BG.game.setContext`). */
  context: Record<string, unknown> | null;
  device: string;
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export const EVENT_TYPES = [
  'page_view',
  'play_click',
  'loading_start',
  'loading_stop',
  'gameplay_start',
  'gameplay_stop',
  'ad_requested',
  'ad_started',
  'ad_finished',
  'ad_error',
  'rewarded_granted',
  'session_end',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventInput {
  type: EventType;
  ts: string;
  sessionId: string | null;
  gameId: string | null;
  versionId: string | null;
  payload: Record<string, unknown>;
}

export type DeviceClass = 'desktop' | 'mobile' | 'tablet';
