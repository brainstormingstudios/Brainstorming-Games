/**
 * The one repository interface. Every screen talks to the data layer through this shape, and
 * there are exactly two implementations: `mock` (localStorage, zero setup) and `supabase`.
 *
 * Rules for implementers:
 *   - Never throw for "not found": return null or an empty list.
 *   - Throw `RepoError` with a stable `code` for failures the UI should explain.
 *   - Emit the matching bus topic after every mutation so open screens refresh.
 */
import type { AvatarCosmetics } from '@brainstorming/ui';
import type { BoostOrder, BoostPackage, CheckoutIntent, EmailRow, PaymentRow, PremiumPlan, PremiumStatus, Wallpaper } from './billingTypes';
import type { PlayRow, Skill } from '@/lib/domain/brain';
import type { PointsOptionId } from '@/lib/domain/discover';
import type { AdminCreatorRow, Creator, CreatorApplyInput, CreatorMonthRow, CreatorPayoutRow, CreatorStats, CreatorStatus } from './creatorTypes';
import type { PremiumState } from '@/lib/domain/premium';
import type { KpiResult } from '@/lib/domain/kpis';
import type { PreQaReport } from '@/lib/domain/preqa';
import type { Currency, GameImpressions, GameLine, RevenueRow, RevenueRun } from '@/lib/domain/revenue';
import type {
  AuditRecord,
  CreateStudioInput,
  DevGame,
  DevGameDetail,
  DevlogRecord,
  DevMedia,
  DevStudio,
  FeedbackRecord,
  GameEditable,
  MediaUpload,
  NewVersionInput,
  PreviewInfo,
  QaChecklistItem,
  PendingChangeItem,
  AutoRejectedItem,
  QaQueueItem,
  QaReviewItem,
  ReferralStats,
  SparkRow,
  Declaration,
  AutoReviewReport,
} from './devTypes';
import type {
  AdminCosmetic,
  AdminDevlogRow,
  AdminQuest,
  AdminStudioRow,
  AdminUserRow,
  DatabaseStats,
  DevlogPost,
  DiscoveryReport,
  DiscoveryRow,
  Jam,
  JamDetail,
  JamInput,
  PlaytestAnswers,
  PlaytestSummary,
  ReportInput,
  ReportRecord,
  SiteStats,
  VariantHit,
  VariantStat,
} from './growthTypes';
import type {
  DeviceClass,
  GameStatus,
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
  /** A sensitive change needs a sign-in from the last few minutes. */
  | 'reauth_required'
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
  /** Records a visit that arrived through a studio's referral link. */
  recordReferral(studioSlug: string): Promise<void>;
}

export interface EventContext {
  anonId: string;
  device: DeviceClass;
  /** Studio slug from a `?ref=` link, if this visitor arrived through one. */
  refStudio: string | null;
  /** Creator handle from a `?cr=` link, if this visitor arrived through one. */
  refCreator?: string | null;
}

export interface EventsRepo {
  ingest(batch: EventInput[], context: EventContext): Promise<void>;
  /** Best-effort delivery while the page is closing. */
  ingestOnUnload(batch: EventInput[], context: EventContext): void;
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

export type ConsentStatus = 'not_required' | 'pending' | 'granted' | 'denied';
export type UserRole = 'player' | 'moderator' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  /** Null until the player picks a username and birth year (signup is incomplete). */
  username: string | null;
  displayName: string;
  role: UserRole;
  isMinor: boolean;
  consent: ConsentStatus;
  brainPoints: number;
  level: number;
  streakDays: number;
  avatar: AvatarCosmetics;
  profilePublic: boolean;
  playtestOptIn: boolean;
  /** Brainstorming Premium, when the player has (or had) it. */
  premium: PremiumState | null;
  createdAt: string;
}

export type OAuthProvider = 'google' | 'apple' | 'discord';

export interface SignInResult {
  /** A 6-digit code was e-mailed (type it with `verifyEmailCode`), or the session already started. */
  status: 'code_sent' | 'signed_in';
  /** Local build without e-mail set up: the code, shown on screen instead of e-mailed. */
  devCode?: string;
}

export interface ProfilePatch {
  displayName?: string;
  locale?: string;
  lowData?: boolean;
  schoolSafe?: boolean;
  profilePublic?: boolean;
  playtestOptIn?: boolean;
}

export interface AuthRepo {
  session(): Promise<SessionUser | null>;
  /** `captchaToken`: the Turnstile token, when the bot check is on. */
  signInWithEmail(email: string, next?: string, captchaToken?: string | null): Promise<SignInResult>;
  /** Finishes an e-mail sign-in with the 6-digit code. Throws `invalid` for a wrong or expired code. */
  verifyEmailCode(email: string, code: string): Promise<void>;
  signInWithProvider(provider: OAuthProvider, next?: string): Promise<void>;
  /** Google Identity Services: signs in with the ID token Google's own button returned. */
  signInWithGoogleIdToken(idToken: string): Promise<void>;
  completeSignup(username: string, birthYear: number, locale: string): Promise<SessionUser>;
  usernameAvailable(username: string): Promise<boolean>;
  signOut(): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<void>;
  /** Sends the parental-consent e-mail. Mock mode returns the link instead. */
  requestParentalConsent(parentEmail: string): Promise<{ devLink?: string }>;
  consentView(token: string): Promise<{ username: string; status: ConsentStatus; expired: boolean } | null>;
  consentResolve(token: string, approve: boolean): Promise<ConsentStatus>;
  exportData(): Promise<Record<string, unknown>>;
  deleteAccount(): Promise<void>;
  /** Short-lived ES256 token `{ sub, gameId, exp }` for a game's own server. */
  gameToken(gameId: string): Promise<string | null>;
  /**
   * The owner code: the second lock on the management portal. `enrolled` once an authenticator
   * app is set up; `unlocked` after a correct code in this browser session.
   */
  /** `devices`: how many authenticators can produce the owner code (2+ means a backup exists). */
  ownerCodeStatus(): Promise<{ enrolled: boolean; unlocked: boolean; devices?: number }>;
  /** Starts adding a backup authenticator (a second phone). Needs an unlocked session. */
  ownerCodeAddBackup(): Promise<{ secret: string; uri: string }>;
  /** Confirms the backup with a code it shows. */
  ownerCodeConfirmBackup(code: string): Promise<boolean>;
  /** Ends every session of this account on every device, this one included. */
  signOutEverywhere(): Promise<void>;
  /** Starts (or restarts) the set-up: the secret to add to an authenticator app. */
  ownerCodeEnroll(): Promise<{ secret: string; uri: string }>;
  /** Checks a 6-digit code. Throws `rate_limited` after too many wrong ones. */
  ownerCodeVerify(code: string): Promise<boolean>;
  ownerCodeLock(): Promise<void>;
}

export interface SavesRepo {
  get(gameId: string, key: string): Promise<unknown>;
  set(gameId: string, key: string, value: unknown): Promise<void>;
  remove(gameId: string, key: string): Promise<void>;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  isMe: boolean;
  cosmetics?: AvatarCosmetics;
}

export interface ScoresRepo {
  startSession(gameId: string, versionId: string | null): Promise<string | null>;
  submit(gameId: string, board: string, score: number, sessionId: string): Promise<{ accepted: boolean }>;
  top(
    gameId: string,
    board: string,
    options: { limit: number; friends: boolean; period: 'day' | 'week' | 'all' },
  ): Promise<{ entries: LeaderboardRow[]; me: LeaderboardRow | null }>;
}

export interface QuestView {
  code: string;
  period: 'daily' | 'weekly';
  title: string;
  description: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  /** Games this quest counts (null when any game counts). */
  category: string | null;
}

export interface ProgressSummary {
  quests: QuestView[];
  brainPoints: number;
  level: number;
  lifetimePoints: number;
  streakDays: number;
  playedToday: boolean;
}

export interface LedgerRow {
  delta: number;
  reason: string;
  createdAt: string;
}

export interface QuestsRepo {
  track(event: string, value: number): Promise<void>;
  /** The caller's quests with progress (guests get the quests with zero progress). */
  mine(locale: string): Promise<ProgressSummary>;
  ledger(): Promise<LedgerRow[]>;
}

export interface LockerItem {
  id: string;
  slot: 'colour' | 'hat' | 'glasses' | 'headphones' | 'glow' | 'frame';
  code: string;
  name: string;
  cost: number;
  minLevel: number;
  owned: boolean;
  equipped: boolean;
}

export interface LockerRepo {
  items(locale: string): Promise<LockerItem[]>;
  unlock(itemId: string): Promise<void>;
  equip(cosmetics: AvatarCosmetics): Promise<void>;
}

export interface FriendRow {
  id: string;
  username: string;
  displayName: string;
  avatar: AvatarCosmetics;
  level: number;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
}

export interface Activity {
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  partyCode?: string | null;
}

export interface PresenceInfo {
  online: boolean;
  activity: Activity | null;
}

export interface SocialRepo {
  friends(): Promise<FriendRow[]>;
  request(username: string): Promise<'pending' | 'accepted'>;
  respond(userId: string, accept: boolean): Promise<void>;
  remove(userId: string): Promise<void>;
  /** Live presence of everyone the caller can see (friends). */
  watchPresence(cb: (presence: Record<string, PresenceInfo>) => void): () => void;
  /** What the caller is doing now (shown to friends). Null clears it. */
  setActivity(activity: Activity | null): void;
}

export interface PartyMember {
  key: string;
  name: string;
  cosmetics: AvatarCosmetics;
  canChat: boolean;
}

export interface PartyView {
  code: string;
  hostKey: string;
  meKey: string;
  members: PartyMember[];
  votes: Record<string, string>;
  chat: { key: string; name: string; phrase: string; at: string }[];
  state: 'lobby' | 'playing';
  currentGameId: string | null;
  expiresAt: string;
}

export interface PartyRepo {
  create(gameId?: string | null): Promise<PartyView>;
  get(code: string): Promise<PartyView | null>;
  join(code: string): Promise<PartyView>;
  leave(code: string): Promise<void>;
  act(code: string, action: 'vote' | 'chat' | 'set_game' | 'start' | 'lobby', options?: { gameId?: string; phrase?: string }): Promise<PartyView>;
  watch(code: string, cb: () => void): () => void;
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsRepo {
  list(): Promise<NotificationRow[]>;
  markRead(id?: string): Promise<void>;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatar: AvatarCosmetics;
  level: number;
  brainPoints: number;
  streakDays: number;
  createdAt: string;
  favourites: GameSummary[];
  recent: GameSummary[];
  stats: { gamesPlayed: number; minutesPlayed: number; questsCompleted: number };
  badges: string[];
}

export interface ProfilesRepo {
  get(username: string): Promise<PublicProfile | null>;
}

export interface PointsRow {
  rank: number;
  name: string;
  points: number;
  level: number;
  isMe: boolean;
  cosmetics: AvatarCosmetics;
}

export interface LeaderboardsRepo {
  points(period: 'week' | 'all', friends: boolean): Promise<{ entries: PointsRow[]; me: PointsRow | null }>;
  /** Board keys a game has used. */
  boards(gameId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------------------------
// Developer portal and admin
// ---------------------------------------------------------------------------------------------

export interface DevRepo {
  myStudio(): Promise<DevStudio | null>;
  createStudio(input: CreateStudioInput): Promise<DevStudio>;
  updateStudio(patch: Partial<Pick<DevStudio, 'name' | 'bio' | 'avatarUrl' | 'links' | 'contactEmail'>>): Promise<void>;
  myGames(): Promise<DevGame[]>;
  game(gameId: string): Promise<DevGameDetail | null>;
  createGame(input: GameEditable): Promise<string>;
  updateGame(gameId: string, patch: Partial<GameEditable>): Promise<void>;
  deleteGame(gameId: string): Promise<void>;
  slugAvailable(slug: string, exceptGameId?: string): Promise<boolean>;
  uploadMedia(gameId: string, media: MediaUpload, onProgress?: (fraction: number) => void): Promise<DevMedia>;
  removeMedia(gameId: string, mediaId: string): Promise<void>;
  /** Withdraws a released game's held text edits and held media. */
  discardPendingEdit(gameId: string): Promise<void>;
  /** Publishes a clean minor update once its upload links have closed (a few minutes after upload). */
  publishMinorUpdate(versionId: string): Promise<void>;
  createVersion(
    input: NewVersionInput,
    onProgress?: (fraction: number) => void,
  ): Promise<{ versionId: string; previewToken: string }>;
  /**
   * Submits the latest build (needs the rights declaration). The checks run afterwards on the
   * server: a clear copy or harmful code is rejected at once (`rejected` with the reason), the
   * rest waits for a moderator.
   */
  submitForReview(gameId: string, declaration: Declaration): Promise<{ rejected: boolean; reason: string | null }>;
  rollback(gameId: string, versionId: string): Promise<void>;
  setStatus(gameId: string, status: 'paused' | 'removed'): Promise<void>;
  kpis(gameId: string, from: string, to: string): Promise<KpiResult>;
  feedback(): Promise<FeedbackRecord[]>;
  resolveFeedback(id: string, resolved: boolean): Promise<void>;
  devlogs(): Promise<DevlogRecord[]>;
  saveDevlog(input: { id?: string; gameId: string | null; title: string; bodyMd: string }): Promise<void>;
  deleteDevlog(id: string): Promise<void>;
  referralStats(): Promise<ReferralStats | null>;
  preview(versionId: string, token: string): Promise<PreviewInfo | null>;
}

export interface AdminRepo {
  qaQueue(): Promise<QaQueueItem[]>;
  /** The latest submissions the system rejected by itself, newest first. */
  autoRejected(): Promise<AutoRejectedItem[]>;
  /** Runs the test-play (pre-QA bot) again. Mock mode runs it locally and resolves with the report. */
  rerunPreQa(versionId: string): Promise<PreQaReport | null>;
  qaItem(versionId: string): Promise<QaReviewItem | null>;
  qaDecide(input: {
    versionId: string;
    action: 'approve' | 'changes' | 'reject';
    notes: string;
    checklist: Partial<Record<QaChecklistItem, boolean>>;
    schoolSafe: boolean;
  }): Promise<void>;
  /** Released games whose page text or media changes wait for review. */
  pendingChanges(): Promise<PendingChangeItem[]>;
  decideChange(gameId: string, approve: boolean, note: string): Promise<void>;
  sparkGames(): Promise<SparkRow[]>;
  sparkDecide(gameId: string, promote: boolean, reason: string, kpis: Record<string, unknown>): Promise<void>;
  setGameStatus(gameId: string, status: GameStatus, reason: string): Promise<void>;
  saveSiteConfig(config: SiteConfig): Promise<void>;
  audit(limit?: number): Promise<AuditRecord[]>;
  /** Re-run yesterday's and today's KPI roll-up now (the daily job). */
  runDailyJobs(): Promise<void>;
  /** Security alerts, newest first (open ones only by default). */
  securityAlerts(openOnly?: boolean): Promise<SecurityAlert[]>;
  resolveAlert(id: string): Promise<void>;
  /** Per game over the last `days` days: the numbers that show fake traffic. */
  fraudOverview(days: number): Promise<FraudRow[]>;
}

export interface SecurityAlert {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'high';
  title: string;
  detail: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
}

export interface FraudRow {
  gameId: string;
  title: string;
  studio: string;
  plays: number;
  players: number;
  /** Sessions with at least 20 seconds of play. */
  realSessions: number;
  adViews: number;
  playsPerPlayer: number;
  /** Browsers or addresses that hit the daily play limit. */
  cappedCallers: number;
}

// ---------------------------------------------------------------------------------------------
// Revenue and payouts
// ---------------------------------------------------------------------------------------------

export interface RevenueMonthRow {
  studioId: string;
  studioName: string;
  month: string;
  currency: Currency;
  gross: number;
  net: number;
  earned: number;
  sharePct: number;
  carryIn: number;
  payoutDue: number;
  status: 'finalised' | 'rolled_over' | 'paid';
  games: GameLine[];
}

export interface PayoutRow {
  id: string;
  studioId: string;
  studioName: string;
  amount: number;
  currency: Currency;
  method: PayoutMethod;
  reference: string;
  months: string[];
  paidAt: string;
}

export type PayoutMethod = 'bank' | 'paypal' | 'wise' | 'payoneer';

export interface PayoutProfileInput {
  method: PayoutMethod;
  currency: Currency;
  accountName: string;
  /** Bank: account number and IFSC. PayPal, Wise, Payoneer: the account e-mail. */
  details: Record<string, string>;
}

export interface PayoutProfileSummary {
  /** The details payouts go to now (null until a first change has passed its 48 hours). */
  method: PayoutMethod | null;
  currency: Currency | null;
  /** Masked, e.g. "Bank ••••4321 (HDFC0001234)". The full details never come back. */
  summary: string | null;
  updatedAt: string;
  /** A change waiting out its 48 hours (Security Phase 3). */
  pending?: { method: PayoutMethod; currency: Currency; summary: string; effectiveAt: string } | null;
}

export interface RevenueRepo {
  /** Admin: impressions per game and country for a month, country weights and carried balances. */
  inputs(month: string): Promise<{ games: GameImpressions[]; weights: Record<string, number>; carry: Record<string, number>; creatorCarry: Record<string, number> }>;
  /** Admin: stores a month's statements (replaces an earlier run of that month if none is paid). */
  finalise(run: RevenueRun, rows: RevenueRow[], fxInr: number | null): Promise<void>;
  /** Admin: every statement. */
  months(): Promise<RevenueMonthRow[]>;
  recordPayout(studioId: string, months: string[], method: PayoutMethod, reference: string): Promise<void>;
  payouts(): Promise<PayoutRow[]>;
  /** Developer: own statements and payouts. */
  myStatements(): Promise<RevenueMonthRow[]>;
  myPayouts(): Promise<PayoutRow[]>;
  payoutProfile(): Promise<PayoutProfileSummary | null>;
  /** Puts new details on hold for 48 hours. Throws RepoError('reauth_required') without a recent sign-in. */
  savePayoutProfile(input: PayoutProfileInput): Promise<void>;
  /** Drops a change that is still on hold. */
  cancelPayoutChange(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Growth: follows, devlog feed, thumbnail tests, playtests, jams, moderation, editors
// ---------------------------------------------------------------------------------------------

export interface GrowthRepo {
  following(studioId: string): Promise<boolean>;
  setFollowing(studioId: string, on: boolean): Promise<void>;
  /** Published devlogs, newest first: everyone's, one studio's or one game's. */
  devlogFeed(options?: { studioSlug?: string; gameId?: string; limit?: number }): Promise<DevlogPost[]>;
  /** Tile impressions and clicks. `variant` is empty for a game with one cover. */
  recordVariantHits(hits: VariantHit[]): Promise<void>;
  /** The discovery algorithm's view of one game: the developer's own, or any game for staff. */
  discovery(gameId: string): Promise<DiscoveryReport | null>;
  /** Developer: the running or finished thumbnail test of an own game. */
  variantStats(gameId: string): Promise<VariantStat[]>;
  /** Whether the signed-in panel member already answered for this game. */
  playtestAnswered(gameId: string): Promise<boolean>;
  submitPlaytest(gameId: string, answers: PlaytestAnswers): Promise<void>;
  playtestSummary(gameId: string): Promise<PlaytestSummary>;
  /** Published and closed jams, newest first. */
  jams(): Promise<Jam[]>;
  jam(slug: string): Promise<JamDetail | null>;
  enterJam(jamId: string, gameId: string): Promise<void>;
  leaveJam(jamId: string, gameId: string): Promise<void>;
  report(input: ReportInput): Promise<void>;

  // Staff only from here on.
  /** Every released game with its discovery inputs and score, best first. */
  discoveryAll(): Promise<DiscoveryRow[]>;
  siteStats(): Promise<SiteStats>;
  databaseStats(): Promise<DatabaseStats>;
  adminJams(): Promise<Jam[]>;
  saveJam(input: JamInput): Promise<void>;
  deleteJam(id: string): Promise<void>;
  rankJamEntry(jamId: string, gameId: string, rank: number | null): Promise<void>;
  reports(): Promise<ReportRecord[]>;
  resolveReport(id: string, status: 'actioned' | 'dismissed'): Promise<void>;
  findUsers(query: string): Promise<AdminUserRow[]>;
  /** `role` can only be changed by an admin (not by a moderator). */
  setUser(userId: string, patch: { banned?: boolean; resetUsername?: boolean; role?: UserRole }): Promise<void>;
  /** Admins: delete an account for good (not your own). */
  deleteUser(userId: string, reason: string): Promise<void>;
  /** Every game on the site with its studio and status, for game moderation. */
  allGames(query: string): Promise<{ id: string; slug: string; title: string; studioName: string; status: GameStatus; autoReviewStatus: AutoReviewReport['status'] | null; updatedAt: string }[]>;
  /** Admins: delete a game for good. */
  deleteGame(gameId: string, reason: string): Promise<void>;
  findStudios(query: string): Promise<AdminStudioRow[]>;
  setStudio(studioId: string, patch: { suspended?: boolean; verified?: boolean }): Promise<void>;
  adminDevlogs(): Promise<AdminDevlogRow[]>;
  hideDevlog(id: string, hidden: boolean): Promise<void>;
  adminQuests(): Promise<AdminQuest[]>;
  saveQuest(code: string, patch: { target: number; reward: number; active: boolean }): Promise<void>;
  adminCosmetics(): Promise<AdminCosmetic[]>;
  saveCosmetic(id: string, patch: { cost: number; minLevel: number; active: boolean }): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Billing: Premium for players, Boost for developers, and the management view of both
// ---------------------------------------------------------------------------------------------

export interface BillingRepo {
  premiumStatus(): Promise<PremiumStatus>;
  /** Starts a subscription. Adults only. */
  subscribe(plan: PremiumPlan): Promise<CheckoutIntent>;
  /** Stops renewal; the paid period runs to its end. */
  cancel(): Promise<void>;
  /** Local checkout only: completes a test payment. */
  completeTestPayment(intentId: string): Promise<void>;
  /** After a Razorpay payment: waits for the server to confirm it. */
  confirmPayment(reference: string): Promise<boolean>;
  wallpapers(): Promise<Wallpaper[]>;
  /** Max members: a link that gives a friend 7 days of Plus. */
  createGuestPass(): Promise<{ code: string }>;
  redeemGuestPass(code: string): Promise<void>;
  /** Developer: buy a Boost for one of their live games. */
  orderBoost(gameId: string, pkg: BoostPackage): Promise<CheckoutIntent>;
  myBoosts(): Promise<BoostOrder[]>;
  /** Free Spotlight Boosts the studio earned from late reviews, not yet used. */
  myBoostCredits(): Promise<number>;
  /** Uses one credit: a free Spotlight Boost for one of the studio's live games. */
  redeemBoostCredit(gameId: string): Promise<void>;
  // Staff
  boosts(): Promise<BoostOrder[]>;
  updateBoost(id: string, patch: { status?: BoostOrder['status']; shortUrls?: string[]; reelUrls?: string[]; notes?: string }): Promise<void>;
  payments(): Promise<PaymentRow[]>;
  emails(): Promise<EmailRow[]>;
}

export interface CreatorRepo {
  /** The signed-in player's creator account, if any. */
  mine(): Promise<Creator | null>;
  /** Applies (or re-applies after a rejection). Adults only. */
  apply(input: CreatorApplyInput): Promise<Creator>;
  handleAvailable(handle: string): Promise<boolean>;
  /** Approved creators: visitors, plays and ad impressions their links brought. */
  stats(days: number): Promise<CreatorStats>;
  myStatements(): Promise<CreatorMonthRow[]>;
  myPayouts(): Promise<CreatorPayoutRow[]>;
  payoutProfile(): Promise<PayoutProfileSummary | null>;
  /** Puts new details on hold for 48 hours. Throws RepoError('reauth_required') without a recent sign-in. */
  savePayoutProfile(input: PayoutProfileInput): Promise<void>;
  /** Drops a change that is still on hold. */
  cancelPayoutChange(): Promise<void>;
  /** Records a visit that arrived through a creator link. */
  recordVisit(handle: string): Promise<void>;
  // Staff
  list(status: CreatorStatus | 'all'): Promise<AdminCreatorRow[]>;
  decide(creatorId: string, decision: 'approve' | 'reject' | 'suspend', note: string): Promise<void>;
  months(): Promise<CreatorMonthRow[]>;
  recordPayout(creatorId: string, months: string[], method: PayoutMethod, reference: string): Promise<void>;
  payouts(): Promise<CreatorPayoutRow[]>;
}

/** Play time per game and day plus each game's skills: the inputs of the Brain Profile. */
export interface BrainData {
  rows: PlayRow[];
  skills: Record<string, Skill[]>;
}

export interface BrainRepo {
  /** The signed-in player's play time (or this browser's, for a guest). */
  mine(): Promise<BrainData>;
  /** A public player's, for "challenge a friend". Null when private or unknown. */
  of(username: string): Promise<(BrainData & { username: string; displayName: string }) | null>;
  /** The weekly brain report e-mail (signed-in players). */
  reportEnabled(): Promise<boolean>;
  setReport(on: boolean): Promise<void>;
}

export interface Discovery {
  gameId: string;
  slug: string;
  title: string;
  ratedAt: string;
}

export interface RisingRow {
  gameId: string;
  answers: number;
  /** 0 to 1: how much Early Access testers loved it. */
  score: number;
}

export interface DailyChallenge {
  /** YYYY-MM-DD (UTC). */
  day: string;
  gameId: string;
  /** The game's leaderboard for today's scores, or null when it has none. */
  board: string | null;
}

export interface DiscoverRepo {
  /** Games the player rated in Early Access that reached Full Launch. */
  myDiscoveries(): Promise<Discovery[]>;
  /** Credit on a Full Launch game's page: its Early Access testers. Null before Full Launch. */
  discoverers(gameId: string): Promise<{ total: number; names: string[] } | null>;
  rising(limit: number): Promise<RisingRow[]>;
  daily(): Promise<DailyChallenge | null>;
  pointDaysThisMonth(): Promise<number>;
  /** Swaps Brain Points for Premium days. */
  redeemPoints(option: PointsOptionId): Promise<{ plan: 'plus' | 'max'; until: string }>;
}

export interface Repo {
  readonly mode: 'mock' | 'supabase';
  brain: BrainRepo;
  discover: DiscoverRepo;
  creators: CreatorRepo;
  billing: BillingRepo;
  growth: GrowthRepo;
  revenue: RevenueRepo;
  catalogue: CatalogueRepo;
  player: PlayerRepo;
  events: EventsRepo;
  auth: AuthRepo;
  saves: SavesRepo;
  scores: ScoresRepo;
  quests: QuestsRepo;
  locker: LockerRepo;
  social: SocialRepo;
  party: PartyRepo;
  notifications: NotificationsRepo;
  profiles: ProfilesRepo;
  leaderboards: LeaderboardsRepo;
  dev: DevRepo;
  admin: AdminRepo;
}
