import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankScore, type RankInputs } from '@/lib/domain/ranking';
import { as, createDb, createUser } from './harness';

/** The discovery migration (0011): the SQL score matches the TypeScript one, and the staff-only stats stay staff-only. */
let db: PGlite;
let admin: string;
let player: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, 'admin_two');
  player = await createUser(db, 'player_two');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
});

describe('discovery', () => {
  const cases: RankInputs[] = [
    { impressions: 0, clicks: 0, plays: 0, conversion: null, avgSessionSec: null, d1: null, likes: 0, dislikes: 0, ageDays: 0 },
    { impressions: 5000, clicks: 700, plays: 600, conversion: 0.8, avgSessionSec: 540, d1: 0.14, likes: 80, dislikes: 10, ageDays: 30 },
    { impressions: 4, clicks: 3, plays: 2, conversion: 1, avgSessionSec: 30, d1: null, likes: 1, dislikes: 0, ageDays: 3 },
    { impressions: 300, clicks: 900, plays: 50, conversion: 0.2, avgSessionSec: 4000, d1: 0.9, likes: 0, dislikes: 12, ageDays: 200 },
  ];

  it('scores games in SQL exactly as the site does in TypeScript', async () => {
    for (const c of cases) {
      const { rows } = await db.query<{ score: string }>(
        `select app.rank_score($1::bigint, $2::bigint, $3::bigint, $4::numeric, $5::numeric, $6::numeric, $7::int, $8::int, $9::numeric) as score`,
        [c.impressions, c.clicks, c.plays, c.conversion, c.avgSessionSec, c.d1, c.likes, c.dislikes, c.ageDays],
      );
      expect(Number(rows[0]!.score), JSON.stringify(c)).toBeCloseTo(rankScore(c), 1);
    }
  });

  it('lets guests record tile hits but not read them', async () => {
    await expect(
      as(db, 'anon', null, (q) => q(`select public.record_tile_hits(gen_random_uuid(), '[{"gameId":"00000000-0000-0000-0000-000000000000","impressions":1,"clicks":0}]')`)),
    ).resolves.toBeDefined();
    await expect(as(db, 'anon', null, (q) => q(`select * from public.game_impressions`))).rejects.toThrow(/permission denied/);
  });

  it('keeps site and database statistics for staff', async () => {
    await expect(as(db, 'authenticated', player, (q) => q(`select public.admin_db_stats()`))).rejects.toThrow(/not_allowed/);
    await expect(as(db, 'authenticated', player, (q) => q(`select public.admin_site_stats()`))).rejects.toThrow(/not_allowed/);
    const [db1] = await as(db, 'authenticated', admin, (q) => q<{ s: { tables: { name: string }[]; total_bytes: number } }>(`select public.admin_db_stats() as s`));
    expect(db1!.s.tables.map((t) => t.name)).toContain('game_impressions');
    expect(db1!.s.total_bytes).toBeGreaterThan(0);
    const [site] = await as(db, 'authenticated', admin, (q) => q<{ s: { by_day: unknown[]; plays_7d: number } }>(`select public.admin_site_stats() as s`));
    expect(site!.s.by_day).toHaveLength(30);
    await expect(as(db, 'authenticated', admin, (q) => q(`select public.refresh_rank_scores()`))).resolves.toBeDefined();
  });

  it('refuses an admin whose session has not passed the owner code', async () => {
    // Same admin, same role: only the second factor is missing (a stolen password or magic link).
    await expect(as(db, 'authenticated', admin, (q) => q(`select public.admin_db_stats()`), 'aal1')).rejects.toThrow(/not_allowed/);
    await expect(as(db, 'authenticated', admin, (q) => q(`select public.admin_set_site_config('home', '{}')`), 'aal1')).rejects.toThrow(/not_allowed/);
    const reports = await as(db, 'authenticated', admin, (q) => q(`select * from public.reports`), 'aal1');
    expect(reports).toEqual([]);
  });
});
