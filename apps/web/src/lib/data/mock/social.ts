import { isRestricted } from '@/lib/domain/ageGate';
import {
  PARTY_PHRASES,
  activeQuests,
  badgesFor,
  levelFor,
  nextStreak,
  periodStart,
  questProgress,
  type ProgressInputs,
} from '@/lib/domain/progression';
import { getPrefs } from '@/lib/prefs';
import { emitTopic, onTopic } from '../bus';
import { getAnonId, local } from '../local';
import type {
  LeaderboardsRepo,
  LockerRepo,
  NotificationsRepo,
  PartyRepo,
  PartyView,
  PresenceInfo,
  ProfilesRepo,
  DailyPuzzleState,
  QuestsRepo,
  SocialRepo,
  Activity,
} from '../repo';
import { publicSummaries } from './catalogue';
import { currentMockUser, currentUserId, requireProfile, updateUser } from './auth';
import { fail, mutateTable, newId, notify, nowIso, readTable, takeToken, type MockUser, type MockTables } from './db';
import { effectiveCosmetics, effectiveQuests } from './growth';
import { friendIdsOf, weekStart } from './play';

// ---------------------------------------------------------------------------------------------
// Brain Points, quests and streaks (mirror of 0004_progression.sql)
// ---------------------------------------------------------------------------------------------

/** Adds points once per reference and keeps the profile's balance and level in step. */
export function awardPoints(userId: string, delta: number, reason: string, ref: string | null): boolean {
  if (ref && readTable('ledger').some((l) => l.userId === userId && l.ref === ref && l.reason === reason)) return false;
  mutateTable('ledger', (rows) => {
    rows.push({ id: newId(), userId, delta, reason, ref, createdAt: nowIso() });
  });
  const ledger = readTable('ledger').filter((l) => l.userId === userId);
  const lifetime = ledger.filter((l) => l.delta > 0).reduce((n, l) => n + l.delta, 0);
  const balance = Math.max(0, ledger.reduce((n, l) => n + l.delta, 0));
  updateUser(userId, { brainPoints: balance, level: levelFor(lifetime) });
  emitTopic('points');
  return true;
}

function progressInputs(userId: string, since: string): ProgressInputs {
  const games = new Map(readTable('games').map((g) => [g.id, g]));
  const sessions = new Map<string, { gameId: string; seconds: number; at: string; played: boolean }>();
  for (const e of readTable('events')) {
    if (e.userId !== userId || !e.gameId || !e.sessionId || e.ts < since) continue;
    let s = sessions.get(e.sessionId);
    if (!s) sessions.set(e.sessionId, (s = { gameId: e.gameId, seconds: 0, at: e.ts, played: false }));
    if (e.type === 'play_click') s.played = true;
    const t = typeof e.payload.t === 'number' ? e.payload.t : 0;
    s.seconds = Math.max(s.seconds, t);
  }
  const plays = [...sessions.values()]
    .filter((s) => s.played)
    .map((s) => {
      const g = games.get(s.gameId);
      return { gameId: s.gameId, category: g?.category ?? '', multiplayer: g?.isMultiplayer ?? false, releasedAt: g?.releasedAt ?? null, seconds: s.seconds, at: s.at };
    });
  const custom: Record<string, number> = {};
  for (const q of readTable('questEvents')) if (q.userId === userId && q.at >= since) custom[q.event] = (custom[q.event] ?? 0) + q.value;
  return {
    plays,
    ratings: readTable('ratings').filter((r) => r.voterKey === `user:${userId}` && r.createdAt >= since).length,
    favourites: readTable('userFavourites').filter((f) => f.userId === userId && f.createdAt >= since).length,
    custom,
  };
}

/** Recomputes quest progress and awards completed quests once (mirror of app.refresh_quests). */
export function refreshQuests(userId: string) {
  const out: { code: string; progress: number; completed: boolean }[] = [];
  for (const q of activeQuests(effectiveQuests())) {
    const start = periodStart(q.period);
    const progress = questProgress(q, progressInputs(userId, `${start}T00:00:00.000Z`));
    const completed = progress >= q.target;
    if (completed && awardPoints(userId, q.reward, 'quest', `${q.code}:${start}`)) {
      notify(userId, 'quest', 'Quest complete', `+${q.reward} Brain Points`, '/quests/');
      emitTopic('notifications');
    }
    out.push({ code: q.code, progress, completed });
  }
  return out;
}

/** Called after an event batch from a signed-in player (mirror of app.on_events_ingested). */
export function afterEvents(userId: string, types: string[]) {
  const user = readTable('users').find((u) => u.id === userId);
  if (!user?.username || user.bannedAt) return;
  if (types.includes('play_click')) {
    const today = new Date().toISOString().slice(0, 10);
    updateUser(userId, { streakDays: nextStreak(user.streakDays, user.streakLastDay, today), streakLastDay: today, lastActive: nowIso() });
  }
  refreshQuests(userId);
  emitTopic('quests');
}

const dayShift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const mockQuestsRepo: Omit<QuestsRepo, 'track'> = {
  async dailyPuzzles(day) {
    const user = currentMockUser();
    if (!user) return null;
    const freezes = user.streakFreezes ?? 0;
    const streaks: DailyPuzzleState['streaks'] = {};
    for (const s of readTable('dailyStreaks').filter((x) => x.userId === user.id)) {
      const alive = s.lastDay != null && (s.lastDay >= dayShift(day, -1) || (s.lastDay === dayShift(day, -2) && freezes > 0));
      streaks[s.kind] = { streak: alive ? s.streak : 0, best: s.best, lastDay: s.lastDay };
    }
    const done: DailyPuzzleState['done'] = {};
    for (const r of readTable('dailyResults').filter((x) => x.userId === user.id && x.day === day)) done[r.kind] = r.score;
    return { freezes, streaks, done };
  },
  async completePuzzle(kind, day, score) {
    const user = requireProfile();
    if (readTable('dailyResults').some((r) => r.userId === user.id && r.kind === kind && r.day === day)) {
      const s = readTable('dailyStreaks').find((x) => x.userId === user.id && x.kind === kind);
      return { streak: s?.streak ?? 0, best: s?.best ?? 0, points: 0, freezeUsed: false };
    }
    mutateTable('dailyResults', (rows) => [...rows, { userId: user.id, kind, day, score }]);
    const s = readTable('dailyStreaks').find((x) => x.userId === user.id && x.kind === kind);
    let streak = 1;
    let freezeUsed = false;
    if (s?.lastDay === dayShift(day, -1)) streak = s.streak + 1;
    else if (s?.lastDay === dayShift(day, -2) && (user.streakFreezes ?? 0) > 0) {
      streak = s.streak + 1;
      freezeUsed = true;
      updateUser(user.id, { streakFreezes: (user.streakFreezes ?? 0) - 1 });
    }
    const best = Math.max(streak, s?.best ?? 0);
    mutateTable('dailyStreaks', (rows) => [...rows.filter((x) => !(x.userId === user.id && x.kind === kind)), { userId: user.id, kind, streak, best, lastDay: day }]);
    const points = 10 + Math.min(streak - 1, 10);
    awardPoints(user.id, points, 'daily_puzzle', `${kind}:${day}`);
    emitTopic('points');
    return { streak, best, points, freezeUsed };
  },
  async buyHint(kind, day) {
    const user = requireProfile();
    const used = readTable('ledger').filter((l) => l.userId === user.id && l.reason === 'puzzle_hint' && (l.ref ?? '').startsWith(`${kind}:${day}:`)).length;
    if (used >= 3) fail('conflict', 'Three hints a puzzle a day.');
    if (user.brainPoints < 30) fail('invalid', 'A hint costs 30 Brain Points.');
    awardPoints(user.id, -30, 'puzzle_hint', `${kind}:${day}:${used + 1}`);
    emitTopic('points');
    return used + 1;
  },
  async buyStreakFreeze() {
    const user = requireProfile();
    const held = user.streakFreezes ?? 0;
    if (held >= 3) fail('conflict', 'You already hold 3 streak freezes.');
    if (user.brainPoints < 60) fail('invalid', 'A streak freeze costs 60 Brain Points.');
    awardPoints(user.id, -60, 'streak_freeze', null);
    updateUser(user.id, { streakFreezes: held + 1 });
    emitTopic('points');
    return held + 1;
  },
  async mine(locale) {
    const user = currentMockUser();
    const done = user?.username ? refreshQuests(user.id) : [];
    void locale;
    const lang = 'en';
    const lifetime = user ? readTable('ledger').filter((l) => l.userId === user.id && l.delta > 0).reduce((n, l) => n + l.delta, 0) : 0;
    const today = new Date().toISOString().slice(0, 10);
    return {
      quests: activeQuests(effectiveQuests()).map((q) => {
        const d = done.find((x) => x.code === q.code);
        return {
          code: q.code,
          period: q.period,
          title: q.title[lang],
          description: q.description[lang],
          target: q.target,
          reward: q.reward,
          progress: d?.progress ?? 0,
          completed: d?.completed ?? false,
          category: q.rule.kind === 'play_distinct' ? (q.rule.category ?? null) : null,
        };
      }),
      brainPoints: user?.brainPoints ?? 0,
      level: user?.level ?? 1,
      lifetimePoints: lifetime,
      streakDays: user?.streakDays ?? 0,
      playedToday: user?.streakLastDay === today,
    };
  },
  async ledger() {
    const user = currentMockUser();
    if (!user) return [];
    return readTable('ledger')
      .filter((l) => l.userId === user.id)
      .reverse()
      .slice(0, 100)
      .map((l) => ({ delta: l.delta, reason: l.reason, createdAt: l.createdAt }));
  },
};

// ---------------------------------------------------------------------------------------------
// Locker
// ---------------------------------------------------------------------------------------------

const freeItems = () => effectiveCosmetics().filter((x) => x.cost === 0 && x.minLevel <= 1);

export const mockLocker: LockerRepo = {
  async items(locale) {
    const user = currentMockUser();
    const owned = new Set(
      user ? [...freeItems().map((x) => `${x.slot}:${x.code}`), ...readTable('userCosmetics').filter((u) => u.userId === user.id).map((u) => `${u.slot}:${u.code}`)] : [],
    );
    void locale;
    const lang = 'en';
    return effectiveCosmetics().map((x) => ({
      id: `${x.slot}:${x.code}`,
      slot: x.slot,
      code: x.code,
      name: x.name[lang],
      cost: x.cost,
      minLevel: x.minLevel,
      owned: owned.has(`${x.slot}:${x.code}`),
      equipped: user?.avatar[x.slot] === x.code,
    }));
  },
  async unlock(itemId) {
    const user = requireProfile();
    const [slot, code] = itemId.split(':');
    const item = effectiveCosmetics().find((x) => x.slot === slot && x.code === code);
    if (!item) fail('not_found');
    if (readTable('userCosmetics').some((u) => u.userId === user.id && u.slot === slot && u.code === code)) return;
    if (user.level < item.minLevel || user.brainPoints < item.cost) fail('not_allowed');
    mutateTable('userCosmetics', (rows) => {
      rows.push({ userId: user.id, slot: item.slot, code: item.code, unlockedAt: nowIso() });
    });
    if (item.cost > 0) awardPoints(user.id, -item.cost, 'cosmetic', itemId);
    emitTopic('profile');
  },
  async equip(cosmetics) {
    const user = requireProfile();
    const owned = new Set([...freeItems().map((x) => `${x.slot}:${x.code}`), ...readTable('userCosmetics').filter((u) => u.userId === user.id).map((u) => `${u.slot}:${u.code}`)]);
    const next: Record<string, string> = {};
    for (const [slot, code] of Object.entries(cosmetics)) {
      if (!code || slot === 'pictureUrl') continue;
      if (slot === 'picture' && code === 'upload') {
        if (!user.avatar.pictureUrl) fail('not_allowed');
        next.picture = 'upload';
        next.pictureUrl = user.avatar.pictureUrl;
        continue;
      }
      if (!owned.has(`${slot}:${code}`)) fail('not_allowed');
      next[slot] = code;
    }
    updateUser(user.id, { avatar: next });
    emitTopic('session', { local: true });
    emitTopic('profile');
  },
  async uploadPicture(image) {
    const user = requireProfile();
    if (user.isMinor) fail('not_allowed', 'Pictures are for adults.');
    if (image.size > 262_144) fail('invalid', 'That picture is too big.');
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('read'));
      r.readAsDataURL(image);
    });
    updateUser(user.id, { avatar: { ...user.avatar, picture: 'upload', pictureUrl: url } });
    emitTopic('session', { local: true });
    emitTopic('profile');
  },
};

// ---------------------------------------------------------------------------------------------
// Friends and presence
// ---------------------------------------------------------------------------------------------

const unrestricted = (u: MockUser | undefined | null) => Boolean(u && u.username && !u.bannedAt && !isRestricted(u) && !u.schoolSafe);

const PRESENCE_KEY = 'bg.mock.presence';
const ONLINE_MS = 15_000;
let myActivity: Activity | null = null;
let heartbeat: number | null = null;

function writePresence() {
  const id = currentUserId();
  if (!id) return;
  const all = local.get<Record<string, { at: number; activity: Activity | null }>>(PRESENCE_KEY, {});
  all[id] = { at: Date.now(), activity: myActivity };
  local.set(PRESENCE_KEY, all);
}

function startHeartbeat() {
  if (heartbeat != null || typeof window === 'undefined') return;
  writePresence();
  heartbeat = window.setInterval(() => {
    if (document.visibilityState === 'visible') writePresence();
  }, 4000);
  window.addEventListener('pagehide', () => {
    const id = currentUserId();
    if (!id) return;
    const all = local.get<Record<string, { at: number; activity: Activity | null }>>(PRESENCE_KEY, {});
    delete all[id];
    local.set(PRESENCE_KEY, all);
  });
}

export const mockSocial: SocialRepo = {
  async friends() {
    const me = currentMockUser();
    if (!me) return [];
    const users = new Map(readTable('users').map((u) => [u.id, u]));
    return readTable('friendships')
      .filter((f) => f.requester === me.id || f.addressee === me.id)
      .map((f) => {
        const other = users.get(f.requester === me.id ? f.addressee : f.requester);
        return other && !other.bannedAt
          ? {
              id: other.id,
              username: other.username ?? '',
              displayName: other.displayName,
              avatar: other.avatar,
              level: other.level,
              status: f.status,
              direction: f.requester === me.id ? ('outgoing' as const) : ('incoming' as const),
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => a.status.localeCompare(b.status) || a.username.localeCompare(b.username));
  },
  async request(username) {
    const me = requireProfile();
    if (!unrestricted(me)) fail('not_allowed');
    if (!takeToken(`friend:${me.id}`, 20, 3_600_000)) fail('rate_limited');
    const other = readTable('users').find((u) => u.username === username.trim().toLowerCase().replace(/^@/, ''));
    if (!other || other.id === me.id || !unrestricted(other)) fail('not_found');
    const existing = readTable('friendships').find(
      (f) => (f.requester === me.id && f.addressee === other.id) || (f.requester === other.id && f.addressee === me.id),
    );
    if (existing?.status === 'accepted') return 'accepted';
    if (existing && existing.requester === other.id) {
      mutateTable('friendships', (rows) => {
        const row = rows.find((f) => f.requester === other.id && f.addressee === me.id);
        if (row) row.status = 'accepted';
      });
      notify(other.id, 'friend', 'Friend request accepted', me.username, '/friends/');
      emitTopic('friends');
      emitTopic('notifications');
      return 'accepted';
    }
    if (!existing) {
      mutateTable('friendships', (rows) => {
        rows.push({ requester: me.id, addressee: other.id, status: 'pending', createdAt: nowIso() });
      });
      notify(other.id, 'friend', 'New friend request', me.username, '/friends/');
    }
    emitTopic('friends');
    emitTopic('notifications');
    return 'pending';
  },
  async respond(userId, accept) {
    const me = requireProfile();
    if (accept && !unrestricted(me)) fail('not_allowed');
    mutateTable('friendships', (rows) =>
      accept
        ? rows.map((f) => (f.requester === userId && f.addressee === me.id ? { ...f, status: 'accepted' as const } : f))
        : rows.filter((f) => !(f.requester === userId && f.addressee === me.id && f.status === 'pending')),
    );
    if (accept) notify(userId, 'friend', 'Friend request accepted', me.username, '/friends/');
    emitTopic('friends');
    emitTopic('notifications');
  },
  async remove(userId) {
    const me = requireProfile();
    mutateTable('friendships', (rows) =>
      rows.filter((f) => !((f.requester === me.id && f.addressee === userId) || (f.requester === userId && f.addressee === me.id))),
    );
    emitTopic('friends');
  },
  watchPresence(cb) {
    startHeartbeat();
    const read = () => {
      const me = currentUserId();
      const friends = me ? friendIdsOf(me) : new Set<string>();
      const all = local.get<Record<string, { at: number; activity: Activity | null }>>(PRESENCE_KEY, {});
      const out: Record<string, PresenceInfo> = {};
      for (const id of friends) {
        const p = all[id];
        const online = Boolean(p && Date.now() - p.at < ONLINE_MS);
        out[id] = { online, activity: online ? (p?.activity ?? null) : null };
      }
      cb(out);
    };
    read();
    const timer = window.setInterval(read, 3000);
    const onStorage = (e: StorageEvent) => e.key === PRESENCE_KEY && read();
    window.addEventListener('storage', onStorage);
    const off = onTopic('friends', read);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      off();
    };
  },
  setActivity(activity) {
    myActivity = activity;
    startHeartbeat();
    writePresence();
  },
};

// ---------------------------------------------------------------------------------------------
// Party rooms (mirror of the party_* functions in 0005_social.sql)
// ---------------------------------------------------------------------------------------------

type PartyRow = MockTables['parties'][number];

function callerKey(): string {
  const id = currentUserId();
  return id ? id : `anon:${getAnonId()}`;
}

function memberFor(): PartyRow['members'][number] {
  const user = currentMockUser();
  return {
    key: callerKey(),
    name: user?.displayName || user?.username || 'Guest',
    cosmetics: user?.avatar ?? {},
    canChat: unrestricted(user) && !getPrefs().schoolSafe,
  };
}

function toView(p: PartyRow): PartyView {
  return { ...p, meKey: callerKey() };
}

function liveParty(code: string): PartyRow | null {
  return readTable('parties').find((p) => p.code === code.toUpperCase() && p.expiresAt > nowIso()) ?? null;
}

function saveParty(code: string, fn: (p: PartyRow) => void): PartyRow {
  let out: PartyRow | null = null;
  mutateTable('parties', (rows) => {
    const row = rows.find((p) => p.code === code);
    if (row) {
      fn(row);
      out = row;
    }
  });
  if (!out) fail('not_found');
  emitTopic('party');
  return out;
}

export const mockParty: PartyRepo = {
  async create(gameId) {
    if (!takeToken(`party-create:${callerKey()}`, 6, 600_000)) fail('rate_limited');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (liveParty(code));
    const row: PartyRow = {
      code,
      hostKey: callerKey(),
      currentGameId: gameId ?? null,
      members: [memberFor()],
      votes: {},
      chat: [],
      state: 'lobby',
      expiresAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    };
    mutateTable('parties', (rows) => [...rows.filter((p) => p.expiresAt > nowIso()), row]);
    emitTopic('party');
    return toView(row);
  },
  async get(code) {
    const p = liveParty(code);
    return p ? toView(p) : null;
  },
  async join(code) {
    const p = liveParty(code);
    if (!p) fail('not_found');
    const me = memberFor();
    if (p.members.length >= 12 && !p.members.some((m) => m.key === me.key)) fail('conflict');
    return toView(saveParty(p.code, (row) => {
      row.members = [...row.members.filter((m) => m.key !== me.key), me];
    }));
  },
  async leave(code) {
    const p = liveParty(code);
    if (!p) return;
    const key = callerKey();
    const rest = p.members.filter((m) => m.key !== key);
    if (rest.length === 0) {
      mutateTable('parties', (rows) => rows.filter((x) => x.code !== p.code));
      emitTopic('party');
      return;
    }
    saveParty(p.code, (row) => {
      row.members = rest;
      delete row.votes[key];
      if (row.hostKey === key) row.hostKey = rest[0]!.key;
    });
  },
  async act(code, action, options = {}) {
    const p = liveParty(code);
    if (!p) fail('not_found');
    const key = callerKey();
    const member = p.members.find((m) => m.key === key);
    if (!member) fail('not_allowed');
    if (!takeToken(`party-act:${key}`, 60, 60_000)) fail('rate_limited');
    const publicIds = new Set(publicSummaries().map((g) => g.id));
    return toView(saveParty(p.code, (row) => {
      if (action === 'vote') {
        if (!options.gameId || !publicIds.has(options.gameId)) fail('invalid');
        row.votes[key] = options.gameId;
      } else if (action === 'chat') {
        if (!member.canChat) fail('not_allowed');
        if (!options.phrase || !(PARTY_PHRASES as readonly string[]).includes(options.phrase)) fail('invalid');
        row.chat = [...row.chat, { key, name: member.name, phrase: options.phrase, at: nowIso() }].slice(-30);
      } else {
        if (row.hostKey !== key) fail('not_allowed');
        if (action !== 'lobby' && options.gameId) {
          if (!publicIds.has(options.gameId)) fail('invalid');
          row.currentGameId = options.gameId;
        }
        if (action === 'start') {
          if (!row.currentGameId) fail('invalid');
          row.state = 'playing';
          row.votes = {};
        }
        if (action === 'lobby') row.state = 'lobby';
        row.expiresAt = new Date(Date.now() + 6 * 3_600_000).toISOString();
      }
    }));
  },
  watch(_code, cb) {
    return onTopic('party', cb);
  },
};

// ---------------------------------------------------------------------------------------------
// Notifications, public profiles, leaderboards
// ---------------------------------------------------------------------------------------------

export const mockNotifications: NotificationsRepo = {
  async list() {
    const me = currentUserId();
    if (!me) return [];
    return readTable('notifications')
      .filter((n) => n.userId === me)
      .reverse()
      .slice(0, 100)
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: Boolean(n.readAt), createdAt: n.createdAt }));
  },
  async markRead(id) {
    const me = currentUserId();
    if (!me) return;
    mutateTable('notifications', (rows) => {
      for (const n of rows) if (n.userId === me && (!id || n.id === id) && !n.readAt) n.readAt = nowIso();
    });
    emitTopic('notifications');
  },
};

export const mockProfiles: ProfilesRepo = {
  async get(username) {
    const u = readTable('users').find((x) => x.username === username.toLowerCase());
    const me = currentUserId();
    // Minors without consent and private profiles are visible only to themselves.
    if (!u || u.bannedAt || ((!u.profilePublic || isRestricted(u)) && u.id !== me)) return null;
    const games = new Map(publicSummaries().map((g) => [g.id, g]));
    const history = readTable('userHistory').filter((h) => h.userId === u.id).sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
    const stats = {
      gamesPlayed: history.length,
      minutesPlayed: Math.round(history.reduce((n, h) => n + h.secondsPlayed, 0) / 60),
      questsCompleted: readTable('ledger').filter((l) => l.userId === u.id && l.reason === 'quest').length,
    };
    return {
      id: u.id,
      username: u.username!,
      displayName: u.displayName,
      avatar: u.avatar,
      level: u.level,
      brainPoints: u.brainPoints,
      streakDays: u.streakDays,
      createdAt: u.createdAt,
      favourites: readTable('userFavourites').filter((f) => f.userId === u.id).map((f) => games.get(f.gameId)).filter((g) => g != null).slice(0, 12),
      recent: history.map((h) => games.get(h.gameId)).filter((g) => g != null).slice(0, 12),
      stats,
      badges: badgesFor(stats, u),
    };
  },
};

export const mockLeaderboards: LeaderboardsRepo = {
  async points(period, friends) {
    const me = currentUserId();
    const since = period === 'week' ? weekStart() : '';
    const friendIds = friends && me ? friendIdsOf(me) : null;
    const totals = new Map<string, number>();
    for (const l of readTable('ledger')) {
      if (l.delta <= 0 || l.createdAt < since) continue;
      if (friendIds && l.userId !== me && !friendIds.has(l.userId)) continue;
      totals.set(l.userId, (totals.get(l.userId) ?? 0) + l.delta);
    }
    const users = new Map(readTable('users').map((u) => [u.id, u]));
    const rows = [...totals.entries()]
      .map(([id, points]) => ({ id, points, u: users.get(id) }))
      .filter((r) => r.u && !r.u.bannedAt)
      .sort((a, b) => b.points - a.points)
      .map((r, i) => {
        const named = r.u!.profilePublic && !isRestricted(r.u!);
        return {
          rank: i + 1,
          name: named ? r.u!.username ?? 'Player' : `Player#${r.id.slice(0, 4).toUpperCase()}`,
          points: r.points,
          level: r.u!.level,
          isMe: r.id === me,
          cosmetics: named ? r.u!.avatar : {},
        };
      });
    return { entries: rows.slice(0, 50), me: rows.find((r) => r.isMe) ?? null };
  },
  async boards(gameId) {
    return readTable('leaderboards').filter((b) => b.gameId === gameId).map((b) => b.key);
  },
};
