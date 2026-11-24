import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/**
 * Favourites: players may add and remove them but not update them, so the site saves with
 * "insert unless it is there" (what supabase-js sends for upsert with ignoreDuplicates). A plain
 * upsert (ON CONFLICT DO UPDATE) needs update rights and was refused, breaking the heart button.
 */
let db: PGlite;
let player: string;
let game: string;

beforeAll(async () => {
  db = await createDb();
  player = await createUser(db, 'fav_player');
  const dev = await createUser(db, 'fav_dev');
  const studio = await as(db, 'authenticated', dev, async (q) => (await q<{ id: string }>(`select public.create_studio('Fav', 'fav-studio', 'IN', 'f@example.test', 'v1', 'adult') as id`))[0]!.id);
  game = (await db.query<{ id: string }>(`insert into public.games (studio_id, slug, title, status, released_at) values ($1, 'fav-game', 'Fav', 'spark', now()) returning id`, [studio])).rows[0]!.id;
});

const save = () => as(db, 'authenticated', player, (q) => q(`insert into public.favorites (user_id, game_id) values ($1, $2) on conflict (user_id, game_id) do nothing`, [player, game]));
const count = async () => (await as(db, 'authenticated', player, (q) => q(`select 1 from public.favorites where game_id = $1`, [game]))).length;

describe('favourites', () => {
  it('saves a game, and saving it again is harmless', async () => {
    await save();
    await save();
    expect(await count()).toBe(1);
  });

  it('refuses the old update-style save, which needs rights players do not have', async () => {
    await expect(
      as(db, 'authenticated', player, (q) => q(`insert into public.favorites (user_id, game_id) values ($1, $2) on conflict (user_id, game_id) do update set game_id = excluded.game_id`, [player, game])),
    ).rejects.toThrow(/permission denied/);
  });

  it('removes a favourite', async () => {
    await as(db, 'authenticated', player, (q) => q(`delete from public.favorites where game_id = $1`, [game]));
    expect(await count()).toBe(0);
  });
});
