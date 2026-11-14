import { emitTopic } from '../bus';
import { rankScore, type RankInputs } from '@/lib/domain/ranking';
import type { DevlogPost, DiscoveryReport, DiscoveryRow, Jam, ReportKind, ReportRecord, SiteStats } from '../growthTypes';
import { getAnonId } from '../local';
import { RepoError, type GrowthRepo } from '../repo';
import type { GameSummary } from '../types';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Row = Record<string, unknown>;
const check = <T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T => {
  if (error) throw toRepoError(error);
  return data;
};

async function userId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}

async function requireUserId(): Promise<string> {
  const id = await userId();
  if (!id) throw new RepoError('login_required');
  return id;
}

const toJam = (r: Row): Jam => ({
  id: String(r.id),
  slug: String(r.slug),
  title: String(r.title),
  theme: String(r.theme ?? ''),
  descriptionMd: String(r.description_md ?? ''),
  startsAt: String(r.starts_at),
  endsAt: String(r.ends_at),
  status: r.status as Jam['status'],
  entries: Number((r.jam_entries as { count?: number }[] | null)?.[0]?.count ?? 0),
});

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Builds a discovery report from a game_stats row and the game's daily impression rows. */
function toReport(gameId: string, stats: Row | null, releasedAt: string, days: Row[]): DiscoveryReport {
  const num = (v: unknown) => (v == null ? null : Number(v));
  const inputs: RankInputs = {
    impressions: Number(stats?.impressions_14d ?? 0),
    clicks: Number(stats?.clicks_14d ?? 0),
    plays: Number(stats?.plays_14d ?? 0),
    conversion: num(stats?.conversion_14d),
    avgSessionSec: num(stats?.avg_session_sec_14d),
    d1: num(stats?.d1_14d),
    likes: Number(stats?.likes_180d ?? 0),
    dislikes: Number(stats?.dislikes_180d ?? 0),
    ageDays: releasedAt ? Math.max(0, (Date.now() - new Date(releasedAt).getTime()) / 86_400_000) : 0,
  };
  const byDay = new Map(days.map((d) => [String(d.day), d]));
  return {
    gameId,
    inputs,
    // The stored score is from the last daily job; the formula is identical.
    score: stats?.rank_score != null ? Number(stats.rank_score) : rankScore(inputs),
    byDay: Array.from({ length: 30 }, (_, i) => {
      const day = isoDay(i - 29);
      const row = byDay.get(day);
      return { day, impressions: Number(row?.impressions ?? 0), clicks: Number(row?.clicks ?? 0) };
    }),
  };
}

/** Names for a set of ids from a public view, as a map. */
async function names(view: string, column: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = (check(await getSupabase().from(view).select('*').in(column, unique.slice(0, 200))) ?? []) as Row[];
  return new Map(rows.map((r) => [String(r[column]), r]));
}

/** Growth features against Supabase. Row-level security and the SQL functions enforce who may do what. */
export function supabaseGrowth(gamesByIds: (ids: string[]) => Promise<GameSummary[]>): GrowthRepo {
  return {
    async following(studioId) {
      const me = await userId();
      if (!me) return false;
      const row = check(await getSupabase().from('studio_followers').select('studio_id').eq('studio_id', studioId).eq('user_id', me).maybeSingle());
      return Boolean(row);
    },
    async setFollowing(studioId, on) {
      const me = await requireUserId();
      const db = getSupabase();
      check(
        on
          ? await db.from('studio_followers').upsert({ studio_id: studioId, user_id: me }, { onConflict: 'studio_id,user_id', ignoreDuplicates: true })
          : await db.from('studio_followers').delete().eq('studio_id', studioId).eq('user_id', me),
      );
      emitTopic('studio');
    },
    async devlogFeed({ studioSlug, gameId, limit = 30 } = {}) {
      const db = getSupabase();
      let q = db.from('devlogs').select('id, studio_id, game_id, title, body_md, published_at').is('hidden_at', null);
      if (studioSlug) {
        const studio = check(await db.from('studio_pages').select('id').eq('slug', studioSlug).maybeSingle<Row>());
        if (!studio) return [];
        q = q.eq('studio_id', String(studio.id));
      }
      if (gameId) q = q.eq('game_id', gameId);
      const rows = (check(await q.order('published_at', { ascending: false }).limit(limit)) ?? []) as Row[];
      const [studios, games] = await Promise.all([
        names('studio_pages', 'id', rows.map((r) => String(r.studio_id))),
        gamesByIds(rows.map((r) => String(r.game_id ?? '')).filter(Boolean)),
      ]);
      const gameById = new Map(games.map((g) => [g.id, g]));
      return rows
        .filter((r) => studios.has(String(r.studio_id)))
        .map((r): DevlogPost => {
          const s = studios.get(String(r.studio_id))!;
          const g = r.game_id ? gameById.get(String(r.game_id)) : undefined;
          return {
            id: String(r.id),
            studioSlug: String(s.slug),
            studioName: String(s.name),
            gameSlug: g?.slug ?? null,
            gameTitle: g?.title ?? null,
            title: String(r.title),
            bodyMd: String(r.body_md ?? ''),
            publishedAt: String(r.published_at),
          };
        });
    },
    async recordVariantHits(hits) {
      if (hits.length === 0) return;
      // Best effort: a lost batch only delays a test.
      await getSupabase().rpc('record_tile_hits', { p_anon_id: getAnonId(), p_rows: hits.slice(0, 100) });
    },
    async discovery(gameId) {
      const db = getSupabase();
      const [stats, game, days] = await Promise.all([
        db.from('game_stats').select('*').eq('game_id', gameId).maybeSingle<Row>(),
        db.from('games').select('released_at').eq('id', gameId).maybeSingle<Row>(),
        db.from('game_impressions').select('day, impressions, clicks').eq('game_id', gameId).gte('day', isoDay(-29)).order('day'),
      ]);
      const g = check(game);
      if (!g) return null;
      return toReport(gameId, check(stats), String(g.released_at ?? ''), (check(days) ?? []) as Row[]);
    },
    async discoveryAll() {
      const db = getSupabase();
      const games = (check(await db.from('games').select('id, slug, title, status, released_at, studios(name), game_stats(*)').not('released_at', 'is', null).limit(500)) ?? []) as Row[];
      const days = (check(await db.from('game_impressions').select('game_id, day, impressions, clicks').gte('day', isoDay(-29))) ?? []) as Row[];
      return games
        .map((r): DiscoveryRow => {
          const stats = (Array.isArray(r.game_stats) ? r.game_stats[0] : r.game_stats) as Row | null;
          return {
            ...toReport(String(r.id), stats ?? null, String(r.released_at ?? ''), days.filter((d) => d.game_id === r.id)),
            slug: String(r.slug),
            title: String(r.title),
            studioName: String((r.studios as { name?: string } | null)?.name ?? ''),
            status: r.status as DiscoveryRow['status'],
          };
        })
        .sort((a, b) => b.score - a.score);
    },
    async siteStats() {
      const r = (check(await getSupabase().rpc('admin_site_stats')) ?? {}) as Row;
      const n = (v: unknown) => Number(v ?? 0);
      return {
        players7d: n(r.players_7d),
        plays7d: n(r.plays_7d),
        playsToday: n(r.plays_today),
        impressions7d: n(r.impressions_7d),
        accounts: n(r.accounts),
        studios: n(r.studios),
        gamesByStatus: (r.games_by_status as SiteStats['gamesByStatus']) ?? {},
        inReview: n(r.in_review),
        openReports: n(r.open_reports),
        byDay: ((r.by_day as Row[]) ?? []).map((d) => ({ day: String(d.day), plays: n(d.plays), players: n(d.players), impressions: n(d.impressions) })),
      };
    },
    async databaseStats() {
      const r = (check(await getSupabase().rpc('admin_db_stats')) ?? {}) as Row;
      return {
        engine: String(r.version ?? 'PostgreSQL'),
        totalBytes: Number(r.total_bytes ?? 0),
        // The free Supabase plan stores 500 MB.
        limitBytes: 500 * 1024 * 1024,
        connections: r.connections == null ? null : Number(r.connections),
        tables: ((r.tables as Row[]) ?? []).map((t) => ({ name: String(t.name), rows: Number(t.rows ?? 0), bytes: Number(t.bytes ?? 0) })),
      };
    },
    async variantStats(gameId) {
      const rows = (check(await getSupabase().from('media_variant_stats').select('*').eq('game_id', gameId).order('variant_label')) ?? []) as Row[];
      return rows.map((r) => ({
        label: String(r.variant_label),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        winner: Boolean(r.winner),
        decided: Boolean(r.decided_at),
      }));
    },
    async playtestAnswered(gameId) {
      const me = await userId();
      if (!me) return false;
      const row = check(await getSupabase().from('playtest_responses').select('id').eq('game_id', gameId).eq('user_id', me).maybeSingle());
      return Boolean(row);
    },
    async submitPlaytest(gameId, answers) {
      check(await getSupabase().rpc('submit_playtest', { p_game_id: gameId, p_fun: answers.fun, p_clarity: answers.clarity, p_play_again: answers.playAgain }));
      emitTopic('session', { local: true });
    },
    async playtestSummary(gameId) {
      const r = (check(await getSupabase().rpc('playtest_summary', { p_game_id: gameId })) ?? {}) as Row;
      const num = (v: unknown) => (v == null ? null : Number(v));
      return { responses: Number(r.responses ?? 0), fun: num(r.fun), clarity: num(r.clarity), playAgain: num(r.play_again) };
    },
    async jams() {
      const rows = (check(await getSupabase().from('jams').select('*, jam_entries(count)').neq('status', 'draft').order('starts_at', { ascending: false })) ?? []) as Row[];
      return rows.map(toJam);
    },
    async jam(slug) {
      const db = getSupabase();
      const row = check(await db.from('jams').select('*, jam_entries(count)').eq('slug', slug).neq('status', 'draft').maybeSingle<Row>());
      if (!row) return null;
      const entries = (check(await db.from('jam_entries').select('game_id, studio_id, rank, submitted_at').eq('jam_id', String(row.id))) ?? []) as Row[];
      const [games, studios] = await Promise.all([
        gamesByIds(entries.map((e) => String(e.game_id))),
        names('studio_pages', 'id', entries.map((e) => String(e.studio_id))),
      ]);
      const gameById = new Map(games.map((g) => [g.id, g]));
      return {
        ...toJam(row),
        entryList: entries
          .map((e) => ({
            gameId: String(e.game_id),
            studioName: String(studios.get(String(e.studio_id))?.name ?? ''),
            rank: e.rank == null ? null : Number(e.rank),
            submittedAt: String(e.submitted_at),
            game: gameById.get(String(e.game_id)) ?? null,
          }))
          .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.submittedAt.localeCompare(b.submittedAt)),
      };
    },
    async enterJam(jamId, gameId) {
      const db = getSupabase();
      const game = check(await db.from('games').select('studio_id').eq('id', gameId).maybeSingle<Row>());
      if (!game) throw new RepoError('not_found');
      check(await db.from('jam_entries').upsert({ jam_id: jamId, game_id: gameId, studio_id: String(game.studio_id) }, { onConflict: 'jam_id,game_id', ignoreDuplicates: true }));
      emitTopic('jams');
    },
    async leaveJam(jamId, gameId) {
      check(await getSupabase().from('jam_entries').delete().eq('jam_id', jamId).eq('game_id', gameId));
      emitTopic('jams');
    },
    async report({ kind, targetType, targetId, reason }) {
      check(
        await getSupabase().rpc('report_content', {
          p_kind: kind,
          p_target_type: targetType,
          p_target_id: targetId,
          p_reason: reason.trim().slice(0, 1000),
          p_anon_id: getAnonId(),
        }),
      );
    },

    async adminJams() {
      const rows = (check(await getSupabase().from('jams').select('*, jam_entries(count)').order('starts_at', { ascending: false })) ?? []) as Row[];
      return rows.map(toJam);
    },
    async saveJam(input) {
      const row = {
        slug: input.slug.trim().toLowerCase(),
        title: input.title.trim(),
        theme: input.theme.trim(),
        description_md: input.descriptionMd,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        status: input.status,
      };
      const db = getSupabase();
      check(input.id ? await db.from('jams').update(row).eq('id', input.id) : await db.from('jams').insert(row));
      emitTopic('jams');
    },
    async deleteJam(id) {
      check(await getSupabase().from('jams').delete().eq('id', id));
      emitTopic('jams');
    },
    async rankJamEntry(jamId, gameId, rank) {
      check(await getSupabase().from('jam_entries').update({ rank }).eq('jam_id', jamId).eq('game_id', gameId));
      emitTopic('jams');
    },
    async reports() {
      const db = getSupabase();
      const rows = (check(await db.from('reports').select('*').order('created_at', { ascending: false }).limit(200)) ?? []) as Row[];
      const idsOf = (type: string) => rows.filter((r) => r.target_type === type).map((r) => String(r.target_id));
      const [users, studios, games, devlogs] = await Promise.all([
        names('profiles', 'id', idsOf('user')),
        names('studios', 'id', idsOf('studio')),
        names('games', 'id', idsOf('game')),
        names('devlogs', 'id', idsOf('devlog')),
      ]);
      const label = (type: string, id: string) =>
        String(
          (type === 'user' ? users.get(id)?.username : type === 'studio' ? studios.get(id)?.name : type === 'game' ? games.get(id)?.title : type === 'devlog' ? devlogs.get(id)?.title : null) ?? id,
        );
      return rows.map(
        (r): ReportRecord => ({
          id: String(r.id),
          kind: r.kind as ReportKind,
          targetType: String(r.target_type),
          targetId: String(r.target_id),
          targetLabel: label(String(r.target_type), String(r.target_id)),
          reason: String(r.reason ?? ''),
          status: r.status as ReportRecord['status'],
          createdAt: String(r.created_at),
        }),
      );
    },
    async resolveReport(id, status) {
      check(await getSupabase().rpc('admin_resolve_report', { p_report_id: Number(id), p_status: status }));
      emitTopic('admin');
    },
    async findUsers(query) {
      const q = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      let req = getSupabase().from('profiles').select('id, username, display_name, role, banned_at, is_minor, created_at');
      if (q) req = req.ilike('username', `%${q}%`);
      const rows = (check(await req.order('created_at', { ascending: false }).limit(20)) ?? []) as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        username: String(r.username),
        displayName: String(r.display_name ?? ''),
        role: r.role as 'player' | 'moderator' | 'admin',
        banned: Boolean(r.banned_at),
        isMinor: Boolean(r.is_minor),
        createdAt: String(r.created_at),
      }));
    },
    async setUser(userId_, patch) {
      check(await getSupabase().rpc('admin_set_user', { p_user: userId_, p_banned: patch.banned ?? null, p_role: patch.role ?? null, p_reset_username: patch.resetUsername ?? false }));
      emitTopic('admin');
    },
    async findStudios(query) {
      const q = query.trim().replace(/[%,()]/g, '');
      let req = getSupabase().from('studios').select('id, slug, name, verified, suspended_at');
      if (q) req = req.or(`slug.ilike.%${q}%,name.ilike.%${q}%`);
      const rows = (check(await req.order('created_at', { ascending: false }).limit(20)) ?? []) as Row[];
      return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name), verified: Boolean(r.verified), suspended: Boolean(r.suspended_at) }));
    },
    async setStudio(studioId, patch) {
      check(await getSupabase().rpc('admin_set_studio', { p_studio: studioId, p_suspended: patch.suspended ?? null, p_verified: patch.verified ?? null }));
      emitTopic('admin');
      emitTopic('studio');
    },
    async adminDevlogs() {
      const rows = (check(await getSupabase().from('devlogs').select('id, title, published_at, hidden_at, studios(name)').order('published_at', { ascending: false }).limit(100)) ?? []) as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        studioName: String((r.studios as { name?: string } | null)?.name ?? ''),
        publishedAt: String(r.published_at),
        hidden: Boolean(r.hidden_at),
      }));
    },
    async hideDevlog(id, hidden) {
      check(await getSupabase().from('devlogs').update({ hidden_at: hidden ? new Date().toISOString() : null }).eq('id', id));
      emitTopic('devlogs');
      emitTopic('admin');
    },
    async adminQuests() {
      const rows = (check(await getSupabase().from('quests').select('code, period, title, target, reward_points, active').order('sort')) ?? []) as Row[];
      return rows.map((r) => ({
        code: String(r.code),
        period: r.period as 'daily' | 'weekly',
        title: String((r.title as { en?: string } | null)?.en ?? r.code),
        target: Number(r.target),
        reward: Number(r.reward_points),
        active: Boolean(r.active),
      }));
    },
    async saveQuest(code, patch) {
      check(await getSupabase().from('quests').update({ target: Math.round(patch.target), reward_points: Math.round(patch.reward), active: patch.active }).eq('code', code));
      emitTopic('quests');
    },
    async adminCosmetics() {
      const rows = (check(await getSupabase().from('cosmetics').select('id, slot, code, name, cost_points, min_level, active').order('sort')) ?? []) as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        slot: String(r.slot),
        code: String(r.code),
        name: String((r.name as { en?: string } | null)?.en ?? r.code),
        cost: Number(r.cost_points),
        minLevel: Number(r.min_level),
        active: Boolean(r.active),
      }));
    },
    async saveCosmetic(id, patch) {
      check(await getSupabase().from('cosmetics').update({ cost_points: Math.round(patch.cost), min_level: Math.round(patch.minLevel), active: patch.active }).eq('id', id));
      emitTopic('profile');
    },
  };
}
