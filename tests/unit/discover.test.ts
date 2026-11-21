import { describe, expect, it } from 'vitest';
import { dailyPick, msUntilNextDay, redeemCheck, risingScore } from '@/lib/domain/discover';

describe('discover', () => {
  it('rewards games testers loved, but not on one answer alone', () => {
    const loved = risingScore(5, 1, 20);
    const lucky = risingScore(5, 1, 1);
    const meh = risingScore(2, 0.2, 20);
    expect(loved).toBeGreaterThan(lucky);
    expect(lucky).toBeGreaterThan(meh);
    expect(risingScore(5, 1, 0)).toBe(0);
  });

  it('picks the same daily game for everyone on a day, and changes between days', () => {
    const games = Array.from({ length: 12 }, (_, i) => ({ id: `game-${i}` }));
    expect(dailyPick(games, '2026-11-21')).toEqual(dailyPick([...games].reverse(), '2026-11-21'));
    const week = new Set(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'].map((d) => dailyPick(games, d)!.id));
    expect(week.size).toBeGreaterThan(1);
    expect(dailyPick([], '2026-11-21')).toBeNull();
    expect(msUntilNextDay(new Date('2026-11-21T23:00:00Z'))).toBe(3_600_000);
  });

  it('swaps points for Premium days within the monthly limit, extending the same plan only', () => {
    const now = new Date('2026-11-21T00:00:00Z');
    const ok = redeemCheck('plus_7d', { points: 3000, daysThisMonth: 0, plan: null, until: null }, now);
    expect(ok).toEqual({ ok: true, option: expect.objectContaining({ days: 7 }), until: '2026-11-28T00:00:00.000Z' });
    expect(redeemCheck('plus_7d', { points: 100, daysThisMonth: 0, plan: null, until: null }, now)).toEqual({ ok: false, problem: 'points' });
    expect(redeemCheck('plus_7d', { points: 9999, daysThisMonth: 8, plan: null, until: null }, now)).toEqual({ ok: false, problem: 'monthly_limit' });
    expect(redeemCheck('plus_1d', { points: 9999, daysThisMonth: 0, plan: 'max', until: '2026-12-01T00:00:00Z' }, now)).toEqual({ ok: false, problem: 'other_plan' });
    const extend = redeemCheck('plus_1d', { points: 9999, daysThisMonth: 0, plan: 'plus', until: '2026-11-25T00:00:00Z' }, now);
    expect(extend.ok && extend.until).toBe('2026-11-26T00:00:00.000Z');
  });
});
