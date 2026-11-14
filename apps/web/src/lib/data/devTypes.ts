/** Types for the developer portal and the admin console. */
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
  isCurrent: boolean;
}

export interface DevMedia extends MediaAsset {
  id: string;
  isActive: boolean;
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
}

export interface QaReviewItem {
  game: DevGame;
  studio: DevStudio;
  version: DevVersion;
  media: DevMedia[];
  previous: ReviewRecord[];
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
