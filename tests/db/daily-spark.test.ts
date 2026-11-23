import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** Migration 0029: the daily challenge falls back to Basic Launch games, after Full Launch ones. */
let db: PGlite;
let studio: string;
const game = async (slug: string, status: string) =>
  (await db.query<{ id: string }>(`insert into public.games (studio_id, slug, title, status, released_at) values ($1, $2, $2, $3, now()) returning id`, [studio, slug, status])).rows[0]!.id;
const daily = async () => (await as(db, 'anon', null, (q) => q<{ d: { gameId: string } | null }>(`select public.daily_challenge() as d`)))[0]!.d;

beforeAll(async () => {
  db = await createDb();
  const dev = await createUser(db, 'daily_dev');
  studio = await as(db, 'authenticated', dev, async (q) => (await q<{ id: string }>(`select public.create_studio('Daily', 'daily-studio', 'IN', 'd@example.test', 'v1', 'adult') as id`))[0]!.id);
});

describe('daily challenge', () => {
  it('picks a Basic Launch game when it is all there is', async () => {
    expect(await daily()).toBeNull();
    const spark = await game('only-spark', 'spark');
    expect((await daily())!.gameId).toBe(spark);
  });

  it('prefers a Full Launch game once there is one', async () => {
    const rise = await game('full-launch', 'rise');
    expect((await daily())!.gameId).toBe(rise);
  });
});
