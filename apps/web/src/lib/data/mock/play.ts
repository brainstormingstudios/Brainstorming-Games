import { LIMITS } from '@/lib/config';
import { emitTopic } from '../bus';
import { local } from '../local';
import type { QuestsRepo, SavesRepo, ScoresRepo } from '../repo';
import { currentMockUser } from './auth';
import { fail, mutateTable, newId, nowIso, readTable, takeToken } from './db';

/** Guest saves live in this browser only, namespaced by game. */
const guestKey = (gameId: string, key: string) => `bg.saves.${gameId}.${key}`;

function checkSize(value: unknown) {
  const size = JSON.stringify(value ?? null).length;
  if (size > LIMITS.cloudSaveMaxBytes) fail('invalid', 'Save data is larger than 1 MB.');
}

export const mockSaves: SavesRepo = {
  async get(gameId, key) {
    const user = currentMockUser();
    if (!user?.username) return local.get(guestKey(gameId, key), null);
    return readTable('cloudSaves').find((s) => s.userId === user.id && s.gameId === gameId && s.key === key)?.value ?? null;
  },
  async set(gameId, key, value) {
    checkSize(value);
    const user = currentMockUser();
    if (!user?.username) {
      local.set(guestKey(gameId, key), value);
      return;
    }
    if (!takeToken(`save:${user.id}`, 60, 60_000)) fail('rate_limited');
    mutateTable('cloudSaves', (rows) => {
      const row = rows.find((s) => s.userId === user.id && s.gameId === gameId && s.key === key);
      if (row) Object.assign(row, { value, updatedAt: nowIso() });
      else rows.push({ userId: user.id, gameId, key, value, updatedAt: nowIso() });
    });
    emitTopic('saves');
  },
  async remove(gameId, key) {
    const user = currentMockUser();
    if (!user?.username) {
      local.remove(guestKey(gameId, key));
      return;
    }
    mutateTable('cloudSaves', (rows) => rows.filter((s) => !(s.userId === user.id && s.gameId === gameId && s.key === key)));
  },
};

/** Moves guest saves into the account (called once after login). Cloud values win. */
export function mergeGuestSaves(userId: string): void {
  if (typeof window === 'undefined') return;
  const prefix = 'bg.saves.';
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
  } catch {
    return;
  }
  mutateTable('cloudSaves', (rows) => {
    for (const k of keys) {
      const [gameId, ...rest] = k.slice(prefix.length).split('.');
      const key = rest.join('.');
      if (!gameId || !key) continue;
      if (!rows.some((s) => s.userId === userId && s.gameId === gameId && s.key === key)) {
        rows.push({ userId, gameId, key, value: local.get(k, null), updatedAt: nowIso() });
      }
      local.remove(k);
    }
  });
}

export const mockScores: ScoresRepo = {
  async startSession(gameId) {
    const user = currentMockUser();
    const id = newId();
    mutateTable('playSessions', (rows) => {
      rows.push({ id, userId: user?.id ?? null, gameId, startedAt: nowIso() });
      return rows.slice(-500);
    });
    return id;
  },
  async submit(gameId, board, score, sessionId) {
    const user = currentMockUser();
    if (!user?.username) fail('login_required');
    if (!Number.isFinite(score)) fail('invalid');
    if (!takeToken(`score:${user.id}`, 3, 15_000)) fail('rate_limited');
    const session = readTable('playSessions').find((s) => s.id === sessionId);
    if (!session || session.userId !== user.id || session.gameId !== gameId) fail('invalid');
    let boardRow = readTable('leaderboards').find((b) => b.gameId === gameId && b.key === board);
    if (!boardRow) {
      boardRow = { id: newId(), gameId, key: board, sortDesc: true, maxScorePerSec: null };
      const created = boardRow;
      mutateTable('leaderboards', (rows) => {
        rows.push(created);
      });
    }
    const game = readTable('games').find((g) => g.id === gameId);
    const rate = boardRow.maxScorePerSec ?? game?.maxScorePerSec ?? null;
    const elapsed = Math.max((Date.now() - new Date(session.startedAt).getTime()) / 1000, 1);
    if (rate != null && score > rate * elapsed) fail('invalid');
    const best = Math.max(0, ...readTable('scores').filter((s) => s.boardId === boardRow.id && !s.flagged).map((s) => s.score));
    const flagged = (rate != null && score > rate * elapsed * 0.9) || (best > 0 && score > best * 10);
    const id = boardRow.id;
    mutateTable('scores', (rows) => {
      rows.push({ id: newId(), boardId: id, userId: user.id, score, flagged, createdAt: nowIso() });
    });
    emitTopic('leaderboards');
    return { accepted: true };
  },
  async top(gameId, board, { limit, friends, period }) {
    const me = currentMockUser();
    const boardRow = readTable('leaderboards').find((b) => b.gameId === gameId && b.key === board);
    if (!boardRow) return { entries: [], me: null };
    const since = period === 'week' ? weekStart() : '';
    const friendIds = friends && me ? friendIdsOf(me.id) : null;
    const users = new Map(readTable('users').map((u) => [u.id, u]));
    const best = new Map<string, number>();
    for (const s of readTable('scores')) {
      if (s.boardId !== boardRow.id || s.flagged || s.createdAt < since) continue;
      if (friendIds && s.userId !== me?.id && !friendIds.has(s.userId)) continue;
      const prev = best.get(s.userId);
      if (prev == null || (boardRow.sortDesc ? s.score > prev : s.score < prev)) best.set(s.userId, s.score);
    }
    const ranked = [...best.entries()]
      .sort((a, b) => (boardRow.sortDesc ? b[1] - a[1] : a[1] - b[1]))
      .map(([userId, score], i) => {
        const u = users.get(userId);
        const named = u && u.profilePublic && (!u.isMinor || u.consent === 'granted');
        return {
          rank: i + 1,
          name: named ? (u.username ?? 'Player') : `Player#${userId.slice(0, 4).toUpperCase()}`,
          score,
          isMe: userId === me?.id,
          cosmetics: named ? u.avatar : {},
        };
      });
    return { entries: ranked.slice(0, limit), me: ranked.find((r) => r.isMe) ?? null };
  },
};

export function weekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString();
}

/** Accepted friends of a user. */
export function friendIdsOf(userId: string): Set<string> {
  const out = new Set<string>();
  for (const f of readTable('friendships')) {
    if (f.status !== 'accepted') continue;
    if (f.requester === userId) out.add(f.addressee);
    if (f.addressee === userId) out.add(f.requester);
  }
  return out;
}

export const mockQuests: Pick<QuestsRepo, 'track'> = {
  async track(event, value) {
    const user = currentMockUser();
    if (!user?.username) return;
    if (!/^[a-z0-9_]{1,40}$/.test(event)) fail('invalid');
    if (!takeToken(`quest-track:${user.id}`, 60, 60_000)) fail('rate_limited');
    mutateTable('questEvents', (rows) => {
      rows.push({ userId: user.id, event, value: Math.max(0, Math.min(value, 10)), at: nowIso() });
    });
    emitTopic('quests');
  },
};
