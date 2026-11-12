/**
 * The mock "database": typed tables kept in localStorage, shared by every tab of this browser.
 * It starts with no games. Each read parses the stored JSON so a write from another tab is seen
 * straight away.
 */
import { local, uuid } from '../local';
import { RepoError, type RepoErrorCode } from '../repo';
import {
  DEFAULT_SITE_CONFIG,
  type ControlRow,
  type EventType,
  type FaqItem,
  type FeedbackInput,
  type GameStatus,
  type MediaAsset,
  type Orientation,
  type Platform,
  type SiteConfig,
} from '../types';

const PREFIX = 'bg.mock.v1.';

export interface MockStudio {
  id: string;
  ownerId: string | null;
  slug: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  country: string | null;
  contactEmail: string | null;
  links: { label: string; url: string }[];
  verified: boolean;
  isFirstParty: boolean;
  level: 'rookie' | 'pro' | 'partner';
  suspendedAt: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  guardianName: string | null;
  createdAt: string;
}

export interface MockGame {
  id: string;
  studioId: string;
  slug: string;
  title: string;
  shortDescription: string;
  descriptionMd: string;
  howToPlayMd: string;
  controls: ControlRow[];
  faq: FaqItem[];
  featuresMd: string;
  tipsMd: string;
  category: string;
  tags: string[];
  orientation: Orientation;
  platforms: Platform[];
  engine: string | null;
  isMultiplayer: boolean;
  hasProgress: boolean;
  schoolSafe: boolean;
  sizeBytes: number;
  initialLoadBytes: number | null;
  status: GameStatus;
  sparkStartedAt: string | null;
  riseStartedAt: string | null;
  exclusiveUntil: string | null;
  currentVersionId: string | null;
  maxScorePerSec: number | null;
  wantsExclusive?: boolean;
  createdAt: string;
  releasedAt: string | null;
  updatedAt: string;
}

export interface MockVersion {
  id: string;
  gameId: string;
  version: string;
  storagePrefix: string;
  fileCount: number;
  totalBytes: number;
  entryFile: string;
  usesSdk: boolean;
  preQaReport: unknown | null;
  qaStatus: string;
  qaNotes: string | null;
  previewToken: string;
  minorUpdate?: boolean;
  createdAt: string;
}

export interface MockMedia extends MediaAsset {
  id: string;
  gameId: string;
  isActive: boolean;
  createdAt: string;
}

export interface MockRating {
  voterKey: string;
  gameId: string;
  value: 1 | -1;
  reason: string | null;
  createdAt: string;
}

export interface MockEvent {
  id: string;
  anonId: string;
  userId: string | null;
  sessionId: string | null;
  gameId: string | null;
  versionId: string | null;
  type: EventType;
  ts: string;
  payload: Record<string, unknown>;
  country: string | null;
  device: string;
  refStudio: string | null;
}

export interface MockGameStats {
  gameId: string;
  plays: number;
  /** Plays per UTC day (`YYYY-MM-DD`), trimmed to the last 30 days. */
  playsByDay: Record<string, number>;
}

export interface MockFeedback extends FeedbackInput {
  id: string;
  reporterKey: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface MockUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  birthYear: number | null;
  isMinor: boolean;
  consent: 'not_required' | 'pending' | 'granted' | 'denied';
  role: 'player' | 'moderator' | 'admin';
  brainPoints: number;
  level: number;
  streakDays: number;
  streakLastDay: string | null;
  avatar: Record<string, string>;
  profilePublic: boolean;
  playtestOptIn: boolean;
  schoolSafe: boolean;
  lowData: boolean;
  locale: string;
  lastActive: string | null;
  bannedAt: string | null;
  createdAt: string;
}

export interface MockConsent {
  token: string;
  userId: string;
  status: 'pending' | 'granted' | 'denied';
  requestedAt: string;
  expiresAt: string;
}

export interface MockReview {
  id: string;
  versionId: string;
  gameId: string;
  reviewerId: string;
  action: 'approve' | 'changes' | 'reject';
  checklist: Record<string, boolean>;
  notes: string;
  createdAt: string;
}

export interface MockLaunch {
  id: string;
  gameId: string;
  tier: 'spark' | 'rise' | 'featured';
  startedAt: string;
  endedAt: string | null;
  decision: 'promoted' | 'declined' | null;
  reason: string | null;
  kpiSnapshot: Record<string, unknown> | null;
  decidedBy: string | null;
}

export interface MockAudit {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface MockDevlog {
  id: string;
  studioId: string;
  gameId: string | null;
  title: string;
  bodyMd: string;
  publishedAt: string;
  hiddenAt: string | null;
}

export interface MockNotification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MockTables {
  studios: MockStudio[];
  games: MockGame[];
  versions: MockVersion[];
  media: MockMedia[];
  ratings: MockRating[];
  events: MockEvent[];
  gameStats: MockGameStats[];
  feedback: MockFeedback[];
  siteConfig: SiteConfig[];
  rateLimits: { key: string; tokens: number; updatedAt: number }[];
  users: MockUser[];
  consents: MockConsent[];
  reviews: MockReview[];
  launches: MockLaunch[];
  audit: MockAudit[];
  devlogs: MockDevlog[];
  notifications: MockNotification[];
  cloudSaves: { userId: string; gameId: string; key: string; value: unknown; updatedAt: string }[];
  playSessions: { id: string; userId: string | null; gameId: string; startedAt: string }[];
  leaderboards: { id: string; gameId: string; key: string; sortDesc: boolean; maxScorePerSec: number | null }[];
  scores: { id: string; boardId: string; userId: string; score: number; flagged: boolean; createdAt: string }[];
  questEvents: { userId: string; event: string; value: number; at: string }[];
  friendships: { requester: string; addressee: string; status: 'pending' | 'accepted'; createdAt: string }[];
  referralVisits: { studioSlug: string; anonId: string; at: string }[];
}

export type TableName = keyof MockTables;

/** Caps so a long session never fills the 5 MB localStorage quota. */
const CAPS: Partial<Record<TableName, number>> = {
  events: 4000,
  feedback: 500,
  audit: 1000,
  notifications: 500,
  scores: 2000,
  questEvents: 2000,
  referralVisits: 2000,
};

/** Mock "server" errors carry the same codes as the Postgres functions. */
export function fail(code: RepoErrorCode, message?: string): never {
  throw new RepoError(code, message);
}

export function audit(actorId: string | null, action: string, targetType: string, targetId: string, detail: Record<string, unknown> = {}): void {
  mutateTable('audit', (rows) => {
    rows.push({ id: newId(), actorId, action, targetType, targetId, detail, createdAt: nowIso() });
  });
}

export function notify(userId: string | null | undefined, kind: string, title: string, body = '', link: string | null = null): void {
  if (!userId) return;
  mutateTable('notifications', (rows) => {
    rows.push({ id: newId(), userId, kind, title, body, link, readAt: null, createdAt: nowIso() });
  });
}

export function readTable<K extends TableName>(name: K): MockTables[K] {
  const rows = local.get<MockTables[K] | null>(PREFIX + name, null);
  return Array.isArray(rows) ? rows : ([] as unknown as MockTables[K]);
}

export function writeTable<K extends TableName>(name: K, rows: MockTables[K]): void {
  const cap = CAPS[name];
  const trimmed = cap && rows.length > cap ? (rows.slice(rows.length - cap) as MockTables[K]) : rows;
  local.set(PREFIX + name, trimmed);
}

/** Read-modify-write. The callback may mutate the array or return a new one. */
export function mutateTable<K extends TableName>(
  name: K,
  fn: (rows: MockTables[K]) => MockTables[K] | void,
): MockTables[K] {
  const rows = readTable(name);
  const next = fn(rows) ?? rows;
  writeTable(name, next);
  return next;
}

export function readSiteConfig(): SiteConfig {
  return { ...DEFAULT_SITE_CONFIG, ...(readTable('siteConfig')[0] ?? {}) };
}

export function writeSiteConfig(config: SiteConfig): void {
  writeTable('siteConfig', [config]);
}

/** Wipes the whole mock database (used by tests and the "reset mock data" button). */
export function resetMockDb(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing to reset
  }
}

/**
 * Postgres-style token bucket. `capacity` tokens refill over `windowMs`; each call spends one.
 * Returns false when the caller should be rate limited.
 */
export function takeToken(key: string, capacity: number, windowMs: number): boolean {
  const now = Date.now();
  let allowed = true;
  mutateTable('rateLimits', (rows) => {
    const fresh = rows.filter((r) => now - r.updatedAt < windowMs * 4);
    let row = fresh.find((r) => r.key === key);
    if (!row) {
      row = { key, tokens: capacity, updatedAt: now };
      fresh.push(row);
    }
    const refill = ((now - row.updatedAt) / windowMs) * capacity;
    row.tokens = Math.min(capacity, row.tokens + refill);
    row.updatedAt = now;
    if (row.tokens < 1) allowed = false;
    else row.tokens -= 1;
    return fresh;
  });
  return allowed;
}

export const newId = uuid;
export const nowIso = () => new Date().toISOString();
export const dayKey = (d: Date | string = new Date()) => new Date(d).toISOString().slice(0, 10);
