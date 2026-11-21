import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0018: Early Access credits, Rising chart, daily challenge, points for Premium days. */
let db: PGlite;
let tester: string;
let gameId: string;

beforeAll(async () => {
  db = await createDb();
  tester = await createUser(db, 'early_bird');
  const dev = await createUser(db, 'rise_dev');
  await db.query(`update public.profiles set playtest_opt_in = true where id = $1`, [tester]);
  const studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Rise Studio', 'rise-studio', 'IN', 'r@example.test') returning id`,
    [dev],
  )).rows[0]!.id;
  gameId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls, status, released_at)
     values ($1, 'rise-game', 'Rise Game', 'A test', 'About', '{a,b,c}', '[]', 'spark', now()) returning id`,
    [studio],
  )).rows[0]!.id;
  await db.query(`insert into public.leaderboards (game_id, key) values ($1, 'main')`, [gameId]);
});

describe('discover', () => {
  it('credits Early Access testers when the game reaches Full Launch', async () => {
    await as(db, 'authenticated', tester, (q) => q(`select public.submit_playtest($1, 5, 4, true)`, [gameId]));
    const before = (await db.query<{ brain_points: number }>(`select brain_points from public.profiles where id = $1`, [tester])).rows[0]!.brain_points;
    // Not credited (and not listed) while still in Basic Launch.
    const [early] = (await as(db, 'anon', null, (q) => q<{ d: unknown }>(`select public.game_discoverers($1) as d`, [gameId]))) as [{ d: unknown }];
    expect(early.d).toBeNull();
    await db.query(`update public.games set status = 'rise' where id = $1`, [gameId]);
    const after = (await db.query<{ brain_points: number }>(`select brain_points from public.profiles where id = $1`, [tester])).rows[0]!.brain_points;
    expect(after - before).toBe(50);
    const [d] = (await as(db, 'anon', null, (q) => q<{ d: { total: number; names: string[] } }>(`select public.game_discoverers($1) as d`, [gameId]))) as [{ d: { total: number; names: string[] } }];
    expect(d.d).toEqual({ total: 1, names: ['early_bird'] });
    const [mine] = (await as(db, 'authenticated', tester, (q) => q<{ m: { slug: string }[] }>(`select public.my_discoveries() as m`))) as [{ m: { slug: string }[] }];
    expect(mine.m.map((x) => x.slug)).toEqual(['rise-game']);
  });

  it('ranks the Rising chart only from 3 answers and picks one daily game with its leaderboard', async () => {
    const [r1] = (await as(db, 'anon', null, (q) => q<{ r: unknown[] }>(`select public.rising_games(10) as r`))) as [{ r: unknown[] }];
    expect(r1.r).toEqual([]);
    for (const name of ['tester_two', 'tester_three']) {
      const u = await createUser(db, name);
      await db.query(`insert into public.playtest_responses (game_id, user_id, fun, clarity, play_again) values ($1, $2, 4, 4, true)`, [gameId, u]);
    }
    const [r2] = (await as(db, 'anon', null, (q) => q<{ r: { gameId: string; answers: number }[] }>(`select public.rising_games(10) as r`))) as [{ r: { gameId: string; answers: number }[] }];
    expect(r2.r[0]).toMatchObject({ gameId, answers: 3 });
    const [daily] = (await as(db, 'anon', null, (q) => q<{ d: { gameId: string; board: string } }>(`select public.daily_challenge() as d`))) as [{ d: { gameId: string; board: string } }];
    expect(daily.d).toMatchObject({ gameId, board: 'main' });
  });

  it('swaps points for Premium days, within the monthly limit and never twice for the same points', async () => {
    await db.query(`update public.profiles set brain_points = 3000 where id = $1`, [tester]);
    const [r] = (await as(db, 'authenticated', tester, (q) => q<{ r: { plan: string } }>(`select public.redeem_points('plus_7d') as r`))) as [{ r: { plan: string } }];
    expect(r.r.plan).toBe('plus');
    const p = (await db.query<{ brain_points: number; premium_plan: string }>(`select brain_points, premium_plan from public.profiles where id = $1`, [tester])).rows[0]!;
    expect(p).toEqual({ brain_points: 600, premium_plan: 'plus' });
    await expect(as(db, 'authenticated', tester, (q) => q(`select public.redeem_points('plus_7d')`))).rejects.toThrow(/insufficient_points/);
    await db.query(`update public.profiles set brain_points = 99999 where id = $1`, [tester]);
    await expect(as(db, 'authenticated', tester, (q) => q(`select public.redeem_points('max_1d')`))).rejects.toThrow(/other_plan/);
    await as(db, 'authenticated', tester, (q) => q(`select public.redeem_points('plus_1d')`));
    await expect(as(db, 'authenticated', tester, (q) => q(`select public.redeem_points('plus_7d')`))).rejects.toThrow(/monthly_limit/);
    const [{ n }] = (await as(db, 'authenticated', tester, (q) => q<{ n: number }>(`select public.point_days_this_month() as n`))) as [{ n: number }];
    expect(n).toBe(8);
  });
});
