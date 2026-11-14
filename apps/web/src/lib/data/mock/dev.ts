import { PRIMARY_CATEGORY_SLUGS, tagSlug } from '@/lib/catalogue/categories';
import { DEVELOPER_TERMS_VERSION, LIMITS, PLAY_ORIGIN, SITE_URL } from '@/lib/config';
import { computeDailyKpis, percentRank, summarise, type KpiEvent, type KpiRating, type KpiResult } from '@/lib/domain/kpis';
import type { PreQaReport } from '@/lib/domain/preqa';
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
} from '../devTypes';
import type { DevRepo } from '../repo';
import { readCatalogueTables, statsFor } from './catalogue';
import { requireUser } from './auth';
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
    qaStatus: v.qaStatus as QaStatus,
    qaNotes: v.qaNotes,
    createdAt: v.createdAt,
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
    }));
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

export function ownerOf(gameId: string): string | null {
  const g = readTable('games').find((x) => x.id === gameId);
  return readTable('studios').find((s) => s.id === g?.studioId)?.ownerId ?? null;
}

/** The address to write to about a studio: its owner's account, else its contact address. */
export function studioEmail(studioId: string | null | undefined): string | null {
  const studio = readTable('studios').find((s) => s.id === studioId);
  return readTable('users').find((u) => u.id === studio?.ownerId)?.email ?? studio?.contactEmail ?? null;
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

/** Stores a pre-QA report (mirror of set_pre_qa_report). Minor updates of live games auto-publish. */
export function applyPreQaReport(versionId: string, report: PreQaReport): QaStatus {
  const status: QaStatus = report.status === 'pass' ? 'pre_qa_passed' : report.status === 'warn' ? 'pre_qa_warn' : 'pre_qa_failed';
  const v = updateVersionRow(versionId, { preQaReport: report, qaStatus: status, usesSdk: report.usesSdk });
  const g = readTable('games').find((x) => x.id === v.gameId);
  if (report.status === 'pass' && v.minorUpdate && g && (g.status === 'rise' || g.status === 'featured')) {
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
      verified: false,
      isFirstParty: false,
      level: 'rookie',
      suspendedAt: null,
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
    updateGameRow(gameId, fields);
    emitTopic('dev-games');
    if (g.releasedAt) emitTopic('catalogue');
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
    requireOwnGame(gameId);
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
      isActive: true,
      createdAt: nowIso(),
    };
    mutateTable('media', (rows) => {
      // A new main cover replaces the old one; A/B variants sit beside it.
      for (const m of rows) {
        if (m.gameId === gameId && m.kind === media.kind && m.variantLabel === media.variantLabel) m.isActive = false;
      }
      const rest = rows.filter((m) => !(m.gameId === gameId && m.kind === media.kind && m.variantLabel === media.variantLabel));
      rest.push(row);
      return rest;
    });
    updateGameRow(gameId, {});
    emitTopic('dev-games');
    return { ...row };
  },
  async removeMedia(gameId, mediaId) {
    requireOwnGame(gameId);
    mutateTable('media', (rows) => rows.filter((m) => !(m.id === mediaId && m.gameId === gameId)));
    updateGameRow(gameId, {});
    emitTopic('dev-games');
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
  async runPreQa(versionId) {
    const v = readTable('versions').find((x) => x.id === versionId);
    if (!v) fail('not_found');
    requireOwnGame(v.gameId);
    updateVersionRow(versionId, { qaStatus: 'pre_qa_running' });
    emitTopic('dev-games');
    let report: PreQaReport & { reason?: string };
    try {
      const res = await fetch(`${PLAY_ORIGIN}/__mock/pre-qa`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${PLAY_ORIGIN}/${v.storagePrefix}/${v.entryFile}` }),
      });
      report = (await res.json()) as PreQaReport & { reason?: string };
    } catch {
      updateVersionRow(versionId, { qaStatus: 'uploaded' });
      emitTopic('dev-games');
      fail('unavailable', 'The local pre-QA runner is not reachable. Start everything with `npm run dev`.');
    }
    if (!report || !Array.isArray(report.checks)) {
      updateVersionRow(versionId, { qaStatus: 'uploaded' });
      emitTopic('dev-games');
      fail('unavailable', report?.reason ?? 'The pre-QA bot could not run.');
    }
    applyPreQaReport(versionId, report);
    emitTopic('dev-games');
    emitTopic('catalogue');
    return report;
  },
  async submitForReview(gameId) {
    const g = requireOwnGame(gameId);
    const versions = readTable('versions')
      .filter((v) => v.gameId === gameId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = versions[0];
    if (!latest) fail('invalid', 'Upload a build first.');
    if (latest.qaStatus !== 'pre_qa_passed' && latest.qaStatus !== 'pre_qa_warn') {
      fail('invalid', 'The latest build needs a pre-QA report without failures.');
    }
    if (g.faq.length < LIMITS.minFaq || !g.shortDescription || !g.descriptionMd) {
      fail('invalid', 'Fill in the short description, the description and at least 3 FAQ entries.');
    }
    if (!readTable('media').some((m) => m.gameId === gameId && m.kind === 'cover_landscape' && m.isActive)) {
      fail('invalid', 'Add a landscape cover.');
    }
    updateVersionRow(latest.id, { qaStatus: 'in_review' });
    if (['draft', 'changes_requested', 'paused'].includes(g.status)) updateGameRow(gameId, { status: 'in_review' });
    sendMail(studioEmail(g.studioId), 'submission_received', { game: g.title, version: latest.version, studio: readTable('studios').find((x) => x.id === g.studioId)?.name, gameId });
    emitTopic('dev-games');
    emitTopic('qa');
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
    };
  },
};

export function detailFor(g: MockGame): DevGameDetail {
  return {
    game: toDevGame(g),
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
