/** Types for the developer portal and the admin console. */
import type { Skill } from '@/lib/domain/brain';
import type { KpiResult } from '@/lib/domain/kpis';
import type { PreQaReport } from '@/lib/domain/preqa';
import type { AutoReviewReport, Declaration } from '../../../../../supabase/functions/_shared/autoReview';

export type { AutoReviewReport, Declaration };
import type { ControlRow, FaqItem, FeedbackCategory, GameStatus, MediaAsset, MediaKind, Orientation, Platform } from './types';

export type QaStatus =
  | 'uploaded'
  | 'pre_qa_running'
  | 'pre_qa_passed'
  | 'pre_qa_warn'
  | 'pre_qa_failed'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected';

export type StudioLevel = 'rookie' | 'pro' | 'partner';
export type AccountHolder = 'adult' | 'company' | 'minor_with_guardian';

export interface DevStudio {
  id: string;
  slug: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  country: string | null;
  contactEmail: string | null;
  links: { label: string; url: string }[];
  verified: boolean;
  isFirstParty: boolean;
  level: StudioLevel;
  suspended: boolean;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  guardianName: string | null;
  createdAt: string;
}

export interface CreateStudioInput {
  name: string;
  slug: string;
  country: string;
  contactEmail: string;
  holder: AccountHolder;
  guardianName?: string;
  termsVersion: string;
}

/** The fields a developer edits in the new-game wizard. */
export interface GameEditable {
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
  maxScorePerSec: number | null;
  wantsExclusive: boolean;
  /** Skills the game trains, at most three (Brain Profile). */
  skills: Skill[];
}

export const EMPTY_GAME: GameEditable = {
  slug: '',
  title: '',
  shortDescription: '',
  descriptionMd: '',
  howToPlayMd: '',
  controls: [],
  faq: [],
  featuresMd: '',
  tipsMd: '',
  category: '',
  tags: [],
  orientation: 'landscape',
  platforms: ['desktop', 'mobile', 'tablet'],
  engine: null,
  isMultiplayer: false,
  hasProgress: false,
  maxScorePerSec: null,
  wantsExclusive: false,
  skills: [],
};

export interface DevVersion {
  id: string;
  gameId: string;
  version: string;
  storagePrefix: string;
  fileCount: number;
  totalBytes: number;
  entryFile: string;
  usesSdk: boolean;
  minorUpdate: boolean;
  preQaReport: PreQaReport | null;
  /** Checks run when the game was submitted, before a person reviews it. */
  autoReview: AutoReviewReport | null;
  qaStatus: QaStatus;
  qaNotes: string | null;
  createdAt: string;
  /** When it was sent for review, and when a person decided (the 72-hour promise). */
  submittedAt: string | null;
  reviewedAt: string | null;
  isCurrent: boolean;
}

export interface DevMedia extends MediaAsset {
  id: string;
  isActive: boolean;
  /** A new file for a released game, waiting for review (players still see the old one). */
  pending: boolean;
}

/** Changes to a released game's page that wait for review. */
export interface PendingEdit {
  /** The held fields (their new values are already in `DevGameDetail.game`). */
  fields: (keyof GameEditable)[];
  /** The values players see now, for the same fields. */
  live: Partial<GameEditable>;
  submittedAt: string;
}

/** A released game with changes waiting for staff (management portal). */
export interface PendingChangeItem {
  gameId: string;
  title: string;
  slug: string;
  studioName: string;
  submittedAt: string;
  changes: Partial<GameEditable>;
  live: Partial<GameEditable>;
  media: { id: string; kind: MediaKind; url: string; variantLabel: string | null; liveUrl: string | null }[];
}

export interface LaunchRecord {
  tier: 'spark' | 'rise' | 'featured';
  startedAt: string;
  endedAt: string | null;
  decision: 'promoted' | 'declined' | null;
  reason: string | null;
}

export interface ReviewRecord {
  action: 'approve' | 'changes' | 'reject';
  notes: string;
  createdAt: string;
  versionId: string;
}

export interface DevGame extends GameEditable {
  id: string;
  studioId: string;
  status: GameStatus;
  schoolSafe: boolean;
  sparkStartedAt: string | null;
  riseStartedAt: string | null;
  releasedAt: string | null;
  exclusiveUntil: string | null;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  plays: number;
  rating10: number | null;
}

export interface DevGameDetail {
  game: DevGame;
  versions: DevVersion[];
  media: DevMedia[];
  launches: LaunchRecord[];
  reviews: ReviewRecord[];
  /** Held edits of a released game; `game` already shows their new values. */
  pendingEdit: PendingEdit | null;
}

export interface UploadFile {
  path: string;
  data: Blob;
}

export interface NewVersionInput {
  gameId: string;
  version: string;
  files: UploadFile[];
  entryFile: string;
  usesSdk: boolean;
  minorUpdate: boolean;
  /** SHA-256 of the build's file paths and sizes, to spot the same build uploaded twice. */
  fingerprint?: string | null;
  /** Fingerprints of its art, audio and model files, to spot assets copied from other games. */
  assetHashes?: string[];
}

export interface MediaUpload {
  kind: MediaKind;
  /** One WebP per width (images) or the single file (videos). */
  variants: { width: number; blob: Blob }[];
  width: number;
  height: number;
  placeholder: string | null;
  variantLabel: string | null;
  /** 64-bit picture fingerprint of a cover (hex), to spot covers copied from other games. */
  phash?: string | null;
}

export interface FeedbackRecord {
  id: string;
  gameId: string;
  gameTitle: string;
  versionId: string | null;
  category: FeedbackCategory;
  message: string;
  context: Record<string, unknown> | null;
  device: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface DevlogRecord {
  id: string;
  gameId: string | null;
  title: string;
  bodyMd: string;
  publishedAt: string;
  hidden: boolean;
}

export interface ReferralStats {
  link: string;
  visits30d: number;
  adImpressions30d: number;
}

export interface PreviewInfo {
  gameId: string;
  title: string;
  slug: string;
  orientation: Orientation;
  versionId: string;
  version: string;
  playPath: string;
  usesSdk: boolean;
  /** Whole build, in bytes. */
  totalBytes: number;
  qaStatus: QaStatus;
  gameStatus: GameStatus;
  preQaReport: PreQaReport | null;
}

export interface QaQueueItem {
  versionId: string;
  gameId: string;
  title: string;
  studioName: string;
  version: string;
  submittedAt: string;
  preQaStatus: PreQaReport['status'] | null;
  autoReviewStatus: AutoReviewReport['status'] | null;
  isUpdate: boolean;
  /** Verified studios are promised a review within 24 hours and come first. */
  studioVerified: boolean;
}

/** A submission the system rejected by itself (a clear copy or harmful code), for the moderators' record. */
export interface AutoRejectedItem {
  versionId: string;
  gameId: string;
  title: string;
  studioName: string;
  version: string;
  reason: string;
  rejectedAt: string;
}

export interface QaReviewItem {
  game: DevGame;
  studio: DevStudio;
  version: DevVersion;
  media: DevMedia[];
  previous: ReviewRecord[];
  /** The rights declaration given with this submission. */
  declaration?: { ownsRights: boolean; noCopies: boolean; credits: string } | null;
  /** The studio's other games and how earlier reviews went, for the moderator's judgement. */
  studioRecord?: { games: { title: string; status: GameStatus }[]; approvals: number; rejections: number; changesRequested: number };
}

export interface SparkRow {
  game: DevGame;
  studioName: string;
  usesSdk: boolean;
  kpis: KpiResult;
  windowOver: boolean;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export const QA_CHECKLIST = [
  'chrome',
  'edge',
  'safari',
  'mobile',
  'pegi12',
  'original',
  'english',
  'covers',
  'noExternalAds',
  'noExternalLogins',
] as const;
export type QaChecklistItem = (typeof QA_CHECKLIST)[number];
