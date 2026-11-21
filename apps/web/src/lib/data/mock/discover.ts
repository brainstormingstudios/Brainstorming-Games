import { DISCOVERY_POINTS, RISING_MIN_ANSWERS, RISING_WINDOW_DAYS, dailyPick, redeemCheck, risingScore, utcDay } from '@/lib/domain/discover';
import { emitTopic } from '../bus';
import { RepoError, type DiscoverRepo } from '../repo';
import { currentMockUser, requireProfile, updateUser } from './auth';
import { notify, readTable } from './db';
import { awardPoints } from './social';

const FULL = new Set(['rise', 'featured']);
const named = (u: { profilePublic: boolean; bannedAt: string | null; isMinor: boolean; consent: string }) =>
  u.profilePublic && !u.bannedAt && (!u.isMinor || u.consent === 'granted');

/** Mock side of the games_promoted trigger: Early Access testers get points and a notification. */
export function creditDiscoverers(gameId: string): void {
  const game = readTable('games').find((g) => g.id === gameId);
  if (!game) return;
  for (const p of readTable('playtests').filter((x) => x.gameId === gameId)) {
    if (awardPoints(p.userId, DISCOVERY_POINTS, 'discovered', `game:${gameId}`)) {
      notify(p.userId, 'discovered', `You discovered ${game.title}`, `A game you rated in Early Access reached Full Launch. +${DISCOVERY_POINTS} Brain Points and your name on its page.`, `/game/${game.slug}/`);
    }
  }
}

function monthDays(userId: string): number {
  const start = new Date();
  const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString();
  return readTable('ledger')
    .filter((l) => l.userId === userId && l.reason === 'redeem_premium' && l.createdAt >= monthStart)
    .reduce((n, l) => n + ((l.ref ?? '').startsWith('plus_7d') ? 7 : 1), 0);
}

export const mockDiscover: DiscoverRepo = {
  async myDiscoveries() {
    const me = currentMockUser();
    if (!me) return [];
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    return readTable('playtests')
      .filter((p) => p.userId === me.id && FULL.has(games.get(p.gameId)?.status ?? ''))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ gameId: p.gameId, slug: games.get(p.gameId)!.slug, title: games.get(p.gameId)!.title, ratedAt: p.createdAt }));
  },
  async discoverers(gameId) {
    const game = readTable('games').find((g) => g.id === gameId);
    if (!game || !FULL.has(game.status)) return null;
    const users = new Map(readTable('users').map((u) => [u.id, u]));
    const rows = readTable('playtests').filter((p) => p.gameId === gameId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const names = rows
      .map((p) => users.get(p.userId))
      .filter((u): u is NonNullable<typeof u> => Boolean(u && u.username && named(u)))
      .slice(0, 12)
      .map((u) => u.username!);
    return { total: rows.length, names };
  },
  async rising(limit) {
    const since = new Date(Date.now() - RISING_WINDOW_DAYS * 86_400_000).toISOString();
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const by = new Map<string, { n: number; fun: number; again: number }>();
    for (const p of readTable('playtests')) {
      const g = games.get(p.gameId);
      if (p.createdAt < since || !g?.releasedAt || !['spark', 'rise', 'featured'].includes(g.status)) continue;
      const row = by.get(p.gameId) ?? { n: 0, fun: 0, again: 0 };
      row.n += 1;
      row.fun += p.fun;
      row.again += p.playAgain ? 1 : 0;
      by.set(p.gameId, row);
    }
    return [...by.entries()]
      .filter(([, r]) => r.n >= RISING_MIN_ANSWERS)
      .map(([gameId, r]) => ({ gameId, answers: r.n, score: risingScore(r.fun / r.n, r.again / r.n, r.n) }))
      .sort((a, b) => b.score - a.score || b.answers - a.answers)
      .slice(0, limit);
  },
  async daily() {
    const suspended = new Set(readTable('studios').filter((s) => s.suspendedAt).map((s) => s.id));
    const boards = readTable('leaderboards');
    const candidates = readTable('games')
      .filter((g) => g.releasedAt && FULL.has(g.status) && !suspended.has(g.studioId))
      .map((g) => ({ id: g.id, board: boards.find((b) => b.gameId === g.id)?.key ?? null }));
    const withBoard = candidates.filter((c) => c.board);
    const day = utcDay();
    const pick = dailyPick(withBoard.length ? withBoard : candidates, day);
    return pick ? { day, gameId: pick.id, board: pick.board } : null;
  },
  async pointDaysThisMonth() {
    const me = currentMockUser();
    return me ? monthDays(me.id) : 0;
  },
  async redeemPoints(optionId) {
    const user = requireProfile();
    const check = redeemCheck(optionId, { points: user.brainPoints, daysThisMonth: monthDays(user.id), plan: user.premiumPlan ?? null, until: user.premiumUntil ?? null });
    // Same codes as redeem_points in 0018_discover.sql, in the message.
    if (!check.ok) throw new RepoError('invalid', check.problem === 'points' ? 'insufficient_points' : check.problem === 'unknown' ? 'invalid' : check.problem);
    awardPoints(user.id, -check.option.cost, 'redeem_premium', `${check.option.id}:${Date.now()}`);
    const active = user.premiumPlan && user.premiumUntil && new Date(user.premiumUntil) > new Date();
    updateUser(user.id, { premiumPlan: check.option.plan, premiumUntil: check.until, ...(active ? {} : { premiumFromPass: false, premiumAutoRenew: false }) });
    emitTopic('session', { local: true });
    emitTopic('points');
    return { plan: check.option.plan, until: check.until };
  },
};
