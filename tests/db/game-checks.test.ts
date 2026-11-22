import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0024: asset fingerprints let the auto-review find art and audio reused from another studio. */
let db: PGlite;
let devA: string;
let devB: string;
let versionA: string;
let versionB: string;
const h = (n: number) => n.toString(16).padStart(32, '0');

beforeAll(async () => {
  db = await createDb();
  devA = await createUser(db, 'assets_a');
  devB = await createUser(db, 'assets_b');
  const mk = async (owner: string, slug: string, released: boolean) => {
    const studio = (await db.query<{ id: string }>(
      `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, $2, $2, 'IN', 'x@example.test') returning id`,
      [owner, slug],
    )).rows[0]!.id;
    const game = (await db.query<{ id: string }>(
      `insert into public.games (studio_id, slug, title, status, released_at) values ($1, $2, $2, $3, $4) returning id`,
      [studio, `${slug}-game`, released ? 'rise' : 'draft', released ? new Date().toISOString() : null],
    )).rows[0]!.id;
    return (await db.query<{ id: string }>(
      `insert into public.game_versions (game_id, version, storage_prefix) values ($1, '1', $2) returning id`,
      [game, `${game}/1`],
    )).rows[0]!.id;
  };
  versionA = await mk(devA, 'studio-a', true);
  versionB = await mk(devB, 'studio-b', false);
});

describe('asset fingerprints', () => {
  it('lets only the owner record them, once, in the right format', async () => {
    await expect(as(db, 'authenticated', devB, (q) => q(`select public.set_asset_hashes($1, $2)`, [versionA, [h(1)]]))).rejects.toThrow(/not_allowed/);
    await expect(as(db, 'authenticated', devA, (q) => q(`select public.set_asset_hashes($1, $2)`, [versionA, ['not-a-hash']]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', devA, (q) => q(`select public.set_asset_hashes($1, $2)`, [versionA, Array.from({ length: 20 }, (_, i) => h(i + 1))]));
    // A second call cannot replace them.
    await as(db, 'authenticated', devA, (q) => q(`select public.set_asset_hashes($1, $2)`, [versionA, [h(999)]]));
    expect((await db.query<{ n: number }>(`select cardinality(asset_hashes) as n from public.game_versions where id = $1`, [versionA])).rows[0]!.n).toBe(20);
  });

  it('reports another studio’s game that shares files', async () => {
    await as(db, 'authenticated', devB, (q) => q(`select public.set_asset_hashes($1, $2)`, [versionB, [...Array.from({ length: 15 }, (_, i) => h(i + 1)), h(500)]]));
    const [r] = await as(db, 'service_role', null, (q) => q<{ o: { count: number; overlaps: { title: string; shared: number }[] } }>(`select public.asset_overlaps($1) as o`, [versionB]));
    expect(r!.o.count).toBe(16);
    expect(r!.o.overlaps[0]).toMatchObject({ title: 'studio-a-game', shared: 15 });
    await expect(as(db, 'authenticated', devB, (q) => q(`select public.asset_overlaps($1)`, [versionB]))).rejects.toThrow(/not_allowed/);
  });
});
