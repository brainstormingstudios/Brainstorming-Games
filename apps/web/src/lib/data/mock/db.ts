/**
 * The mock "database": typed tables kept in localStorage, shared by every tab of this browser.
 * It starts with no games. Each read parses the stored JSON so a write from another tab is seen
 * straight away.
 */
import { local, uuid } from '../local';
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
}

export type TableName = keyof MockTables;

/** Caps so a long session never fills the 5 MB localStorage quota. */
const CAPS: Partial<Record<TableName, number>> = { events: 4000, feedback: 500 };

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
