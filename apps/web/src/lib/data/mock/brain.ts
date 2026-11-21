import { normaliseSkills, type PlayRow } from '@/lib/domain/brain';
import { emitTopic } from '../bus';
import { getAnonId } from '../local';
import type { BrainData, BrainRepo } from '../repo';
import { currentMockUser, requireUser, updateUser } from './auth';
import { readTable } from './db';

/** Same rule as app.play_rows in 0017_brain.sql: a session counts its largest reported `t`, at most 6 hours. */
function playRows(match: (e: { userId: string | null; anonId: string }) => boolean, days = 400): BrainData {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const sessions = new Map<string, { gameId: string; day: string; seconds: number }>();
  for (const e of readTable('events')) {
    if (e.ts < since || !e.gameId || !e.sessionId || (e.type !== 'gameplay_stop' && e.type !== 'session_end') || !match(e)) continue;
    const t = typeof e.payload?.t === 'number' ? Math.min(21_600, Math.max(0, e.payload.t)) : 0;
    const s = sessions.get(e.sessionId);
    if (!s) sessions.set(e.sessionId, { gameId: e.gameId, day: e.ts.slice(0, 10), seconds: t });
    else {
      s.seconds = Math.max(s.seconds, t);
      if (e.ts.slice(0, 10) < s.day) s.day = e.ts.slice(0, 10);
    }
  }
  const byKey = new Map<string, PlayRow>();
  for (const s of sessions.values()) {
    if (s.seconds <= 0) continue;
    const key = `${s.gameId}|${s.day}`;
    const row = byKey.get(key) ?? { gameId: s.gameId, day: s.day, seconds: 0 };
    row.seconds += s.seconds;
    byKey.set(key, row);
  }
  const rows = [...byKey.values()];
  const ids = new Set(rows.map((r) => r.gameId));
  const skills: BrainData['skills'] = {};
  for (const g of readTable('games')) if (ids.has(g.id)) skills[g.id] = normaliseSkills(g.skills ?? []);
  return { rows, skills };
}

export const mockBrain: BrainRepo = {
  async mine() {
    const user = currentMockUser();
    if (user) return playRows((e) => e.userId === user.id);
    const anon = getAnonId();
    return playRows((e) => !e.userId && e.anonId === anon);
  },
  async of(username) {
    const u = readTable('users').find((x) => x.username === username.trim().toLowerCase());
    if (!u || !u.profilePublic || u.bannedAt || (u.isMinor && u.consent !== 'granted')) return null;
    return { username: u.username!, displayName: u.displayName, ...playRows((e) => e.userId === u.id) };
  },
  async reportEnabled() {
    const u = currentMockUser();
    return u ? u.brainReport !== false : false;
  },
  async setReport(on) {
    const u = requireUser();
    updateUser(u.id, { brainReport: on });
    emitTopic('profile');
  },
};
