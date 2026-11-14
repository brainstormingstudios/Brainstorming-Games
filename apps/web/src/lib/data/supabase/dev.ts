import { SITE_URL } from '@/lib/config';
import { summarise, type DailyKpi, type KpiResult } from '@/lib/domain/kpis';
import { isSparkWindowOver } from '@/lib/domain/spark';
import type { PreQaReport } from '@/lib/domain/preqa';
import { emitTopic } from '../bus';
import type {
  DevGame,
  DevGameDetail,
  DevMedia,
  DevStudio,
  DevVersion,
  GameEditable,
  PreviewInfo,
  QaQueueItem,
  QaStatus,
  SparkRow,
  AutoReviewReport,
} from '../devTypes';
import { RepoError, type AdminRepo, type DevRepo } from '../repo';
import type { MediaAsset } from '../types';
import { callFunction } from './account';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Row = Record<string, unknown>;

const check = <T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T => {
  if (error) throw toRepoError(error);
  return data;
};

function toStudio(r: Row): DevStudio {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    bio: String(r.bio ?? ''),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    contactEmail: (r.contact_email as string | null) ?? null,
    links: (r.links as DevStudio['links']) ?? [],
    verified: Boolean(r.verified),
    isFirstParty: Boolean(r.is_first_party),
    level: (r.level as DevStudio['level']) ?? 'rookie',
    suspended: Boolean(r.suspended_at),
    termsVersion: (r.terms_version as string | null) ?? null,
    termsAcceptedAt: (r.terms_accepted_at as string | null) ?? null,
    guardianName: (r.guardian_name as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function toGame(r: Row): DevGame {
  const stats = (r.game_stats as { plays_total?: number; rating10?: number | null } | null) ?? null;
  return {
    id: String(r.id),
    studioId: String(r.studio_id),
    slug: String(r.slug),
    title: String(r.title),
    shortDescription: String(r.short_description ?? ''),
    descriptionMd: String(r.description_md ?? ''),
    howToPlayMd: String(r.how_to_play_md ?? ''),
    controls: (r.controls as DevGame['controls']) ?? [],
    faq: (r.faq as DevGame['faq']) ?? [],
    featuresMd: String(r.features_md ?? ''),
    tipsMd: String(r.tips_md ?? ''),
    category: String(r.category ?? ''),
    tags: (r.tags as string[]) ?? [],
    orientation: r.orientation as DevGame['orientation'],
    platforms: (r.platforms as DevGame['platforms']) ?? [],
    engine: (r.engine as string | null) ?? null,
    isMultiplayer: Boolean(r.is_multiplayer),
    hasProgress: Boolean(r.has_progress),
    maxScorePerSec: (r.max_score_per_sec as number | null) ?? null,
    wantsExclusive: Boolean(r.wants_exclusive),
    status: r.status as DevGame['status'],
    schoolSafe: Boolean(r.school_safe),
    sparkStartedAt: (r.spark_started_at as string | null) ?? null,
    riseStartedAt: (r.rise_started_at as string | null) ?? null,
    releasedAt: (r.released_at as string | null) ?? null,
    exclusiveUntil: (r.exclusive_until as string | null) ?? null,
    currentVersionId: (r.current_version_id as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    plays: Number(stats?.plays_total ?? 0),
    rating10: stats?.rating10 == null ? null : Number(stats.rating10),
  };
}

function toVersion(r: Row, currentId: string | null): DevVersion {
  return {
    id: String(r.id),
    gameId: String(r.game_id),
    version: String(r.version),
    storagePrefix: String(r.storage_prefix),
    fileCount: Number(r.file_count),
    totalBytes: Number(r.total_bytes),
    entryFile: String(r.entry_file),
    usesSdk: Boolean(r.uses_sdk),
    minorUpdate: Boolean(r.minor_update),
    preQaReport: (r.pre_qa_report as PreQaReport | null) ?? null,
    autoReview: (r.auto_review as AutoReviewReport | null) ?? null,
    qaStatus: r.qa_status as QaStatus,
    qaNotes: (r.qa_notes as string | null) ?? null,
    createdAt: String(r.created_at),
    isCurrent: r.id === currentId,
  };
}

function toMedia(r: Row): DevMedia {
  return {
    id: String(r.id),
    kind: r.kind as MediaAsset['kind'],
    url: String(r.url),
    widths: (r.widths as number[]) ?? [],
    width: Number(r.width),
    height: Number(r.height),
    placeholder: (r.placeholder as string | null) ?? null,
    variantLabel: (r.variant_label as string | null) ?? null,
    isActive: Boolean(r.is_active),
  };
}

function editableToRow(p: Partial<GameEditable>): Row {
  const map: Record<keyof GameEditable, string> = {
    slug: 'slug',
    title: 'title',
    shortDescription: 'short_description',
    descriptionMd: 'description_md',
    howToPlayMd: 'how_to_play_md',
    controls: 'controls',
    faq: 'faq',
    featuresMd: 'features_md',
    tipsMd: 'tips_md',
    category: 'category',
    tags: 'tags',
    orientation: 'orientation',
    platforms: 'platforms',
    engine: 'engine',
    isMultiplayer: 'is_multiplayer',
    hasProgress: 'has_progress',
    maxScorePerSec: 'max_score_per_sec',
    wantsExclusive: 'wants_exclusive',
  };
  const out: Row = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined) out[map[k as keyof GameEditable]] = v;
  return out;
}

function toKpis(data: unknown): KpiResult {
  const d = (data ?? {}) as { days?: Row[]; peers?: number; percentiles?: Row | null };
  const n = (v: unknown) => (v == null ? null : Number(v));
  const days: DailyKpi[] = (d.days ?? []).map((r) => ({
    day: String(r.day),
    plays: Number(r.plays ?? 0),
    players: Number(r.players ?? 0),
    newPlayers: Number(r.new_players ?? 0),
    conversion1min: n(r.conversion_1min),
    avgSessionSec: n(r.avg_session_sec),
    d1Retention: n(r.d1_retention),
    d7Retention: n(r.d7_retention),
    adImpressions: Number(r.ad_impressions ?? 0),
    adImpressionsByCountry: (r.ad_impressions_by_country as Record<string, number>) ?? {},
    refAdImpressions: Number(r.ref_ad_impressions ?? 0),
    likes: Number(r.likes ?? 0),
    dislikes: Number(r.dislikes ?? 0),
    dislikeReasons: (r.dislike_reasons as Record<string, number>) ?? {},
    loadMsP50: n(r.load_ms_p50),
    loadMsP90: n(r.load_ms_p90),
  }));
  const p = d.percentiles;
  return {
    days,
    peers: Number(d.peers ?? 0),
    percentiles: p
      ? { conversion: Number(p.conversion_pct ?? 0), session: Number(p.session_pct ?? 0), d1: Number(p.d1_pct ?? 0), plays: Number(p.plays_pct ?? 0) }
      : null,
  };
}

async function myStudioRow(): Promise<Row | null> {
  const db = getSupabase();
  const { data: auth } = await db.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return null;
  return check(await db.from('studios').select('*').eq('owner_id', uid).maybeSingle<Row>());
}

async function detail(gameId: string): Promise<DevGameDetail | null> {
  const db = getSupabase();
  const game = check(await db.from('games').select('*, game_stats(plays_total, rating10)').eq('id', gameId).maybeSingle<Row>());
  if (!game) return null;
  const [versions, media, launches, reviews] = await Promise.all([
    db.from('game_versions').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
    db.from('game_media').select('*').eq('game_id', gameId),
    db.from('game_launches').select('*').eq('game_id', gameId).order('started_at', { ascending: false }),
    db.from('qa_reviews').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
  ]);
  const g = toGame(game);
  return {
    game: g,
    versions: (check(versions) ?? []).map((v) => toVersion(v as Row, g.currentVersionId)),
    media: (check(media) ?? []).map((m) => toMedia(m as Row)),
    launches: (check(launches) ?? []).map((l) => {
      const r = l as Row;
      return {
        tier: r.tier as 'spark' | 'rise' | 'featured',
        startedAt: String(r.started_at),
        endedAt: (r.ended_at as string | null) ?? null,
        decision: (r.decision as 'promoted' | 'declined' | null) ?? null,
        reason: (r.reason as string | null) ?? null,
      };
    }),
    reviews: (check(reviews) ?? []).map((x) => {
      const r = x as Row;
      return { action: r.action as 'approve' | 'changes' | 'reject', notes: String(r.notes ?? ''), createdAt: String(r.created_at), versionId: String(r.version_id) };
    }),
  };
}

async function putSigned(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
  if (!res.ok) throw new RepoError('unavailable', `Upload failed (${res.status})`);
}

export const supabaseDev: DevRepo = {
  async myStudio() {
    const row = await myStudioRow();
    return row ? toStudio(row) : null;
  },
  async createStudio(input) {
    check(
      await getSupabase().rpc('create_studio', {
        p_name: input.name,
        p_slug: input.slug,
        p_country: input.country,
        p_contact_email: input.contactEmail,
        p_terms_version: input.termsVersion,
        p_holder: input.holder,
        p_guardian_name: input.guardianName ?? null,
      }),
    );
    emitTopic('studio');
    const row = await myStudioRow();
    if (!row) throw new RepoError('unavailable');
    return toStudio(row);
  },
  async updateStudio(patch) {
    const row = await myStudioRow();
    if (!row) throw new RepoError('not_allowed');
    check(
      await getSupabase()
        .from('studios')
        .update({ name: patch.name, bio: patch.bio, avatar_url: patch.avatarUrl, links: patch.links, contact_email: patch.contactEmail })
        .eq('id', String(row.id)),
    );
    emitTopic('studio');
  },
  async myGames() {
    const row = await myStudioRow();
    if (!row) return [];
    const data = check(
      await getSupabase()
        .from('games')
        .select('*, game_stats(plays_total, rating10)')
        .eq('studio_id', String(row.id))
        .neq('status', 'removed')
        .order('updated_at', { ascending: false }),
    );
    return (data ?? []).map((r) => toGame(r as Row));
  },
  game: detail,
  async createGame(input) {
    const studio = await myStudioRow();
    if (!studio) throw new RepoError('not_allowed');
    const data = check(
      await getSupabase()
        .from('games')
        .insert({ ...editableToRow(input), studio_id: studio.id })
        .select('id')
        .single<{ id: string }>(),
    );
    if (!data) throw new RepoError('unavailable');
    emitTopic('dev-games');
    return data.id;
  },
  async updateGame(gameId, patch) {
    check(await getSupabase().from('games').update(editableToRow(patch)).eq('id', gameId));
    emitTopic('dev-games');
  },
  async deleteGame(gameId) {
    check(await getSupabase().from('games').delete().eq('id', gameId).eq('status', 'draft'));
    emitTopic('dev-games');
  },
  async slugAvailable(slug, exceptGameId) {
    const db = getSupabase();
    const [publicHit, ownHit] = await Promise.all([
      db.from('game_cards').select('id').eq('slug', slug).maybeSingle<{ id: string }>(),
      db.from('games').select('id').eq('slug', slug).maybeSingle<{ id: string }>(),
    ]);
    const ids = [check(publicHit)?.id, check(ownHit)?.id].filter(Boolean);
    return ids.every((id) => id === exceptGameId);
  },
  async uploadMedia(gameId, media, onProgress) {
    const db = getSupabase();
    const id = crypto.randomUUID();
    const isVideo = media.kind.startsWith('preview');
    let done = 0;
    const paths: string[] = [];
    for (const v of media.variants) {
      const path = isVideo ? `${gameId}/${id}.${v.blob.type.includes('webm') ? 'webm' : 'mp4'}` : `${gameId}/${id}-${v.width}.webp`;
      check(await db.storage.from('media').upload(path, v.blob, { contentType: v.blob.type, upsert: false, cacheControl: '31536000' }));
      paths.push(path);
      onProgress?.(++done / media.variants.length);
    }
    const widths = isVideo ? [] : media.variants.map((v) => v.width).sort((a, b) => a - b);
    const mainPath = isVideo ? paths[0]! : `${gameId}/${id}-${Math.max(...widths)}.webp`;
    const url = db.storage.from('media').getPublicUrl(mainPath).data.publicUrl;
    // A new main cover replaces the old one; A/B variants sit beside it.
    let replace = db.from('game_media').delete().eq('game_id', gameId).eq('kind', media.kind);
    replace = media.variantLabel ? replace.eq('variant_label', media.variantLabel) : replace.is('variant_label', null);
    check(await replace);
    const row = check(
      await db
        .from('game_media')
        .insert({
          game_id: gameId,
          kind: media.kind,
          url,
          widths,
          width: media.width,
          height: media.height,
          placeholder: media.placeholder,
          variant_label: media.variantLabel,
          phash: media.phash ?? null,
        })
        .select('*')
        .single<Row>(),
    );
    if (!row) throw new RepoError('unavailable');
    emitTopic('dev-games');
    return toMedia(row);
  },
  async removeMedia(gameId, mediaId) {
    check(await getSupabase().from('game_media').delete().eq('id', mediaId).eq('game_id', gameId));
    emitTopic('dev-games');
  },
  async createVersion(input, onProgress) {
    const created = check(
      await getSupabase().rpc('add_game_version', {
        p_game_id: input.gameId,
        p_version: input.version,
        p_file_count: input.files.length,
        p_total_bytes: input.files.reduce((n, f) => n + f.data.size, 0),
        p_entry_file: input.entryFile,
        p_uses_sdk: input.usesSdk,
        p_minor_update: input.minorUpdate,
      }),
    ) as { version_id: string; preview_token: string };
    if (input.fingerprint) {
      check(await getSupabase().rpc('set_build_fingerprint', { p_version: created.version_id, p_fingerprint: input.fingerprint }));
    }
    // Presigned R2 URLs, requested in batches so each Edge Function call stays small.
    const total = input.files.reduce((n, f) => n + f.data.size, 0) || 1;
    let sent = 0;
    for (let i = 0; i < input.files.length; i += 100) {
      const batch = input.files.slice(i, i + 100);
      const { urls } = await callFunction<{ urls: Record<string, string> }>('presign-upload', {
        versionId: created.version_id,
        files: batch.map((f) => ({ path: f.path, size: f.data.size, type: f.data.type })),
      });
      const queue = [...batch];
      const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          const url = urls[f.path];
          if (!url) throw new RepoError('unavailable', `No upload URL for ${f.path}`);
          await putSigned(url, f.data);
          sent += f.data.size;
          onProgress?.(sent / total);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, batch.length) }, worker));
    }
    emitTopic('dev-games');
    return { versionId: created.version_id, previewToken: created.preview_token };
  },
  async runPreQa(versionId) {
    check(await getSupabase().rpc('mark_pre_qa_running', { p_version_id: versionId }));
    await callFunction('pre-qa-dispatch', { versionId });
    emitTopic('dev-games');
    // The report arrives asynchronously from the GitHub Actions runner.
    return null;
  },
  async submitForReview(gameId, declaration) {
    // The Edge Function submits (the database checks the rules) and then runs the auto-review
    // with the service role, so a developer cannot write their own review.
    await callFunction('submit-game', { gameId, declaration });
    emitTopic('dev-games');
    emitTopic('qa');
  },
  async rollback(gameId, versionId) {
    check(await getSupabase().rpc('rollback_version', { p_game_id: gameId, p_version_id: versionId }));
    emitTopic('dev-games');
  },
  async setStatus(gameId, status) {
    check(await getSupabase().rpc('set_game_status', { p_game_id: gameId, p_status: status, p_reason: '' }));
    emitTopic('dev-games');
  },
  async kpis(gameId, from, to) {
    return toKpis(check(await getSupabase().rpc('game_kpis', { p_game_id: gameId, p_from: from, p_to: to })));
  },
  async feedback() {
    const data = check(
      await getSupabase().from('feedback').select('*, games(title)').order('created_at', { ascending: false }).limit(300),
    );
    return (data ?? []).map((x) => {
      const r = x as Row;
      return {
        id: String(r.id),
        gameId: String(r.game_id),
        gameTitle: String((r.games as { title?: string } | null)?.title ?? ''),
        versionId: (r.version_id as string | null) ?? null,
        category: r.category as 'bug',
        message: String(r.message),
        context: (r.context as Record<string, unknown> | null) ?? null,
        device: String(r.device ?? ''),
        status: r.status as 'open' | 'resolved',
        createdAt: String(r.created_at),
      };
    });
  },
  async resolveFeedback(id, resolved) {
    check(await getSupabase().from('feedback').update({ status: resolved ? 'resolved' : 'open' }).eq('id', id));
    emitTopic('dev-games');
  },
  async devlogs() {
    const studio = await myStudioRow();
    if (!studio) return [];
    const data = check(await getSupabase().from('devlogs').select('*').eq('studio_id', String(studio.id)).order('published_at', { ascending: false }));
    return (data ?? []).map((x) => {
      const r = x as Row;
      return { id: String(r.id), gameId: (r.game_id as string | null) ?? null, title: String(r.title), bodyMd: String(r.body_md), publishedAt: String(r.published_at), hidden: Boolean(r.hidden_at) };
    });
  },
  async saveDevlog(input) {
    const studio = await myStudioRow();
    if (!studio) throw new RepoError('not_allowed');
    const db = getSupabase();
    const row = { studio_id: studio.id, game_id: input.gameId, title: input.title, body_md: input.bodyMd };
    check(input.id ? await db.from('devlogs').update(row).eq('id', input.id) : await db.from('devlogs').insert(row));
    emitTopic('devlogs');
  },
  async deleteDevlog(id) {
    check(await getSupabase().from('devlogs').delete().eq('id', id));
    emitTopic('devlogs');
  },
  async referralStats() {
    const studio = await myStudioRow();
    if (!studio) return null;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { count } = await getSupabase()
      .from('referral_visits')
      .select('id', { count: 'exact', head: true })
      .eq('studio_slug', String(studio.slug))
      .gte('landed_at', since);
    const kpi = check(await getSupabase().from('daily_game_kpis').select('ref_ad_impressions, games!inner(studio_id)').eq('games.studio_id', String(studio.id)).gte('day', since.slice(0, 10)));
    const impressions = (kpi ?? []).reduce((n, r) => n + Number((r as Row).ref_ad_impressions ?? 0), 0);
    return { link: `${SITE_URL}/?ref=${String(studio.slug)}`, visits30d: count ?? 0, adImpressions30d: impressions };
  },
  async preview(versionId, token) {
    const data = check(await getSupabase().rpc('preview_version', { p_version_id: versionId, p_token: token })) as Row | null;
    if (!data) return null;
    return {
      gameId: String(data.game_id),
      title: String(data.title),
      slug: String(data.slug),
      orientation: data.orientation as 'landscape',
      versionId: String(data.version_id),
      version: String(data.version),
      playPath: `${String(data.storage_prefix)}/${String(data.entry_file)}`,
      usesSdk: Boolean(data.uses_sdk),
      totalBytes: Number(data.total_bytes ?? 0),
      qaStatus: (data.qa_status ?? 'uploaded') as PreviewInfo['qaStatus'],
      gameStatus: (data.game_status ?? 'draft') as PreviewInfo['gameStatus'],
      preQaReport: (data.pre_qa_report ?? null) as PreviewInfo['preQaReport'],
    };
  },
};

export const supabaseAdmin: AdminRepo = {
  async qaQueue() {
    const data = check(
      await getSupabase()
        .from('game_versions')
        .select('id, version, created_at, pre_qa_report, auto_review, game_id, games(title, released_at, studios(name))')
        .eq('qa_status', 'in_review')
        .order('created_at', { ascending: true }),
    );
    return (data ?? []).map((x): QaQueueItem => {
      const r = x as Row;
      const g = (r.games as { title?: string; released_at?: string | null; studios?: { name?: string } } | null) ?? {};
      return {
        versionId: String(r.id),
        gameId: String(r.game_id),
        title: String(g.title ?? ''),
        studioName: String(g.studios?.name ?? ''),
        version: String(r.version),
        submittedAt: String(r.created_at),
        preQaStatus: ((r.pre_qa_report as { status?: 'pass' | 'warn' | 'fail' } | null)?.status ?? null),
        autoReviewStatus: ((r.auto_review as { status?: 'pass' | 'warn' | 'fail' } | null)?.status ?? null),
        isUpdate: Boolean(g.released_at),
      };
    });
  },
  async qaItem(versionId) {
    const db = getSupabase();
    const version = check(await db.from('game_versions').select('*').eq('id', versionId).maybeSingle<Row>());
    if (!version) return null;
    const d = await detail(String(version.game_id));
    if (!d) return null;
    const studio = check(await db.from('studios').select('*').eq('id', d.game.studioId).single<Row>());
    if (!studio) return null;
    return {
      game: d.game,
      studio: toStudio(studio),
      version: toVersion(version, d.game.currentVersionId),
      media: d.media,
      previous: d.reviews,
    };
  },
  async qaDecide({ versionId, action, notes, checklist, schoolSafe }) {
    check(
      await getSupabase().rpc('qa_decide', {
        p_version_id: versionId,
        p_action: action,
        p_notes: notes,
        p_checklist: checklist,
        p_school_safe: schoolSafe,
      }),
    );
    emitTopic('qa');
  },
  async sparkGames() {
    const db = getSupabase();
    const games = check(await db.from('games').select('*, game_stats(plays_total, rating10), studios(name), game_versions!games_current_version_fk(uses_sdk)').eq('status', 'spark'));
    const today = new Date().toISOString().slice(0, 10);
    return Promise.all(
      (games ?? []).map(async (x): Promise<SparkRow> => {
        const r = x as Row;
        const game = toGame(r);
        const from = (game.sparkStartedAt ?? game.createdAt).slice(0, 10);
        const kpis = toKpis(check(await db.rpc('game_kpis', { p_game_id: game.id, p_from: from, p_to: today })));
        return {
          game,
          studioName: String((r.studios as { name?: string } | null)?.name ?? ''),
          usesSdk: Boolean((r.game_versions as { uses_sdk?: boolean } | null)?.uses_sdk),
          kpis,
          windowOver: isSparkWindowOver(game.sparkStartedAt ?? game.createdAt, summarise(kpis.days).plays),
        };
      }),
    );
  },
  async sparkDecide(gameId, promote, reason, kpis) {
    check(await getSupabase().rpc('spark_decide', { p_game_id: gameId, p_promote: promote, p_reason: reason, p_kpis: kpis }));
    emitTopic('qa');
  },
  async setGameStatus(gameId, status, reason) {
    check(await getSupabase().rpc('set_game_status', { p_game_id: gameId, p_status: status, p_reason: reason }));
    emitTopic('catalogue');
  },
  async saveSiteConfig(config) {
    check(await getSupabase().rpc('admin_set_site_config', { p_key: 'home', p_value: config }));
    emitTopic('catalogue');
  },
  async audit(limit = 200) {
    const data = check(await getSupabase().from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit));
    return (data ?? []).map((x) => {
      const r = x as Row;
      return {
        id: String(r.id),
        actor: String(r.actor_id ?? 'system'),
        action: String(r.action),
        targetType: String(r.target_type),
        targetId: String(r.target_id),
        detail: (r.detail as Record<string, unknown>) ?? {},
        createdAt: String(r.created_at),
      };
    });
  },
  async runDailyJobs() {
    check(await getSupabase().rpc('run_daily_jobs'));
    emitTopic('catalogue');
  },
};
