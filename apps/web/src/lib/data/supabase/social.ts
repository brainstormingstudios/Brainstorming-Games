import type { RealtimeChannel } from '@supabase/supabase-js';
import { badgesFor, levelFor } from '@/lib/domain/progression';
import { emitTopic } from '../bus';
import { getAnonId } from '../local';
import type { GameSummary } from '../types';
import {
  type Activity,
  type LeaderboardsRepo,
  type LockerRepo,
  type NotificationsRepo,
  type PartyRepo,
  type PartyView,
  type PresenceInfo,
  type ProfilesRepo,
  type QuestsRepo,
  type SocialRepo,
} from '../repo';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Row = Record<string, unknown>;
const check = <T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T => {
  if (error) throw toRepoError(error);
  return data;
};

async function uid(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}

export const supabaseQuestsExtra: Omit<QuestsRepo, 'track'> = {
  async mine(locale) {
    const db = getSupabase();
    const quests = (check(await db.rpc('my_quests')) ?? []) as Row[];
    const me = await uid();
    const profile = me ? check(await db.from('profiles').select('brain_points, level, streak_days, streak_last_day').eq('id', me).maybeSingle<Row>()) : null;
    const lifetime = me
      ? ((check(await db.from('brain_point_ledger').select('delta').gt('delta', 0)) ?? []) as Row[]).reduce((n, r) => n + Number(r.delta), 0)
      : 0;
    const pick = (v: unknown) => {
      const m = (v ?? {}) as Record<string, string>;
      return m[locale] ?? m.en ?? '';
    };
    return {
      quests: quests.map((q) => {
        const rule = (q.rule ?? {}) as { kind?: string; category?: string };
        return {
          code: String(q.code),
          period: q.period as 'daily' | 'weekly',
          title: pick(q.title),
          description: pick(q.description),
          target: Number(q.target),
          reward: Number(q.reward_points),
          progress: Number(q.progress ?? 0),
          completed: Boolean(q.completed_at),
          category: rule.kind === 'play_distinct' ? (rule.category ?? null) : null,
        };
      }),
      brainPoints: Number(profile?.brain_points ?? 0),
      level: Number(profile?.level ?? levelFor(lifetime)),
      lifetimePoints: lifetime,
      streakDays: Number(profile?.streak_days ?? 0),
      playedToday: profile?.streak_last_day === new Date().toISOString().slice(0, 10),
    };
  },
  async ledger() {
    // Only a signed-in player has a points history; asking without one is refused.
    if (!(await uid())) return [];
    const rows = (check(await getSupabase().from('brain_point_ledger').select('delta, reason, created_at').order('created_at', { ascending: false }).limit(100)) ?? []) as Row[];
    return rows.map((r) => ({ delta: Number(r.delta), reason: String(r.reason), createdAt: String(r.created_at) }));
  },
};

export const supabaseLocker: LockerRepo = {
  async items(locale) {
    const db = getSupabase();
    const cosmetics = (check(await db.from('cosmetics').select('id, slot, code, name, cost_points, min_level').eq('active', true).order('sort')) ?? []) as Row[];
    const me = await uid();
    const owned = me ? new Set(((check(await db.from('user_cosmetics').select('cosmetic_id')) ?? []) as Row[]).map((r) => String(r.cosmetic_id))) : new Set<string>();
    const profile = me ? check(await db.from('profiles').select('avatar_cosmetics').eq('id', me).maybeSingle<Row>()) : null;
    const equipped = (profile?.avatar_cosmetics ?? {}) as Record<string, string>;
    return cosmetics.map((c) => {
      const name = (c.name ?? {}) as Record<string, string>;
      return {
        id: String(c.id),
        slot: c.slot as 'hat',
        code: String(c.code),
        name: name[locale] ?? name.en ?? String(c.code),
        cost: Number(c.cost_points),
        minLevel: Number(c.min_level),
        owned: owned.has(String(c.id)),
        equipped: equipped[String(c.slot)] === c.code,
      };
    });
  },
  async unlock(itemId) {
    check(await getSupabase().rpc('unlock_cosmetic', { p_cosmetic_id: itemId }));
    emitTopic('points');
  },
  async equip(cosmetics) {
    check(await getSupabase().rpc('equip_cosmetics', { p_equipped: cosmetics }));
    emitTopic('session', { local: true });
  },
};

let presenceChannel: RealtimeChannel | null = null;
let myActivity: Activity | null = null;

export const supabaseSocial: SocialRepo = {
  async friends() {
    const rows = (check(await getSupabase().rpc('my_friends')) ?? []) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      username: String(r.username),
      displayName: String(r.display_name ?? ''),
      avatar: (r.avatar_cosmetics as Record<string, string>) ?? {},
      level: Number(r.level ?? 1),
      status: r.status as 'pending' | 'accepted',
      direction: r.direction as 'incoming' | 'outgoing',
    }));
  },
  async request(username) {
    const status = check(await getSupabase().rpc('friend_request', { p_username: username.replace(/^@/, '') })) as 'pending' | 'accepted';
    emitTopic('friends');
    return status;
  },
  async respond(userId, accept) {
    check(await getSupabase().rpc('friend_respond', { p_requester: userId, p_accept: accept }));
    emitTopic('friends');
  },
  async remove(userId) {
    check(await getSupabase().rpc('friend_remove', { p_other: userId }));
    emitTopic('friends');
  },
  watchPresence(cb) {
    // One shared Realtime presence channel; each client keeps only its friends' entries.
    let friendIds = new Set<string>();
    const db = getSupabase();
    const publish = () => {
      if (!presenceChannel) return;
      const state = presenceChannel.presenceState<{ userId: string; activity: Activity | null }>();
      const out: Record<string, PresenceInfo> = {};
      for (const id of friendIds) out[id] = { online: false, activity: null };
      for (const metas of Object.values(state)) {
        for (const m of metas) if (friendIds.has(m.userId)) out[m.userId] = { online: true, activity: m.activity };
      }
      cb(out);
    };
    void supabaseSocial.friends().then((f) => {
      friendIds = new Set(f.filter((x) => x.status === 'accepted').map((x) => x.id));
      publish();
    });
    void uid().then((me) => {
      if (!me || presenceChannel) return publish();
      presenceChannel = db.channel('presence:online', { config: { presence: { key: me } } });
      presenceChannel
        .on('presence', { event: 'sync' }, publish)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void presenceChannel?.track({ userId: me, activity: myActivity });
        });
    });
    return () => {
      // The channel stays open for the rest of the visit; one connection per tab.
    };
  },
  setActivity(activity) {
    myActivity = activity;
    void uid().then((me) => (me ? presenceChannel?.track({ userId: me, activity }) : undefined));
  },
};

function toParty(r: Row, me: string): PartyView {
  return {
    code: String(r.code),
    hostKey: String(r.host_key),
    meKey: me,
    members: (r.members as PartyView['members']).map((m) => ({ ...m, canChat: Boolean((m as unknown as { can_chat?: boolean }).can_chat ?? m.canChat) })),
    votes: (r.votes as Record<string, string>) ?? {},
    chat: (r.chat as PartyView['chat']) ?? [],
    state: r.state as 'lobby' | 'playing',
    currentGameId: (r.current_game_id as string | null) ?? null,
    expiresAt: String(r.expires_at),
  };
}

async function meKey(): Promise<string> {
  return (await uid()) ?? `anon:${getAnonId()}`;
}

const partyChannels = new Map<string, RealtimeChannel>();
function pingParty(code: string) {
  void partyChannels.get(code)?.send({ type: 'broadcast', event: 'changed', payload: {} });
}

export const supabaseParty: PartyRepo = {
  async create(gameId) {
    const data = check(await getSupabase().rpc('party_create', { p_anon_id: getAnonId(), p_alias: 'Guest', p_game_id: gameId ?? null })) as Row;
    return toParty(data, await meKey());
  },
  async get(code) {
    const data = check(await getSupabase().rpc('party_get', { p_code: code })) as Row | null;
    return data ? toParty(data, await meKey()) : null;
  },
  async join(code) {
    const data = check(await getSupabase().rpc('party_join', { p_code: code, p_anon_id: getAnonId(), p_alias: 'Guest' })) as Row;
    pingParty(code);
    return toParty(data, await meKey());
  },
  async leave(code) {
    check(await getSupabase().rpc('party_leave', { p_code: code, p_anon_id: getAnonId() }));
    pingParty(code);
  },
  async act(code, action, options = {}) {
    const data = check(
      await getSupabase().rpc('party_act', {
        p_code: code,
        p_anon_id: getAnonId(),
        p_action: action,
        p_game_id: options.gameId ?? null,
        p_phrase: options.phrase ?? null,
      }),
    ) as Row;
    pingParty(code);
    return toParty(data, await meKey());
  },
  watch(code, cb) {
    const channel = getSupabase().channel(`party:${code}`).on('broadcast', { event: 'changed' }, cb).subscribe();
    partyChannels.set(code, channel);
    return () => {
      partyChannels.delete(code);
      void getSupabase().removeChannel(channel);
    };
  },
};

export const supabaseNotifications: NotificationsRepo = {
  async list() {
    if (!(await uid())) return [];
    const rows = (check(await getSupabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) ?? []) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      kind: String(r.kind),
      title: String(r.title),
      body: String(r.body ?? ''),
      link: (r.link as string | null) ?? null,
      read: Boolean(r.read_at),
      createdAt: String(r.created_at),
    }));
  },
  async markRead(id) {
    let q = getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (id) q = q.eq('id', id);
    check(await q);
    emitTopic('notifications');
  },
};

export function supabaseProfiles(byIds: (ids: string[]) => Promise<GameSummary[]>): ProfilesRepo {
  return {
    async get(username) {
      const data = check(await getSupabase().rpc('public_profile', { p_username: username })) as Row | null;
      if (!data) return null;
      const [favourites, recent] = await Promise.all([byIds((data.favourites as string[]) ?? []), byIds((data.recent as string[]) ?? [])]);
      const stats = {
        gamesPlayed: Number(data.games_played ?? 0),
        minutesPlayed: Number(data.minutes_played ?? 0),
        questsCompleted: Number(data.quests_completed ?? 0),
      };
      const level = Number(data.level ?? 1);
      return {
        id: String(data.id),
        username: String(data.username),
        displayName: String(data.display_name ?? ''),
        avatar: (data.avatar as Record<string, string>) ?? {},
        level,
        brainPoints: Number(data.brain_points ?? 0),
        streakDays: Number(data.streak_days ?? 0),
        createdAt: String(data.created_at),
        favourites,
        recent,
        stats,
        badges: badgesFor(stats, { streakDays: Number(data.streak_days ?? 0), level }),
      };
    },
  };
}

export const supabaseLeaderboards: LeaderboardsRepo = {
  async points(period, friends) {
    const data = check(await getSupabase().rpc('points_top', { p_period: period, p_friends: friends, p_limit: 50 })) as { entries: Row[]; me: Row | null };
    const map = (r: Row) => ({
      rank: Number(r.rank),
      name: String(r.name),
      points: Number(r.points),
      level: Number(r.level ?? 1),
      isMe: Boolean(r.is_me),
      cosmetics: (r.cosmetics as Record<string, string>) ?? {},
    });
    return { entries: (data?.entries ?? []).map(map), me: data?.me ? map(data.me) : null };
  },
  async boards(gameId) {
    const rows = (check(await getSupabase().from('leaderboards').select('key').eq('game_id', gameId)) ?? []) as Row[];
    return rows.map((r) => String(r.key));
  },
};
