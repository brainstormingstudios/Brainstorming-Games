import { FOUNDING_DAYS, FOUNDING_STUDIOS } from '@/lib/domain/verified';
import { PRIMARY_CATEGORY_SLUGS, tagSlug } from '@/lib/catalogue/categories';
import { normaliseSkills } from '@/lib/domain/brain';
import { DEVELOPER_TERMS_VERSION, LIMITS, PLAY_ORIGIN, SITE_URL } from '@/lib/config';
import { computeDailyKpis, percentRank, summarise, type KpiEvent, type KpiRating, type KpiResult } from '@/lib/domain/kpis';
import { HELD_FIELDS, splitLivePatch } from '@/lib/domain/liveEdits';
import { buildUrl } from '@/lib/format';
import { harmfulReason, type PreQaReport } from '@/lib/domain/preqa';
import { autoRejectReason, runAutoReview } from '../../../../../../supabase/functions/_shared/autoReview';
import { emitTopic } from '../bus';
import { uuid } from '../local';
import type {
  DevGame,
  DevGameDetail,
  DevMedia,
  DevStudio,
  DevVersion,
  GameEditable,
  PreviewInfo,
  QaStatus,
  AutoReviewReport,
  Declaration,
} from '../devTypes';
import type { DevRepo } from '../repo';
import { readCatalogueTables, statsFor } from './catalogue';
import { currentMockUser, requireUser } from './auth';
import { sendMail } from './mail';
import {
  audit,
  fail,
  mutateTable,
  newId,
  notify,
  nowIso,
  readTable,
  takeToken,
  type MockGame,
  type MockMedia,
  type MockStudio,
  type MockVersion,
} from './db';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function toDevStudio(s: MockStudio): DevStudio {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    bio: s.bio,
    avatarUrl: s.avatarUrl,
    country: s.country,
    contactEmail: s.contactEmail,
    links: s.links,
    verified: s.verified,
    isFirstParty: s.isFirstParty,
    level: s.level,
    suspended: Boolean(s.suspendedAt),
    termsVersion: s.termsVersion,
    termsAcceptedAt: s.termsAcceptedAt,
    guardianName: s.guardianName,
    createdAt: s.createdAt,
  };
}

export function toDevGame(g: MockGame): DevGame {
  const stats = statsFor(g.id, readCatalogueTables());
  return {
    id: g.id,
    studioId: g.studioId,
    slug: g.slug,
    title: g.title,
    shortDescription: g.shortDescription,
    descriptionMd: g.descriptionMd,
    howToPlayMd: g.howToPlayMd,
    controls: g.controls,
    faq: g.faq,
    featuresMd: g.featuresMd,
    tipsMd: g.tipsMd,
    category: g.category,
    tags: g.tags,
    orientation: g.orientation,
    platforms: g.platforms,
    engine: g.engine,
    isMultiplayer: g.isMultiplayer,
    hasProgress: g.hasProgress,
    skills: normaliseSkills(g.skills ?? []),
    maxScorePerSec: g.maxScorePerSec,
    wantsExclusive: Boolean(g.wantsExclusive),
    status: g.status,
    schoolSafe: g.schoolSafe,
    sparkStartedAt: g.sparkStartedAt,
    riseStartedAt: g.riseStartedAt,
    releasedAt: g.releasedAt,
    exclusiveUntil: g.exclusiveUntil,
    currentVersionId: g.currentVersionId,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    plays: stats.plays,
    rating10: stats.rating10,
  };
}

export function toDevVersion(v: MockVersion, currentId: string | null): DevVersion {
  return {
    id: v.id,
    gameId: v.gameId,
    version: v.version,
    storagePrefix: v.storagePrefix,
    fileCount: v.fileCount,
    totalBytes: v.totalBytes,
    entryFile: v.entryFile,
    usesSdk: v.usesSdk,
    minorUpdate: Boolean(v.minorUpdate),
    preQaReport: (v.preQaReport as PreQaReport | null) ?? null,
    autoReview: (v.autoReview as AutoReviewReport | null) ?? null,
    qaStatus: v.qaStatus as QaStatus,
    qaNotes: v.qaNotes,
    createdAt: v.createdAt,
    submittedAt: v.submittedAt ?? null,
    reviewedAt: v.reviewedAt ?? null,
    previewedAt: v.previewedAt ?? null,
    isCurrent: v.id === currentId,
  };
}

export function mediaFor(gameId: string): DevMedia[] {
  return readTable('media')
    .filter((m) => m.gameId === gameId)
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      url: m.url,
      widths: m.widths,
      width: m.width,
      height: m.height,
      placeholder: m.placeholder,
      variantLabel: m.variantLabel,
      isActive: m.isActive,
      pending: Boolean(m.pending),
    }));
}

/** The held edit of a released game, as GameEditable fields. */
export function pendingChangesFor(gameId: string): Partial<GameEditable> {
  return (readTable('pendingEdits').find((e) => e.gameId === gameId)?.changes ?? {}) as Partial<GameEditable>;
}

function myStudioRow(): MockStudio | null {
  const user = requireUser();
  return readTable('studios').find((s) => s.ownerId === user.id) ?? null;
}

export function requireStudio(): MockStudio {
  const s = myStudioRow();
  if (!s || s.suspendedAt) fail('not_allowed');
  return s;
}

function requireOwnGame(gameId: string): MockGame {
  const s = requireStudio();
  const g = readTable('games').find((x) => x.id === gameId && x.studioId === s.id);
  if (!g) fail('not_found');
  return g;
}

export function updateGameRow(gameId: string, patch: Partial<MockGame>): MockGame {
  let out: MockGame | null = null;
  mutateTable('games', (rows) => {
    const row = rows.find((g) => g.id === gameId);
    if (row) {
      Object.assign(row, patch, { updatedAt: nowIso() });
      out = row;
    }
  });
  if (!out) fail('not_found');
  return out;
}

export function updateVersionRow(versionId: string, patch: Partial<MockVersion>): MockVersion {
  let out: MockVersion | null = null;
  mutateTable('versions', (rows) => {
    const row = rows.find((v) => v.id === versionId);
    if (row) {
      Object.assign(row, patch);
      out = row;
    }
  });
  if (!out) fail('not_found');
  return out;
}

/** The first 100 studios get the Verified tick free for a year (mirror of app.founding_studio). */
function foundingTick(): Partial<Pick<MockStudio, 'verified' | 'verifiedSource' | 'verifiedUntil' | 'foundingNumber'>> {
  const n = Math.max(0, ...readTable('studios').map((s) => s.foundingNumber ?? 0)) + 1;
  if (n > FOUNDING_STUDIOS) return {};
  return { verified: true, verifiedSource: 'founding', verifiedUntil: new Date(Date.now() + FOUNDING_DAYS * 86_400_000).toISOString(), foundingNumber: n };
}

export function ownerOf(gameId: string): string | null {
  const g = readTable('games').find((x) => x.id === gameId);
  return readTable('studios').find((s) => s.id === g?.studioId)?.ownerId ?? null;
}

/** The address to write to about a studio: its owner's account, else its contact address. */
export function studioEmail(studioId: string | null | undefined): string | null {
  const studio = readTable('studios').find((s) => s.id === studioId);
  return readTable('users').find((u) => u.id === studio?.ownerId)?.email ?? studio?.contactEmail ?? null;
}

/** What a submission still lacks (mirror of public.submit_for_review). */
export function submissionGaps(g: MockGame, media: MockMedia[]): string[] {
  const has = (k: string) => media.some((m) => m.kind === k);
  const gaps: string[] = [];
  if (!g.title.trim()) gaps.push('a title');
  if (!g.shortDescription.trim()) gaps.push('a short description');
  if (!g.descriptionMd.trim()) gaps.push('a description');
  if (g.tags.length < 3) gaps.push('at least 3 tags');
  if (g.controls.filter((c) => c.action.trim()).length < 1) gaps.push('at least one control');
  if (!has('cover_landscape')) gaps.push('the landscape cover');
  if (!has('cover_portrait')) gaps.push('the portrait cover');
  if (!has('cover_square')) gaps.push('the square cover');
  if (!has('preview_landscape')) gaps.push('the landscape preview video');
  return gaps;
}

/** Runs the auto-review against every other studio's released games. */
function autoReviewFor(g: MockGame, v: MockVersion, declaration: Declaration): AutoReviewReport {
  const media = readTable('media');
  const versions = readTable('versions');
  const released = readTable('games').filter((x) => x.releasedAt && x.id !== g.id);
  const others = released.map((x) => ({
    title: x.title,
    studioId: x.studioId,
    buildFingerprints: versions.filter((y) => y.gameId === x.id && y.fingerprint).map((y) => y.fingerprint!),
    coverHashes: media.filter((m) => m.gameId === x.id && m.phash).map((m) => m.phash!),
    description: `${x.shortDescription}\n${x.descriptionMd}`,
  }));
  // Asset files shared with other studios' released games (mirror of public.asset_overlaps).
  const mine = new Set(v.assetHashes ?? []);
  const assetOverlaps = released
    .filter((x) => x.studioId !== g.studioId)
    .map((x) => {
      const theirs = new Set(versions.filter((y) => y.gameId === x.id).flatMap((y) => y.assetHashes ?? []));
      return { title: x.title, studioId: x.studioId, shared: [...mine].filter((h) => theirs.has(h)).length };
    })
    .filter((o) => o.shared > 0);
  const studio = readTable('studios').find((s) => s.id === g.studioId);
  const myGames = new Set(readTable('games').filter((x) => x.studioId === g.studioId).map((x) => x.id));
  const report = v.preQaReport as PreQaReport | null;
  return runAutoReview({
    title: g.title,
    description: `${g.shortDescription}\n${g.descriptionMd}`,
    tags: g.tags,
    studioId: g.studioId,
    declaration,
    buildFingerprint: v.fingerprint ?? null,
    coverHashes: media.filter((m) => m.gameId === g.id && m.isActive && m.phash).map((m) => m.phash!),
    preQaProblems: (report?.checks ?? []).filter((c) => c.status !== 'pass').map((c) => ({ id: c.id, status: c.status as 'warn' | 'fail' })),
    others,
    assetCount: mine.size,
    assetOverlaps,
    page: {
      shortDescription: g.shortDescription,
      descriptionMd: g.descriptionMd,
      howToPlayMd: g.howToPlayMd,
      controls: g.controls.filter((c) => c.action.trim()).length,
      tags: g.tags.length,
    },
    studio: studio
      ? {
          createdAt: studio.createdAt,
          rejections: readTable('reviews').filter((r) => myGames.has(r.gameId) && r.action === 'reject').length,
          verified: Boolean(studio.verified),
        }
      : undefined,
  });
}

/** Makes a version the live one (mirror of app.publish_version). */
export function publishVersion(versionId: string): void {
  const v = updateVersionRow(versionId, { qaStatus: 'approved' });
  const report = v.preQaReport as PreQaReport | null;
  updateGameRow(v.gameId, {
    currentVersionId: v.id,
    sizeBytes: v.totalBytes,
    initialLoadBytes: report?.desktop?.initialBytes ?? null,
  });
}

/**
 * A minor update skips human review only when it is close to the reviewed build (mirror of
 * app.minor_update_ok): same entry file, half to one and a half times the size, a similar file
 * count. Mock uploads have no open links, so there is no waiting time here.
 */
export function minorUpdateOk(v: MockVersion): boolean {
  const g = readTable('games').find((x) => x.id === v.gameId);
  const cur = readTable('versions').find((x) => x.id === g?.currentVersionId);
  const report = v.preQaReport as PreQaReport | null;
  return Boolean(
    v.minorUpdate && g && (g.status === 'rise' || g.status === 'featured') && v.qaStatus === 'pre_qa_passed' && report?.status === 'pass' &&
      cur && v.entryFile === cur.entryFile && v.totalBytes >= cur.totalBytes * 0.5 && v.totalBytes <= cur.totalBytes * 1.5 &&
      Math.abs(v.fileCount - cur.fileCount) <= Math.max(10, Math.floor(cur.fileCount / 4)),
  );
}

const BEFORE_SUBMIT: QaStatus[] = ['uploaded', 'pre_qa_running', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed'];

/**
 * Rejects a version without a moderator (mirror of app.auto_reject): recorded like a review with
 * no reviewer, and the developer is told why. Approved or already rejected versions are left alone.
 */
export function autoReject(versionId: string, notes: string): boolean {
  const v = readTable('versions').find((x) => x.id === versionId);
  const g = v && readTable('games').find((x) => x.id === v.gameId);
  if (!v || !g || v.qaStatus === 'approved' || v.qaStatus === 'rejected') return false;
  mutateTable('reviews', (rows) => {
    rows.push({ id: newId(), versionId, gameId: g.id, reviewerId: '', action: 'reject', checklist: { automatic: true }, notes, createdAt: nowIso() });
  });
  updateVersionRow(versionId, { qaStatus: 'rejected', qaNotes: notes, reviewedAt: nowIso() });
  if (g.status === 'in_review') updateGameRow(g.id, { status: 'draft' });
  notify(ownerOf(g.id), 'qa', 'Submission rejected automatically', notes, `/dev/games/view/?id=${g.id}`);
  sendMail(studioEmail(g.studioId), 'review_rejected', { game: g.title, gameId: g.id, notes });
  emitTopic('qa');
  return true;
}

/** Publishes a house-studio version without a moderator; false for any other studio. */
function autoApproveOriginal(versionId: string): boolean {
  const v = readTable('versions').find((x) => x.id === versionId);
  const g = v && readTable('games').find((x) => x.id === v.gameId);
  const studio = g && readTable('studios').find((x) => x.id === g.studioId);
  if (!v || !g || !studio?.isFirstParty || v.qaStatus !== 'in_review') return false;
  mutateTable('reviews', (rows) => {
    rows.push({ id: newId(), versionId, gameId: g.id, reviewerId: '', action: 'approve', checklist: { automatic: true }, notes: 'BS Original: approved automatically after a clean test-play.', createdAt: nowIso() });
  });
  const first = !g.releasedAt || ['in_review', 'draft', 'changes_requested', 'paused'].includes(g.status);
  publishVersion(versionId);
  updateVersionRow(versionId, { reviewedAt: nowIso() });
  if (first) {
    const now = nowIso();
    updateGameRow(g.id, { status: 'spark', sparkStartedAt: now, releasedAt: g.releasedAt ?? now });
    mutateTable('launches', (rows) => {
      rows.push({ id: newId(), gameId: g.id, tier: 'spark', startedAt: now, endedAt: null, decision: null, reason: null, kpiSnapshot: null, decidedBy: null });
    });
  }
  notify(ownerOf(g.id), 'qa', 'BS Original published', 'Your game passed its test-play and is live in BS Originals.', `/dev/games/view/?id=${g.id}`);
  emitTopic('catalogue');
  return true;
}

/**
 * Runs the test-play with the local bot (scripts/dev-services.mjs) and stores the report. The
 * mock twin of submit-game starting the GitHub runner; never called from the developer side.
 */
export async function runMockPreQa(versionId: string): Promise<PreQaReport> {
  const v = readTable('versions').find((x) => x.id === versionId);
  if (!v) fail('not_found');
  let report: PreQaReport & { reason?: string };
  try {
    const res = await fetch(`${PLAY_ORIGIN}/__mock/pre-qa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: buildUrl(`${v.storagePrefix}/${v.entryFile}`) }),
    });
    report = (await res.json()) as PreQaReport & { reason?: string };
  } catch {
    fail('unavailable', 'The local pre-QA runner is not reachable. Start everything with `npm run dev`.');
  }
  if (!report || !Array.isArray(report.checks)) fail('unavailable', report?.reason ?? 'The pre-QA bot could not run.');
  applyPreQaReport(versionId, report);
  emitTopic('dev-games');
  emitTopic('qa');
  emitTopic('catalogue');
  return report;
}

/**
 * Stores a pre-QA report (mirror of set_pre_qa_report). Before submission it sets the pre-QA
 * status; afterwards it only stores the report for the moderators. Harmful code is rejected at
 * once, and close minor updates of live games auto-publish.
 */
export function applyPreQaReport(versionId: string, report: PreQaReport): QaStatus {
  const before = readTable('versions').find((x) => x.id === versionId);
  const status: QaStatus = before && !(BEFORE_SUBMIT as string[]).includes(before.qaStatus)
    ? (before.qaStatus as QaStatus)
    : report.status === 'pass' ? 'pre_qa_passed' : report.status === 'warn' ? 'pre_qa_warn' : 'pre_qa_failed';
  const v = updateVersionRow(versionId, { preQaReport: report, qaStatus: status, usesSdk: report.usesSdk });
  const harm = harmfulReason(report);
  if (harm && autoReject(versionId, harm)) return 'rejected';
  // BS Originals: a clean test-play publishes a submitted house-studio game (mirror of app.auto_approve).
  if (status === 'in_review' && report.status !== 'fail' && autoApproveOriginal(versionId)) return 'approved';
  if (minorUpdateOk(v) && takeToken(`minor-publish:${v.gameId}`, 3, 7 * 86_400_000)) {
    publishVersion(versionId);
    return 'approved';
  }
  return status;
}

function cleanEditable(input: Partial<GameEditable>): Partial<MockGame> {
  const out: Partial<MockGame> = {};
  if (input.slug != null) {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG.test(slug)) fail('invalid', 'The address can use lowercase letters, numbers and dashes.');
    out.slug = slug;
  }
  if (input.title != null) out.title = input.title.trim().slice(0, 80);
  if (input.shortDescription != null) out.shortDescription = input.shortDescription.slice(0, LIMITS.shortDescription);
  if (input.descriptionMd != null) out.descriptionMd = input.descriptionMd.slice(0, 20_000);
  if (input.howToPlayMd != null) out.howToPlayMd = input.howToPlayMd.slice(0, 10_000);
  if (input.featuresMd != null) out.featuresMd = input.featuresMd.slice(0, 10_000);
  if (input.tipsMd != null) out.tipsMd = input.tipsMd.slice(0, 10_000);
  if (input.controls != null) out.controls = input.controls.slice(0, 30);
  if (input.faq != null) out.faq = input.faq.slice(0, 20);
  if (input.category != null) {
    if (input.category && !PRIMARY_CATEGORY_SLUGS.includes(input.category)) fail('invalid', 'Pick a category.');
    out.category = input.category;
  }
  if (input.tags != null) out.tags = [...new Set(input.tags.map(tagSlug).filter(Boolean))].slice(0, LIMITS.maxTags);
  if (input.orientation != null) out.orientation = input.orientation;
  if (input.platforms != null) out.platforms = input.platforms;
  if (input.engine !== undefined) out.engine = input.engine;
  if (input.isMultiplayer != null) out.isMultiplayer = input.isMultiplayer;
  if (input.hasProgress != null) out.hasProgress = input.hasProgress;
  if (input.skills != null) out.skills = normaliseSkills(input.skills);
  if (input.maxScorePerSec !== undefined) out.maxScorePerSec = input.maxScorePerSec;
  if (input.wantsExclusive != null) out.wantsExclusive = input.wantsExclusive;
  return out;
}

async function putFile(key: string, blob: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${PLAY_ORIGIN}/__mock/upload/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      body: blob,
    });
  } catch {
    fail('unavailable', 'The local play server is not running. Start everything with `npm run dev`.');
  }
  if (!res.ok) fail('invalid', `Upload of ${key} failed (${res.status}).`);
}

async function uploadAll(prefix: string, files: { path: string; data: Blob }[], onProgress?: (f: number) => void) {
  const total = files.reduce((n, f) => n + f.data.size, 0) || 1;
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      await putFile(`${prefix}/${file.path}`, file.data);
      done += file.data.size;
      onProgress?.(done / total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
}

export function kpiEvents(): KpiEvent[] {
  return readTable('events').map((e) => ({
    anonId: e.anonId,
    sessionId: e.sessionId,
    gameId: e.gameId,
    type: e.type,
    ts: e.ts,
    payload: e.payload,
    country: e.country,
    refStudio: e.refStudio,
  }));
}

export function kpiRatings(): KpiRating[] {
  return readTable('ratings').map((r) => ({ gameId: r.gameId, value: r.value, reason: r.reason, createdAt: r.createdAt }));
}

/** KPIs of one game plus its percentile against games of the same category. */
export function kpisFor(gameId: string, from: string, to: string): KpiResult {
  const events = kpiEvents();
  const ratings = kpiRatings();
  const days = computeDailyKpis(events, ratings, gameId, from, to);
  const game = readTable('games').find((g) => g.id === gameId);
  const peers = readTable('games').filter((g) => g.category === game?.category && g.releasedAt);
  if (peers.length === 0) return { days, peers: 0, percentiles: null };
  const summaries = peers.map((p) => ({ id: p.id, s: summarise(p.id === gameId ? days : computeDailyKpis(events, ratings, p.id, from, to)) }));
  const mine = summaries.find((x) => x.id === gameId)?.s ?? summarise(days);
  return {
    days,
    peers: peers.length,
    percentiles: {
      conversion: percentRank(mine.conversion, summaries.map((x) => x.s.conversion)),
      session: percentRank(mine.avgSessionSec, summaries.map((x) => x.s.avgSessionSec)),
      d1: percentRank(mine.d1, summaries.map((x) => x.s.d1)),
      plays: percentRank(mine.plays, summaries.map((x) => x.s.plays)),
    },
  };
}

export const mockDev: DevRepo = {
  async myStudio() {
    const s = myStudioRow();
    return s ? toDevStudio(s) : null;
  },
  async createStudio(input) {
    const user = requireUser();
    if (!user.username) fail('login_required');
    if (myStudioRow()) fail('conflict', 'You already have a studio.');
    if (input.termsVersion !== DEVELOPER_TERMS_VERSION) fail('invalid', 'Accept the current developer terms.');
    if (input.holder === 'adult' && user.isMinor) fail('invalid', 'Under-18 developers need a guardian on the payout profile.');
    if (input.holder === 'minor_with_guardian' && (input.guardianName ?? '').trim().length < 3) fail('invalid', 'Enter your guardian’s full name.');
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) fail('invalid', 'The studio address can use lowercase letters, numbers and dashes.');
    if (readTable('studios').some((s) => s.slug === slug)) fail('conflict', 'That studio address is taken.');
    if (input.name.trim().length < 2) fail('invalid', 'Enter a studio name.');
    if (!/^[A-Z]{2}$/.test(input.country)) fail('invalid', 'Pick a country.');
    const row: MockStudio = {
      id: newId(),
      ownerId: user.id,
      slug,
      name: input.name.trim().slice(0, 60),
      bio: '',
      avatarUrl: null,
      country: input.country,
      contactEmail: input.contactEmail.trim(),
      links: [],
      isFirstParty: false,
      level: 'rookie',
      suspendedAt: null,
      verified: false,
      ...foundingTick(),
      termsVersion: input.termsVersion,
      termsAcceptedAt: nowIso(),
      guardianName: input.holder === 'minor_with_guardian' ? (input.guardianName ?? '').trim() : null,
      createdAt: nowIso(),
    };
    mutateTable('studios', (rows) => {
      rows.push(row);
    });
    sendMail(user.email, 'welcome_studio', { studio: row.name });
    emitTopic('studio');
    return toDevStudio(row);
  },
  async updateStudio(patch) {
    const s = requireStudio();
    mutateTable('studios', (rows) => {
      const row = rows.find((x) => x.id === s.id);
      if (!row) return;
      if (patch.name != null) row.name = patch.name.trim().slice(0, 60);
      if (patch.bio != null) row.bio = patch.bio.slice(0, 600);
      if (patch.avatarUrl !== undefined) row.avatarUrl = patch.avatarUrl;
      if (patch.contactEmail !== undefined) row.contactEmail = patch.contactEmail;
      if (patch.links != null) row.links = patch.links.filter((l) => /^https?:\/\//.test(l.url)).slice(0, 6);
    });
    emitTopic('studio');
  },
  async myGames() {
    const s = myStudioRow();
    if (!s) return [];
    return readTable('games')
      .filter((g) => g.studioId === s.id && g.status !== 'removed')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toDevGame);
  },
  async game(gameId) {
    const s = myStudioRow();
    const staff = requireUser().role !== 'player';
    const g = readTable('games').find((x) => x.id === gameId && (staff || x.studioId === s?.id));
    if (!g) return null;
    return detailFor(g);
  },
  async createGame(input) {
    const s = requireStudio();
    if (!takeToken(`create-game:${s.id}`, 20, 3_600_000)) fail('rate_limited');
    const fields = cleanEditable(input);
    if (!fields.slug || !fields.title) fail('invalid', 'A title and an address are required.');
    if (readTable('games').some((g) => g.slug === fields.slug)) fail('conflict', 'That address is taken.');
    const now = nowIso();
    const game: MockGame = {
      id: newId(),
      studioId: s.id,
      slug: fields.slug,
      title: fields.title,
      shortDescription: '',
      descriptionMd: '',
      howToPlayMd: '',
      controls: [],
      faq: [],
      featuresMd: '',
      tipsMd: '',
      category: 'arcade',
      tags: [],
      orientation: 'landscape',
      platforms: ['desktop', 'mobile', 'tablet'],
      engine: null,
      isMultiplayer: false,
      hasProgress: false,
      schoolSafe: false,
      sizeBytes: 0,
      initialLoadBytes: null,
      status: 'draft',
      sparkStartedAt: null,
      riseStartedAt: null,
      exclusiveUntil: null,
      currentVersionId: null,
      maxScorePerSec: null,
      wantsExclusive: false,
      createdAt: now,
      releasedAt: null,
      updatedAt: now,
      ...fields,
    };
    mutateTable('games', (rows) => {
      rows.push(game);
    });
    emitTopic('dev-games');
    return game.id;
  },
  async updateGame(gameId, patch) {
    const g = requireOwnGame(gameId);
    const fields = cleanEditable(patch);
    if (fields.slug && fields.slug !== g.slug) {
      if (g.releasedAt) fail('invalid', 'The address of a released game cannot change.');
      if (readTable('games').some((x) => x.slug === fields.slug && x.id !== gameId)) fail('conflict', 'That address is taken.');
    }
    if (!g.releasedAt) {
      updateGameRow(gameId, fields);
      emitTopic('dev-games');
      return;
    }
    // A released game: what players read waits for review (mirror of app.hold_live_edits).
    const { now, held } = splitLivePatch(g as unknown as Partial<GameEditable>, fields as Partial<GameEditable>);
    updateGameRow(gameId, now as Partial<MockGame>);
    if (Object.keys(held).length > 0) {
      const user = requireUser();
      mutateTable('pendingEdits', (rows) => {
        const row = rows.find((e) => e.gameId === gameId);
        if (row) Object.assign(row, { changes: { ...row.changes, ...held }, submittedBy: user.id, submittedAt: nowIso() });
        else rows.push({ gameId, changes: held, submittedBy: user.id, submittedAt: nowIso() });
      });
    }
    emitTopic('dev-games');
    emitTopic('qa');
  },
  async deleteGame(gameId) {
    const g = requireOwnGame(gameId);
    if (g.status !== 'draft') fail('invalid', 'Only drafts can be deleted. Pause or remove a released game instead.');
    mutateTable('games', (rows) => rows.filter((x) => x.id !== gameId));
    mutateTable('versions', (rows) => rows.filter((v) => v.gameId !== gameId));
    mutateTable('media', (rows) => rows.filter((m) => m.gameId !== gameId));
    emitTopic('dev-games');
  },
  async slugAvailable(slug, exceptGameId) {
    const s = slug.trim().toLowerCase();
    return SLUG.test(s) && !readTable('games').some((g) => g.slug === s && g.id !== exceptGameId);
  },
  async uploadMedia(gameId, media, onProgress) {
    const game = requireOwnGame(gameId);
    // A new file for a released game waits for review; the live one stays (app.guard_media).
    const held = Boolean(game.releasedAt);
    const id = newId();
    const isVideo = media.kind.startsWith('preview');
    const files = media.variants.map((v) => ({
      path: isVideo ? `${id}.${v.blob.type.includes('webm') ? 'webm' : 'mp4'}` : `${id}-${v.width}.webp`,
      data: v.blob,
    }));
    await uploadAll(`media/${gameId}`, files, onProgress);
    const widths = isVideo ? [] : media.variants.map((v) => v.width).sort((a, b) => a - b);
    const row = {
      id,
      gameId,
      kind: media.kind,
      url: `${PLAY_ORIGIN}/media/${gameId}/${isVideo ? files[0]!.path : `${id}-${Math.max(...widths)}.webp`}`,
      widths,
      width: media.width,
      height: media.height,
      placeholder: media.placeholder,
      variantLabel: media.variantLabel,
      phash: media.phash ?? null,
      isActive: !held,
      pending: held,
      createdAt: nowIso(),
    };
    mutateTable('media', (rows) => {
      // A new main cover replaces the old one; A/B variants sit beside it. For a released game
      // only an earlier waiting file is replaced.
      const same = (m: MockMedia) => m.gameId === gameId && m.kind === media.kind && m.variantLabel === media.variantLabel && (!held || m.pending);
      const rest = rows.filter((m) => !same(m));
      rest.push(row);
      return rest;
    });
    updateGameRow(gameId, {});
    emitTopic('dev-games');
    if (held) emitTopic('qa');
    return { ...row, pending: held };
  },
  async removeMedia(gameId, mediaId) {
    const g = requireOwnGame(gameId);
    const m = readTable('media').find((x) => x.id === mediaId && x.gameId === gameId);
    if (m && g.releasedAt && !m.pending && m.variantLabel == null && m.isActive) {
      fail('invalid', 'Upload a replacement instead: a released game always keeps its reviewed cover and video.');
    }
    mutateTable('media', (rows) => rows.filter((x) => !(x.id === mediaId && x.gameId === gameId)));
    updateGameRow(gameId, {});
    emitTopic('dev-games');
  },
  async discardPendingEdit(gameId) {
    requireOwnGame(gameId);
    mutateTable('pendingEdits', (rows) => rows.filter((e) => e.gameId !== gameId));
    mutateTable('media', (rows) => rows.filter((m) => !(m.gameId === gameId && m.pending)));
    emitTopic('dev-games');
    emitTopic('qa');
  },
  async publishMinorUpdate(versionId) {
    const v = readTable('versions').find((x) => x.id === versionId);
    if (!v) fail('not_found');
    requireOwnGame(v.gameId);
    if (!minorUpdateOk(v)) fail('invalid', 'This update is too different from the reviewed build. Send it for review instead.');
    if (!takeToken(`minor-publish:${v.gameId}`, 3, 7 * 86_400_000)) fail('rate_limited');
    publishVersion(versionId);
    emitTopic('dev-games');
    emitTopic('catalogue');
  },
  async createVersion(input, onProgress) {
    const g = requireOwnGame(input.gameId);
    if (!/^[0-9a-zA-Z][0-9a-zA-Z._-]{0,19}$/.test(input.version)) fail('invalid', 'Versions look like 1, 1.2 or 2.0.1.');
    if (readTable('versions').some((v) => v.gameId === g.id && v.version === input.version)) {
      fail('conflict', `Version ${input.version} already exists.`);
    }
    const totalBytes = input.files.reduce((n, f) => n + f.data.size, 0);
    if (input.files.length > LIMITS.zipMaxFiles || totalBytes > LIMITS.zipMaxBytes) fail('invalid', 'The build is too large.');
    const prefix = `${g.id}/${input.version}`;
    await uploadAll(prefix, input.files, onProgress);
    const previewToken = uuid().replace(/-/g, '');
    const row: MockVersion = {
      id: newId(),
      gameId: g.id,
      version: input.version,
      storagePrefix: prefix,
      fileCount: input.files.length,
      fingerprint: input.fingerprint ?? null,
      assetHashes: input.assetHashes?.slice(0, 2000) ?? null,
      totalBytes,
      entryFile: input.entryFile,
      usesSdk: input.usesSdk,
      preQaReport: null,
      qaStatus: 'uploaded',
      qaNotes: null,
      previewToken,
      minorUpdate: input.minorUpdate,
      createdAt: nowIso(),
    };
    mutateTable('versions', (rows) => {
      rows.push(row);
    });
    updateGameRow(g.id, {});
    emitTopic('dev-games');
    return { versionId: row.id, previewToken };
  },
  async submitForReview(gameId, declaration) {
    const g = requireOwnGame(gameId);
    const versions = readTable('versions')
      .filter((v) => v.gameId === gameId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = versions[0];
    if (!latest) fail('invalid', 'Upload a build first.');
    if (!['uploaded', 'pre_qa_running', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed'].includes(latest.qaStatus)) {
      fail('invalid', 'Upload a build first.');
    }
    const missing = submissionGaps(g, readTable('media').filter((m) => m.gameId === gameId && m.isActive));
    if (missing.length) fail('invalid', `Still needed: ${missing.join(', ')}.`);
    if (!declaration?.ownsRights || !declaration.noCopies) fail('invalid', 'Confirm that you own or have licensed everything in the game.');
    if (!latest.previewedAt) fail('invalid', 'Play your build in the preview first.');
    const review = autoReviewFor(g, latest, declaration);
    updateVersionRow(latest.id, { qaStatus: 'in_review', submittedAt: nowIso(), reviewedAt: null, declaration, autoReview: review });
    if (['draft', 'changes_requested', 'paused'].includes(g.status)) updateGameRow(gameId, { status: 'in_review' });
    const reason = autoRejectReason(review);
    if (reason && autoReject(latest.id, reason)) {
      emitTopic('dev-games');
      return { rejected: true, reason };
    }
    sendMail(studioEmail(g.studioId), 'submission_received', { game: g.title, version: latest.version, studio: readTable('studios').find((x) => x.id === g.studioId)?.name, gameId });
    // The server's part: test-play the build now. Mock mode waits for the local bot so the report
    // is in place when the page moves on; harmful code is rejected here too.
    if (!latest.preQaReport) {
      const report = await runMockPreQa(latest.id).catch(() => null);
      const harm = report ? harmfulReason(report) : null;
      if (harm && readTable('versions').find((x) => x.id === latest.id)?.qaStatus === 'rejected') {
        emitTopic('dev-games');
        return { rejected: true, reason: harm };
      }
    }
    emitTopic('dev-games');
    emitTopic('qa');
    return { rejected: false, reason: null };
  },
  async rollback(gameId, versionId) {
    requireOwnGame(gameId);
    const v = readTable('versions').find((x) => x.id === versionId && x.gameId === gameId);
    if (!v || v.qaStatus !== 'approved') fail('invalid', 'Only approved versions can be restored.');
    publishVersion(versionId);
    audit(requireUser().id, 'rollback', 'game', gameId, { versionId });
    emitTopic('dev-games');
    emitTopic('catalogue');
  },
  async setStatus(gameId, status) {
    const g = requireOwnGame(gameId);
    if (status === 'paused' && !['spark', 'rise', 'featured'].includes(g.status)) fail('invalid');
    updateGameRow(gameId, { status });
    audit(requireUser().id, 'set_game_status', 'game', gameId, { status });
    emitTopic('dev-games');
    emitTopic('catalogue');
  },
  async kpis(gameId, from, to) {
    if (requireUser().role === 'player') requireOwnGame(gameId);
    return kpisFor(gameId, from, to);
  },
  async feedback() {
    const s = myStudioRow();
    if (!s) return [];
    const games = new Map(readTable('games').filter((g) => g.studioId === s.id).map((g) => [g.id, g.title]));
    return readTable('feedback')
      .filter((f) => games.has(f.gameId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((f) => ({
        id: f.id,
        gameId: f.gameId,
        gameTitle: games.get(f.gameId) ?? '',
        versionId: f.versionId,
        category: f.category,
        message: f.message,
        context: f.context,
        device: f.device,
        status: f.status,
        createdAt: f.createdAt,
      }));
  },
  async resolveFeedback(id, resolved) {
    const s = requireStudio();
    const own = new Set(readTable('games').filter((g) => g.studioId === s.id).map((g) => g.id));
    mutateTable('feedback', (rows) => {
      const row = rows.find((f) => f.id === id && own.has(f.gameId));
      if (row) row.status = resolved ? 'resolved' : 'open';
    });
    emitTopic('dev-games');
  },
  async devlogs() {
    const s = myStudioRow();
    if (!s) return [];
    return readTable('devlogs')
      .filter((d) => d.studioId === s.id)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((d) => ({ id: d.id, gameId: d.gameId, title: d.title, bodyMd: d.bodyMd, publishedAt: d.publishedAt, hidden: Boolean(d.hiddenAt) }));
  },
  async saveDevlog(input) {
    const s = requireStudio();
    if (input.title.trim().length < 3) fail('invalid', 'Give the devlog a title.');
    if (input.gameId) requireOwnGame(input.gameId);
    mutateTable('devlogs', (rows) => {
      const existing = input.id ? rows.find((d) => d.id === input.id && d.studioId === s.id) : undefined;
      if (existing) {
        existing.title = input.title.trim().slice(0, 120);
        existing.bodyMd = input.bodyMd.slice(0, 20_000);
        existing.gameId = input.gameId;
      } else {
        rows.push({ id: newId(), studioId: s.id, gameId: input.gameId, title: input.title.trim().slice(0, 120), bodyMd: input.bodyMd.slice(0, 20_000), publishedAt: nowIso(), hiddenAt: null });
        // Followers hear about a new devlog (mirror of the devlogs_notify trigger).
        for (const f of readTable('followers')) {
          if (f.studioId === s.id) notify(f.userId, 'devlog', input.title.trim().slice(0, 120), s.name, `/studio/${s.slug}/`);
        }
        emitTopic('notifications');
      }
    });
    emitTopic('devlogs');
    emitTopic('catalogue');
  },
  async deleteDevlog(id) {
    const s = requireStudio();
    mutateTable('devlogs', (rows) => rows.filter((d) => !(d.id === id && d.studioId === s.id)));
    emitTopic('devlogs');
  },
  async referralStats() {
    const s = myStudioRow();
    if (!s) return null;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const events = readTable('events').filter((e) => e.refStudio === s.slug && e.ts >= since);
    return {
      link: `${SITE_URL}/?ref=${s.slug}`,
      visits30d: new Set(events.map((e) => e.anonId)).size,
      adImpressions30d: events.filter((e) => e.type === 'ad_started').length,
    };
  },
  async markPreviewed(versionId) {
    const v = readTable('versions').find((x) => x.id === versionId);
    const g = v && readTable('games').find((x) => x.id === v.gameId);
    const me = currentMockUser();
    const owner = g && readTable('studios').find((s) => s.id === g.studioId)?.ownerId;
    if (!v || !me || owner !== me.id) return;
    if (!v.previewedAt) updateVersionRow(versionId, { previewedAt: nowIso() });
    emitTopic('dev-games');
  },
  async preview(versionId, token): Promise<PreviewInfo | null> {
    const v = readTable('versions').find((x) => x.id === versionId && x.previewToken === token);
    if (!v) return null;
    const g = readTable('games').find((x) => x.id === v.gameId);
    if (!g) return null;
    return {
      gameId: g.id,
      title: g.title,
      slug: g.slug,
      orientation: g.orientation,
      versionId: v.id,
      version: v.version,
      playPath: `${v.storagePrefix}/${v.entryFile}`,
      usesSdk: v.usesSdk,
      totalBytes: v.totalBytes,
      qaStatus: v.qaStatus as PreviewInfo['qaStatus'],
      gameStatus: g.status,
      preQaReport: (v.preQaReport ?? null) as PreviewInfo['preQaReport'],
    };
  },
};

export function detailFor(g: MockGame): DevGameDetail {
  const live = toDevGame(g);
  const changes = pendingChangesFor(g.id);
  const fields = HELD_FIELDS.filter((f) => f in changes);
  const held = readTable('pendingEdits').find((e) => e.gameId === g.id);
  return {
    // The developer edits their latest text; players keep the reviewed text until it is approved.
    game: { ...live, ...changes },
    pendingEdit: held && fields.length > 0
      ? { fields: [...fields], live: Object.fromEntries(fields.map((f) => [f, live[f]])), submittedAt: held.submittedAt }
      : null,
    versions: readTable('versions')
      .filter((v) => v.gameId === g.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((v) => toDevVersion(v, g.currentVersionId)),
    media: mediaFor(g.id),
    launches: readTable('launches')
      .filter((l) => l.gameId === g.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((l) => ({ tier: l.tier, startedAt: l.startedAt, endedAt: l.endedAt, decision: l.decision, reason: l.reason })),
    reviews: readTable('reviews')
      .filter((r) => r.gameId === g.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ action: r.action, notes: r.notes, createdAt: r.createdAt, versionId: r.versionId })),
  };
}
