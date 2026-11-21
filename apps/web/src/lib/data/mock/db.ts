/**
 * The mock "database": typed tables kept in localStorage, shared by every tab of this browser.
 * It starts with no games. Each read parses the stored JSON so a write from another tab is seen
 * straight away.
 */
import type { Creator, CreatorMonthRow, CreatorPayoutRow } from '../creatorTypes';
import { MOCK_DB_URL } from '@/lib/config';
import type { BoostStatus } from '@/lib/domain/premium';
import type { EmailRow, PaymentRow } from '../billingTypes';
import { ALL_TOPICS, emitTopic, onExternalSignal } from '../bus';
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
  skills?: string[];
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
  autoReview?: unknown | null;
  declaration?: unknown | null;
  fingerprint?: string | null;
  qaStatus: string;
  qaNotes: string | null;
  previewToken: string;
  minorUpdate?: boolean;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface MockMedia extends MediaAsset {
  id: string;
  phash?: string | null;
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
  refCreator?: string | null;
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
  /** Weekly brain report e-mail (default on). */
  brainReport?: boolean;
  schoolSafe: boolean;
  lowData: boolean;
  locale: string;
  lastActive: string | null;
  bannedAt: string | null;
  premiumPlan?: 'plus' | 'max' | null;
  premiumUntil?: string | null;
  premiumAutoRenew?: boolean;
  premiumFromPass?: boolean;
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
  ledger: { id: string; userId: string; delta: number; reason: string; ref: string | null; createdAt: string }[];
  userCosmetics: { userId: string; code: string; slot: string; unlockedAt: string }[];
  parties: {
    code: string;
    hostKey: string;
    currentGameId: string | null;
    members: { key: string; name: string; cosmetics: Record<string, string>; canChat: boolean }[];
    votes: Record<string, string>;
    chat: { key: string; name: string; phrase: string; at: string }[];
    state: 'lobby' | 'playing';
    expiresAt: string;
  }[];
  revenueMonths: {
    studioId: string;
    studioName: string;
    month: string;
    currency: 'INR' | 'USD';
    gross: number;
    net: number;
    earned: number;
    sharePct: number;
    carryIn: number;
    payoutDue: number;
    status: 'finalised' | 'rolled_over' | 'paid';
    games: { gameId: string; title: string; impressions: number; net: number; share: number; earned: number }[];
  }[];
  revenueImports: { month: string; currency: string; fxInr: number | null; rows: unknown[]; at: string }[];
  payouts: { id: string; studioId: string; studioName: string; amount: number; currency: 'INR' | 'USD'; method: 'bank' | 'paypal' | 'wise' | 'payoneer'; reference: string; months: string[]; paidAt: string }[];
  payoutProfiles: { studioId: string; method: 'bank' | 'paypal' | 'wise' | 'payoneer'; currency: 'INR' | 'USD'; summary: string; updatedAt: string }[];
  userFavourites: { userId: string; gameId: string; createdAt: string }[];
  userHistory: { userId: string; gameId: string; slug: string; lastPlayedAt: string; playCount: number; secondsPlayed: number }[];
  referralVisits: { studioSlug: string; anonId: string; at: string }[];
  followers: { studioId: string; userId: string; createdAt: string }[];
  /** Tile impressions and clicks per game and UTC day (the discovery algorithm's raw input). */
  impressions: { gameId: string; day: string; impressions: number; clicks: number }[];
  /** Checkouts started but not paid yet. */
  intents: { id: string; kind: 'premium' | 'boost'; userId: string; ref: string; pkg: 'spotlight' | 'push' | 'launch' | null; amount: number; createdAt: string }[];
  payments: PaymentRow[];
  boosts: {
    id: string;
    gameId: string;
    studioId: string;
    package: 'spotlight' | 'push' | 'launch';
    amount: number;
    status: BoostStatus;
    shortUrls: string[];
    reelUrls: string[];
    startsAt: string | null;
    endsAt: string | null;
    heroUntil: string | null;
    notes: string;
    createdAt: string;
  }[];
  guestPasses: { code: string; fromUserId: string; createdAt: string; redeemedBy: string | null; redeemedAt: string | null }[];
  /** Written by the local services process for every automated e-mail. */
  emails: EmailRow[];
  jams: { id: string; slug: string; title: string; theme: string; descriptionMd: string; startsAt: string; endsAt: string; status: 'draft' | 'published' | 'closed'; createdAt: string; sponsorName?: string | null; sponsorUrl?: string | null; prizes?: { rank: number; prize: string }[] }[];
  jamEntries: { jamId: string; gameId: string; studioId: string; submittedAt: string; rank: number | null }[];
  variantStats: { gameId: string; label: string; impressions: number; clicks: number; winner: boolean; decidedAt: string | null }[];
  playtests: { gameId: string; userId: string; fun: number; clarity: number; playAgain: boolean; createdAt: string }[];
  reports: { id: string; kind: string; targetType: string; targetId: string; reporterKey: string; reason: string; status: 'open' | 'actioned' | 'dismissed'; createdAt: string }[];
  /** Admin edits to the built-in quest and cosmetic lists. */
  questOverrides: { code: string; target: number; reward: number; active: boolean }[];
  cosmeticOverrides: { id: string; cost: number; minLevel: number; active: boolean }[];
  creators: Creator[];
  creatorVisits: { handle: string; anonId: string; at: string }[];
  creatorMonths: CreatorMonthRow[];
  creatorPayouts: CreatorPayoutRow[];
  boostCredits: { id: string; studioId: string; versionId: string; createdAt: string; usedAt: string | null; usedBoostId: string | null }[];
  creatorPayoutProfiles: { creatorId: string; method: 'bank' | 'paypal' | 'wise' | 'payoneer'; currency: 'INR' | 'USD'; summary: string; updatedAt: string }[];
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
  creatorVisits: 2000,
  reports: 500,
  playtests: 2000,
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

// ---------------------------------------------------------------------------------------------
// The shared local database
//
// On a developer machine the player site, the developer portal and the management portal run on
// three origins, and localStorage is per origin. So the tables live in the local services process
// (`scripts/dev-services.mjs`) and every site reads and writes them over HTTP. The calls are
// synchronous on purpose: the whole mock layer is written as plain synchronous table access, the
// server is on localhost, and none of this code runs in production.
// If the services process is not running, the mock quietly falls back to localStorage.
// ---------------------------------------------------------------------------------------------
const REMOTE = typeof window !== 'undefined' && process.env.NODE_ENV !== 'test' ? MOCK_DB_URL : '';
let remote: 'unknown' | 'on' | 'off' = REMOTE ? 'unknown' : 'off';
let versions: Record<string, number> = {};
let checkedAt = 0;
const texts = new Map<string, { version: number; text: string }>();

function call(method: 'GET' | 'POST', path: string, body?: string): string | null {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${REMOTE}${path}`, false);
    // text/plain keeps this a "simple" request: no CORS preflight for every write.
    if (body != null) xhr.setRequestHeader('content-type', 'text/plain');
    xhr.send(body ?? null);
    return xhr.status >= 200 && xhr.status < 300 ? xhr.responseText : null;
  } catch {
    return null;
  }
}

// A signal from another tab means the versions we hold may be out of date: check again at once.
onExternalSignal(() => {
  checkedAt = 0;
});

/** False after a read that could not reach the store and had nothing cached (a closing page). */
let lastReadOk = true;

/** Other sites write too: when a table changes under us, every open query refetches. */
function watchRemote(): void {
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void fetch(`${REMOTE}/versions`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : null))
      .then((latest) => {
        if (!latest) return;
        const changed = Object.keys(latest).some((k) => latest[k] !== versions[k]);
        versions = latest;
        checkedAt = Date.now();
        if (changed) for (const topic of ALL_TOPICS) emitTopic(topic, { local: true });
      })
      .catch(() => {});
  }, 1500);
}

function usingRemote(): boolean {
  if (remote === 'off') return false;
  const now = Date.now();
  if (remote === 'on' && now - checkedAt < 250) return true;
  const text = call('GET', '/versions');
  if (text == null) {
    // Never reachable: use localStorage. Reachable before: keep serving what is cached.
    if (remote === 'unknown') remote = 'off';
    return remote === 'on';
  }
  try {
    const latest = JSON.parse(text) as Record<string, number>;
    const changed = remote === 'on' && Object.keys(latest).some((k) => latest[k] !== versions[k]);
    versions = latest;
    if (changed) window.setTimeout(() => ALL_TOPICS.forEach((topic) => emitTopic(topic, { local: true })), 0);
  } catch {
    return remote === 'on';
  }
  checkedAt = now;
  if (remote === 'unknown') {
    remote = 'on';
    watchRemote();
  }
  return true;
}

export function readTable<K extends TableName>(name: K): MockTables[K] {
  let rows: MockTables[K] | null = null;
  if (usingRemote()) {
    const version = versions[name] ?? 0;
    let cached = texts.get(name);
    lastReadOk = true;
    if (version > 0 && (!cached || cached.version !== version)) {
      const text = call('GET', `/table/${name}`);
      if (text != null) texts.set(name, (cached = { version, text }));
      else if (!cached) lastReadOk = false;
    }
    try {
      // Parsed fresh for each caller, so a caller may change the rows it was given.
      rows = version > 0 && cached ? (JSON.parse(cached.text) as MockTables[K]) : null;
    } catch {
      rows = null;
    }
  } else {
    rows = local.get<MockTables[K] | null>(PREFIX + name, null);
  }
  return Array.isArray(rows) ? rows : ([] as unknown as MockTables[K]);
}

export function writeTable<K extends TableName>(name: K, rows: MockTables[K]): void {
  const cap = CAPS[name];
  const trimmed = cap && rows.length > cap ? (rows.slice(rows.length - cap) as MockTables[K]) : rows;
  if (usingRemote()) {
    const text = JSON.stringify(trimmed);
    const reply = call('POST', `/table/${name}`, text);
    if (reply != null) {
      const version = Number((JSON.parse(reply) as { version?: number }).version ?? 0);
      versions[name] = version;
      texts.set(name, { version, text });
    } else {
      // Browsers refuse synchronous requests while a page is closing, which is exactly when the
      // last play events are flushed. A beacon is delivered after the page has gone.
      try {
        navigator.sendBeacon(`${REMOTE}/table/${name}`, text);
      } catch {
        // nothing more can be done from a closing page
      }
      texts.set(name, { version: versions[name] ?? 0, text });
    }
    return;
  }
  local.set(PREFIX + name, trimmed);
}

export interface MockDbStats {
  /** Where the tables are kept. */
  store: 'local-service' | 'browser';
  tables: { name: string; rows: number; bytes: number }[];
  totalBytes: number;
}

/** Table sizes of the mock database, for the management portal's database page. */
export function mockDbStats(): MockDbStats {
  if (usingRemote()) {
    const text = call('GET', '/stats');
    if (text != null) {
      const data = JSON.parse(text) as Omit<MockDbStats, 'store'>;
      return { store: 'local-service', tables: data.tables, totalBytes: data.totalBytes };
    }
  }
  const tables: MockDbStats['tables'] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const text = window.localStorage.getItem(key) ?? '[]';
      let rows = 0;
      try {
        const parsed: unknown = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        rows = 0;
      }
      tables.push({ name: key.slice(PREFIX.length), rows, bytes: text.length });
    }
  } catch {
    // storage unavailable
  }
  tables.sort((a, b) => b.bytes - a.bytes);
  return { store: 'browser', tables, totalBytes: tables.reduce((n, t) => n + t.bytes, 0) };
}

/** Read-modify-write. The callback may mutate the array or return a new one. */
/**
 * Adds rows to an append-only table (events, visits). The local services process appends them,
 * so a page with an outdated copy of the table can never overwrite rows other pages added.
 */
export function appendRows<K extends TableName>(name: K, rows: MockTables[K]): void {
  if (rows.length === 0) return;
  if (usingRemote()) {
    const text = JSON.stringify(rows);
    const path = `/append/${name}?cap=${CAPS[name] ?? 20000}`;
    const reply = call('POST', path, text);
    if (reply != null) {
      versions[name] = Number((JSON.parse(reply) as { version?: number }).version ?? 0);
    } else {
      // A closing page cannot make synchronous requests: a beacon is delivered after it has gone.
      try {
        navigator.sendBeacon(`${REMOTE}${path}`, text);
      } catch {
        // nothing more can be done from a closing page
      }
    }
    texts.delete(name);
    return;
  }
  mutateTable(name, (list) => {
    (list as unknown[]).push(...(rows as unknown[]));
  });
}

export function mutateTable<K extends TableName>(
  name: K,
  fn: (rows: MockTables[K]) => MockTables[K] | void,
): MockTables[K] {
  const rows = readTable(name);
  // If the read could not reach the store, writing would replace the table with only the new
  // rows. Losing one late write (a page that is closing) is the safe choice.
  if (remote === 'on' && !lastReadOk) return rows;
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
export function resetMockDb(seed = false): void {
  if (typeof window === 'undefined') return;
  if (usingRemote()) {
    call('POST', `/reset?seed=${seed ? 1 : 0}`, '');
    texts.clear();
    versions = {};
    checkedAt = 0;
    return;
  }
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
