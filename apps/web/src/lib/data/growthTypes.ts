/** Types for the growth features: devlog feed, studio follows, thumbnail tests, playtests, jams, moderation. */
import type { RankInputs } from '@/lib/domain/ranking';
import type { GameStatus, GameSummary } from './types';

/** What the discovery algorithm knows about one game, and the score it gives. */
export interface DiscoveryReport {
  gameId: string;
  inputs: RankInputs;
  /** Brain Rank, 0 to 100. */
  score: number;
  /** Tile impressions and clicks per day, oldest first (30 days). */
  byDay: { day: string; impressions: number; clicks: number }[];
}

export interface DiscoveryRow extends DiscoveryReport {
  slug: string;
  title: string;
  studioName: string;
  status: GameStatus;
}

/** The management portal's overview of the whole site. */
export interface SiteStats {
  players7d: number;
  plays7d: number;
  playsToday: number;
  impressions7d: number;
  accounts: number;
  studios: number;
  gamesByStatus: Partial<Record<GameStatus, number>>;
  inReview: number;
  openReports: number;
  /** Plays and tile impressions per day, oldest first (30 days). */
  byDay: { day: string; plays: number; players: number; impressions: number }[];
}

/** Size of the database, for the management portal's database page. */
export interface DatabaseStats {
  /** "PostgreSQL 15.x" on the live site, or the local test store in mock mode. */
  engine: string;
  totalBytes: number;
  /** Plan limit to compare against, when known. */
  limitBytes: number | null;
  connections: number | null;
  tables: { name: string; rows: number; bytes: number }[];
}

export interface DevlogPost {
  id: string;
  studioSlug: string;
  studioName: string;
  gameSlug: string | null;
  gameTitle: string | null;
  title: string;
  bodyMd: string;
  publishedAt: string;
}

/** One batch row of tile impressions and clicks for a cover taking part in a thumbnail test. */
export interface VariantHit {
  gameId: string;
  variant: string;
  impressions: number;
  clicks: number;
}

export interface VariantStat {
  label: string;
  impressions: number;
  clicks: number;
  winner: boolean;
  decided: boolean;
}

export interface PlaytestAnswers {
  /** 1 (not fun) to 5 (loved it). */
  fun: number;
  /** 1 (confusing) to 5 (clear straight away). */
  clarity: number;
  playAgain: boolean;
}

export interface PlaytestSummary {
  responses: number;
  fun: number | null;
  clarity: number | null;
  /** Share of testers who would play again, 0 to 1. */
  playAgain: number | null;
}

export type JamStatus = 'draft' | 'published' | 'closed';

export interface Jam {
  id: string;
  slug: string;
  title: string;
  theme: string;
  descriptionMd: string;
  startsAt: string;
  endsAt: string;
  status: JamStatus;
  entries: number;
}

export interface JamEntry {
  gameId: string;
  studioName: string;
  rank: number | null;
  submittedAt: string;
  /** Null while the game is not public (still in review). */
  game: GameSummary | null;
}

export interface JamDetail extends Jam {
  entryList: JamEntry[];
}

export interface JamInput {
  id?: string;
  slug: string;
  title: string;
  theme: string;
  descriptionMd: string;
  startsAt: string;
  endsAt: string;
  status: JamStatus;
}

export const REPORT_KINDS = ['abuse', 'username', 'studio', 'devlog', 'game', 'score'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportInput {
  kind: ReportKind;
  targetType: 'user' | 'studio' | 'devlog' | 'game';
  targetId: string;
  reason: string;
}

export interface ReportRecord {
  id: string;
  kind: ReportKind;
  targetType: string;
  targetId: string;
  /** A readable name for the target (username, studio name, devlog title, game title). */
  targetLabel: string;
  reason: string;
  status: 'open' | 'actioned' | 'dismissed';
  createdAt: string;
}

export interface AdminUserRow {
  id: string;
  username: string;
  displayName: string;
  role: 'player' | 'moderator' | 'admin';
  banned: boolean;
  isMinor: boolean;
  createdAt: string;
}

export interface AdminStudioRow {
  id: string;
  slug: string;
  name: string;
  verified: boolean;
  suspended: boolean;
}

export interface AdminDevlogRow {
  id: string;
  title: string;
  studioName: string;
  publishedAt: string;
  hidden: boolean;
}

export interface AdminQuest {
  code: string;
  period: 'daily' | 'weekly';
  title: string;
  target: number;
  reward: number;
  active: boolean;
}

export interface AdminCosmetic {
  id: string;
  slot: string;
  code: string;
  name: string;
  cost: number;
  minLevel: number;
  active: boolean;
}

/** Whether entries can be added now. */
export function jamIsOpen(jam: Pick<Jam, 'status' | 'startsAt' | 'endsAt'>, now: Date = new Date()): boolean {
  const t = now.toISOString();
  return jam.status === 'published' && jam.startsAt <= t && t <= jam.endsAt;
}

export function jamPhase(jam: Pick<Jam, 'status' | 'startsAt' | 'endsAt'>, now: Date = new Date()): 'upcoming' | 'open' | 'ended' {
  const t = now.toISOString();
  if (jam.status === 'closed' || jam.endsAt < t) return 'ended';
  return jam.startsAt > t ? 'upcoming' : 'open';
}
