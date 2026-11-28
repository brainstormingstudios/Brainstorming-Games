import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** Migration 0033: daily puzzles, streak freezes and profile pictures. */
let db: PGlite;
let player: string;
beforeAll(async () => {
  db = await createDb();
  player = await createUser(db, 'puzzler');
});

const call = <T>(sql: string, params: unknown[] = []) => as(db, 'authenticated', player, async (q) => (await q<{ r: T }>(sql, params))[0]!.r);
const complete = (kind: string, day: string) => call<{ streak: number; points: number; freezeUsed: boolean; first: boolean }>(`select public.complete_daily_puzzle($1, $2::date, 5) as r`, [kind, day]);
const day = (n: number) => (async () => (await db.query<{ d: string }>(`select (current_date + $1::int)::text as d`, [n])).rows[0]!.d)();

describe('daily puzzles', () => {
  it('gives points once a day and grows the streak', async () => {
    const r1 = await complete('word', await day(-1));
    expect(r1).toMatchObject({ streak: 1, points: 10, first: true });
    const r2 = await complete('word', await day(0));
    expect(r2).toMatchObject({ streak: 2, points: 11 });
    const again = await complete('word', await day(0));
    expect(again).toMatchObject({ streak: 2, points: 0, first: false });
  });

  it('keeps a separate streak for Sudoku and the Mini Crossword (migration 0035)', async () => {
    expect(await complete('sudoku', await day(0))).toMatchObject({ streak: 1, first: true });
    expect(await complete('crossword', await day(0))).toMatchObject({ streak: 1, first: true });
    await db.query(`update public.profiles set brain_points = brain_points + 100 where id = $1`, [player]);
    await call(`select public.buy_puzzle_hint('sudoku', current_date) as r`);
  });

  it('refuses days far from today and other puzzle kinds', async () => {
    await expect(complete('word', await day(-5))).rejects.toThrow(/invalid/);
    await expect(complete('chess', await day(0))).rejects.toThrow(/invalid/);
  });

  it('sells streak freezes for 60 points, 3 at most', async () => {
    await db.query(`update public.profiles set brain_points = 500 where id = $1`, [player]);
    expect(await call<number>(`select public.buy_streak_freeze() as r`)).toBe(1);
    expect((await db.query<{ p: number }>(`select brain_points as p from public.profiles where id = $1`, [player])).rows[0]!.p).toBe(440);
    await call(`select public.buy_streak_freeze() as r`);
    await call(`select public.buy_streak_freeze() as r`);
    await expect(call(`select public.buy_streak_freeze() as r`)).rejects.toThrow(/conflict/);
  });

  it('lets a freeze cover one missed day', async () => {
    await complete('path', await day(-1));
    // Pretend the last solve was two days ago.
    await db.query(`update public.daily_streaks set last_day = current_date - 2, streak = 4 where user_id = $1 and kind = 'path'`, [player]);
    await db.query(`delete from public.daily_puzzle_results where user_id = $1 and kind = 'path'`, [player]);
    const r = await complete('path', await day(0));
    expect(r).toMatchObject({ streak: 5, freezeUsed: true });
  });
});

describe('profile pictures', () => {
  it('wears a ready-made picture once owned, and an upload only from the player folder', async () => {
    await expect(call(`select public.equip_cosmetics('{"picture":"crown"}'::jsonb) as r`)).rejects.toThrow(/not_allowed/);
    await expect(call(`select public.equip_cosmetics('{"picture":"upload"}'::jsonb) as r`)).rejects.toThrow(/not_allowed/);
    await expect(call(`select public.set_avatar_upload('someone-else/p.webp') as r`)).rejects.toThrow(/invalid/);
    await db.query(`update public.profiles set is_minor = false where id = $1`, [player]);
    await call(`select public.set_avatar_upload($1) as r`, [`${player}/p-abc.webp`]);
    const r = await call<Record<string, string>>(`select public.equip_cosmetics('{"picture":"upload","pictureUrl":"https://evil.example/x.png"}'::jsonb) as r`);
    expect(r).toEqual({ picture: 'upload', pictureUrl: `avatars/${player}/p-abc.webp` });
  });

  it('keeps uploads away from children', async () => {
    const kid = await createUser(db, 'kid_player');
    await db.query(`update public.profiles set is_minor = true where id = $1`, [kid]);
    await expect(as(db, 'authenticated', kid, (q) => q(`select public.set_avatar_upload($1)`, [`${kid}/p-abc.webp`]))).rejects.toThrow(/not_allowed/);
  });
});
