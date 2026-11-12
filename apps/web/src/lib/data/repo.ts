/**
 * The one repository interface. Every screen talks to the data layer through this shape, and
 * there are exactly two implementations: `mock` (localStorage, zero setup) and `supabase`.
 *
 * Rules for implementers:
 *   - Never throw for "not found": return null or an empty list.
 *   - Throw `RepoError` with a stable `code` for failures the UI should explain.
 *   - Emit the matching bus topic after every mutation so open screens refresh.
 */
import type {
  DeviceClass,
  DislikeReason,
  EventInput,
  FeedbackInput,
  GameDetail,
  GamePage,
  GameQuery,
  GameStats,
  GameSummary,
  HistoryEntry,
  MyRating,
  RatingValue,
  SiteConfig,
  StudioDetail,
} from './types';

export type RepoErrorCode =
  | 'rate_limited'
  | 'not_allowed'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'login_required'
  | 'unavailable';

export class RepoError extends Error {
  readonly code: RepoErrorCode;
  constructor(code: RepoErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RepoError';
    this.code = code;
  }
}

export interface CatalogueRepo {
  /** Public games matching a query, sorted and paged. */
  list(query?: GameQuery): Promise<GamePage>;
  get(slug: string): Promise<GameDetail | null>;
  /** Several games by id, in the order given. Unknown or non-public ids are skipped. */
  byIds(ids: string[]): Promise<GameSummary[]>;
  studio(slug: string): Promise<StudioDetail | null>;
  search(text: string, limit?: number): Promise<GameSummary[]>;
  siteConfig(): Promise<SiteConfig>;
}

export interface PlayerRepo {
  myRating(gameId: string): Promise<MyRating | null>;
  /** `0` removes the vote. Resolves with the game's updated counters. */
  rate(gameId: string, value: RatingValue | 0, reason?: DislikeReason | null): Promise<GameStats>;
  favourites(): Promise<string[]>;
  setFavourite(gameId: string, on: boolean): Promise<void>;
  history(): Promise<HistoryEntry[]>;
  recordPlay(game: { id: string; slug: string }, seconds: number, newSession: boolean): Promise<void>;
  clearHistory(): Promise<void>;
  sendFeedback(input: FeedbackInput): Promise<void>;
}

export interface EventContext {
  anonId: string;
  device: DeviceClass;
  /** Studio slug from a `?ref=` link, if this visitor arrived through one. */
  refStudio: string | null;
}

export interface EventsRepo {
  ingest(batch: EventInput[], context: EventContext): Promise<void>;
  /** Best-effort delivery while the page is closing. */
  ingestOnUnload(batch: EventInput[], context: EventContext): void;
}

export interface Repo {
  readonly mode: 'mock' | 'supabase';
  catalogue: CatalogueRepo;
  player: PlayerRepo;
  events: EventsRepo;
}
