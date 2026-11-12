import { EVENTS_TRANSPORT, SUPABASE_ANON_KEY } from '@/lib/config';
import { emitTopic } from '../bus';
import { getAnonId, guestFavourites, guestHistory, guestRatings } from '../local';
import {
  RepoError,
  type CatalogueRepo,
  type EventContext,
  type EventsRepo,
  type PlayerRepo,
  type Repo,
} from '../repo';
import {
  DEFAULT_SITE_CONFIG,
  PUBLIC_STATUSES,
  type EventInput,
  type GameDetail,
  type GameQuery,
  type GameStats,
  type GameSummary,
  type MediaAsset,
  type MediaKind,
  type SiteConfig,
  type StudioDetail,
} from '../types';
import { functionsUrl, getSupabase } from './client';
import { toRepoError } from './errors';
import { supabaseAuth, supabaseQuests, supabaseSaves, supabaseScores } from './account';
import { supabaseAdmin, supabaseDev } from './dev';

/** Row of the `game_cards` view (see supabase/migrations/0001_core.sql). */
export interface GameCardRow {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  category: string;
  tags: string[];
  orientation: GameSummary['orientation'];
  platforms: GameSummary['platforms'];
  is_multiplayer: boolean;
  size_bytes: number;
  initial_load_bytes: number | null;
  status: GameSummary['status'];
  school_safe: boolean;
  released_at: string | null;
  updated_at: string;
  spark_started_at: string | null;
  studio_id: string;
  studio_slug: string;
  studio_name: string;
  studio_country: string | null;
  studio_first_party: boolean;
  studio_verified: boolean;
  media: MediaAsset[] | null;
  plays: number;
  plays_7d: number;
  rating10: number | null;
  votes: number;
  likes: number;
  dislikes: number;
  version_id: string | null;
  version: string | null;
  storage_prefix: string | null;
  entry_file: string | null;
  uses_sdk: boolean | null;
}

interface GamePageRow extends GameCardRow {
  description_md: string;
  how_to_play_md: string;
  controls: GameDetail['controls'] | null;
  faq: GameDetail['faq'] | null;
  features_md: string;
  tips_md: string;
  engine: string | null;
  has_progress: boolean;
  exclusive_until: string | null;
  created_at: string;
}

const CARD_COLUMNS =
  'id,slug,title,short_description,category,tags,orientation,platforms,is_multiplayer,size_bytes,' +
  'initial_load_bytes,status,school_safe,released_at,updated_at,spark_started_at,studio_id,studio_slug,' +
  'studio_name,studio_country,studio_first_party,studio_verified,media,plays,plays_7d,rating10,votes,' +
  'likes,dislikes,version_id,version,storage_prefix,entry_file,uses_sdk';

export function cardToSummary(row: GameCardRow): GameSummary {
  const media = row.media ?? [];
  const first = (kind: MediaKind) =>
    media.find((m) => m.kind === kind && (m.variantLabel == null || m.variantLabel === 'A')) ??
    media.find((m) => m.kind === kind) ??
    null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.short_description,
    category: row.category,
    tags: row.tags ?? [],
    orientation: row.orientation,
    platforms: row.platforms ?? [],
    isMultiplayer: row.is_multiplayer,
    sizeBytes: Number(row.size_bytes),
    initialLoadBytes: row.initial_load_bytes == null ? null : Number(row.initial_load_bytes),
    status: row.status,
    schoolSafe: row.school_safe,
    releasedAt: row.released_at,
    updatedAt: row.updated_at,
    sparkStartedAt: row.spark_started_at,
    studio: {
      id: row.studio_id,
      slug: row.studio_slug,
      name: row.studio_name,
      country: row.studio_country,
      isFirstParty: row.studio_first_party,
      verified: row.studio_verified,
    },
    cover: first('cover_landscape'),
    coverPortrait: first('cover_portrait'),
    coverSquare: first('cover_square'),
    preview: first('preview_landscape'),
    previewPortrait: first('preview_portrait'),
    coverVariants: media.filter((m) => m.kind === 'cover_landscape' && m.variantLabel != null),
    stats: {
      plays: Number(row.plays ?? 0),
      plays7d: Number(row.plays_7d ?? 0),
      rating10: row.rating10 == null ? null : Number(row.rating10),
      votes: Number(row.votes ?? 0),
      likes: Number(row.likes ?? 0),
      dislikes: Number(row.dislikes ?? 0),
    },
    versionId: row.version_id,
    version: row.version,
    playPath: row.storage_prefix ? `${row.storage_prefix}/${row.entry_file ?? 'index.html'}` : null,
    usesSdk: row.uses_sdk ?? false,
  };
}

export function pageToDetail(row: GamePageRow): GameDetail {
  return {
    ...cardToSummary(row),
    descriptionMd: row.description_md ?? '',
    howToPlayMd: row.how_to_play_md ?? '',
    controls: row.controls ?? [],
    faq: row.faq ?? [],
    featuresMd: row.features_md ?? '',
    tipsMd: row.tips_md ?? '',
    engine: row.engine,
    hasProgress: row.has_progress,
    exclusiveUntil: row.exclusive_until,
    createdAt: row.created_at,
    devlogs: [],
  };
}

export { toRepoError } from './errors';

const SORT_COLUMN = {
  popular: 'popular_score',
  trending: 'trending_score',
  new: 'released_at',
  updated: 'updated_at',
  rating: 'rating10',
} as const;

const catalogue: CatalogueRepo = {
  async list(query: GameQuery = {}) {
    const db = getSupabase();
    let q = db.from('game_cards').select(CARD_COLUMNS, { count: 'estimated' });
    if (query.changedSince) {
      // Everything that changed, including games that stopped being public.
      q = q.gt('updated_at', query.changedSince).limit(200);
    } else {
      q = q.in('status', query.status ?? [...PUBLIC_STATUSES]);
      if (query.category === '2-player') q = q.contains('tags', ['2-player']);
      else if (query.category === 'made-in-india') q = q.or('studio_country.eq.IN,tags.cs.{made-in-india}');
      else if (query.category) q = q.eq('category', query.category);
      if (query.tag) q = q.contains('tags', [query.tag]);
      if (query.studioSlug) q = q.eq('studio_slug', query.studioSlug);
      if (query.multiplayer) q = q.eq('is_multiplayer', true);
      if (query.mobile) q = q.contains('platforms', ['mobile']);
      if (query.maxSize != null) q = q.lte('size_bytes', query.maxSize);
      if (query.newWithinDays != null) {
        q = q.gte('released_at', new Date(Date.now() - query.newWithinDays * 86_400_000).toISOString());
      }
      if (query.originals) q = q.eq('studio_first_party', true);
      if (query.schoolSafeOnly) q = q.eq('school_safe', true);
      q = q
        .order(SORT_COLUMN[query.sort ?? 'popular'], { ascending: false, nullsFirst: false })
        .order('id', { ascending: true });
      const offset = query.offset ?? 0;
      q = q.range(offset, offset + (query.limit ?? 48) - 1);
    }
    const { data, error, count } = await q;
    if (error) throw toRepoError(error);
    return { items: ((data ?? []) as unknown as GameCardRow[]).map(cardToSummary), total: count ?? null };
  },
  async get(slug) {
    const { data, error } = await getSupabase()
      .from('game_cards')
      .select('*')
      .eq('slug', slug)
      .in('status', [...PUBLIC_STATUSES])
      .maybeSingle();
    if (error) throw toRepoError(error);
    return data ? pageToDetail(data as unknown as GamePageRow) : null;
  },
  async byIds(ids) {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabase()
      .from('game_cards')
      .select(CARD_COLUMNS)
      .in('id', ids.slice(0, 100))
      .in('status', [...PUBLIC_STATUSES]);
    if (error) throw toRepoError(error);
    const byId = new Map(((data ?? []) as unknown as GameCardRow[]).map((r) => [r.id, cardToSummary(r)]));
    return ids.map((id) => byId.get(id)).filter((g): g is GameSummary => g != null);
  },
  async studio(slug) {
    const { data, error } = await getSupabase()
      .from('studio_pages')
      .select('id,slug,name,country,is_first_party,verified,bio,avatar_url,links,level,followers,created_at')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw toRepoError(error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      country: (row.country as string | null) ?? null,
      isFirstParty: Boolean(row.is_first_party),
      verified: Boolean(row.verified),
      bio: String(row.bio ?? ''),
      avatarUrl: (row.avatar_url as string | null) ?? null,
      links: (row.links as StudioDetail['links'] | null) ?? [],
      level: (row.level as StudioDetail['level']) ?? 'rookie',
      followers: Number(row.followers ?? 0),
      createdAt: String(row.created_at),
    };
  },
  async search(text, limit = 24) {
    const { data, error } = await getSupabase().rpc('search_games', { p_query: text, p_limit: limit });
    if (error) throw toRepoError(error);
    return ((data ?? []) as GameCardRow[]).map(cardToSummary);
  },
  async siteConfig() {
    const { data, error } = await getSupabase().from('site_config').select('key,value').eq('key', 'home');
    if (error) throw toRepoError(error);
    const value = (data?.[0]?.value ?? {}) as Partial<SiteConfig>;
    return { ...DEFAULT_SITE_CONFIG, ...value };
  },
};

const player: PlayerRepo = {
  async myRating(gameId) {
    return guestRatings.get(gameId);
  },
  async rate(gameId, value, reason = null) {
    const { data, error } = await getSupabase().rpc('rate_game', {
      p_game_id: gameId,
      p_value: value,
      p_reason: value === -1 ? reason : null,
      p_anon_id: getAnonId(),
    });
    if (error) throw toRepoError(error);
    guestRatings.set(gameId, value === 0 ? null : { value, reason: value === -1 ? reason : null });
    emitTopic('ratings');
    const s = (data ?? {}) as Record<string, number | null>;
    const stats: GameStats = {
      plays: Number(s.plays ?? 0),
      plays7d: Number(s.plays_7d ?? 0),
      rating10: s.rating10 == null ? null : Number(s.rating10),
      votes: Number(s.votes ?? 0),
      likes: Number(s.likes ?? 0),
      dislikes: Number(s.dislikes ?? 0),
    };
    return stats;
  },
  async favourites() {
    return guestFavourites.list();
  },
  async setFavourite(gameId, on) {
    guestFavourites.set(gameId, on);
    emitTopic('favourites');
  },
  async history() {
    return guestHistory.list();
  },
  async recordPlay(game, seconds, newSession) {
    guestHistory.record(game, seconds, newSession);
    emitTopic('history');
  },
  async clearHistory() {
    guestHistory.clear();
    emitTopic('history');
  },
  async sendFeedback(input) {
    const { error } = await getSupabase().rpc('send_feedback', {
      p_game_id: input.gameId,
      p_version_id: input.versionId,
      p_category: input.category,
      p_message: input.message,
      p_context: input.context,
      p_device: input.device,
      p_anon_id: getAnonId(),
    });
    if (error) throw toRepoError(error);
  },
};

function eventsBody(batch: EventInput[], context: EventContext) {
  return {
    anon_id: context.anonId,
    device: context.device,
    ref_studio: context.refStudio,
    events: batch.map((e) => ({
      type: e.type,
      ts: e.ts,
      session_id: e.sessionId,
      game_id: e.gameId,
      version_id: e.versionId,
      payload: e.payload,
    })),
  };
}

const events: EventsRepo = {
  async ingest(batch, context) {
    if (batch.length === 0) return;
    const body = eventsBody(batch, context);
    if (EVENTS_TRANSPORT === 'rpc') {
      const { error } = await getSupabase().rpc('ingest_events', {
        p_anon_id: body.anon_id,
        p_device: body.device,
        p_ref_studio: body.ref_studio,
        p_events: body.events,
      });
      if (error) throw toRepoError(error);
      return;
    }
    const { data } = await getSupabase().auth.getSession();
    const res = await fetch(functionsUrl('events'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${data.session?.access_token ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) throw new RepoError('rate_limited');
    if (!res.ok) throw new RepoError('unavailable', `events ${res.status}`);
  },
  ingestOnUnload(batch, context) {
    if (batch.length === 0) return;
    // keepalive lets the request outlive the page; sendBeacon cannot set the apikey header.
    void fetch(functionsUrl('events'), {
      method: 'POST',
      keepalive: true,
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(eventsBody(batch, context)),
    }).catch(() => {});
  },
};

export function createSupabaseRepo(): Repo {
  // Session changes (login in another tab, token refresh, sign-out) refresh open screens.
  getSupabase().auth.onAuthStateChange(() => emitTopic('session', { local: true }));
  return {
    mode: 'supabase',
    catalogue,
    player,
    events,
    auth: supabaseAuth,
    saves: supabaseSaves,
    scores: supabaseScores,
    quests: supabaseQuests,
    dev: supabaseDev,
    admin: supabaseAdmin,
  };
}
