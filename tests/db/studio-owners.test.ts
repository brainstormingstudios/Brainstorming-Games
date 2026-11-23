import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** Migration 0028: studio co-owners manage the studio like its main owner, except payouts. */
let db: PGlite;
let owner: string;
let partner: string;
let stranger: string;
let admin: string;
let studio: string;

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, 'main_owner');
  partner = await createUser(db, 'co_owner');
  stranger = await createUser(db, 'stranger');
  admin = await createUser(db, 'site_admin');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  await db.query(`update auth.users set email = 'kunj@example.test' where id = $1`, [partner]);
  studio = await as(db, 'authenticated', owner, async (q) => {
    const [row] = await q<{ id: string }>(`select public.create_studio('House', 'house-studio', 'IN', 'a@example.test', 'v1', 'adult') as id`);
    return row!.id;
  });
});

const add = (user: string, email: string) => as(db, 'authenticated', user, (q) => q(`select public.admin_add_studio_owner($1, $2)`, [studio, email]));

describe('studio co-owners', () => {
  it('can only be added by an admin, by e-mail', async () => {
    await expect(add(owner, 'kunj@example.test')).rejects.toThrow(/not_allowed/);
    await expect(add(admin, 'nobody@example.test')).rejects.toThrow(/not_found/);
    await add(admin, 'KUNJ@example.test');
    const [note] = (await db.query<{ title: string }>(`select title from public.notifications where user_id = $1`, [partner])).rows;
    expect(note!.title).toBe('You are now a studio owner');
  });

  it('lets a co-owner find, edit and publish for the studio', async () => {
    const [mine] = await as(db, 'authenticated', partner, (q) => q<{ id: string }>(`select public.my_studio_id() as id`));
    expect(mine!.id).toBe(studio);
    await as(db, 'authenticated', partner, (q) => q(`update public.studios set bio = 'Founders' where id = $1`, [studio]));
    expect((await db.query<{ bio: string }>(`select bio from public.studios where id = $1`, [studio])).rows[0]!.bio).toBe('Founders');
    const game = await as(db, 'authenticated', partner, async (q) => {
      const [g] = await q<{ id: string }>(`insert into public.games (studio_id, slug, title) values ($1, 'co-game', 'Co Game') returning id`, [studio]);
      await q(`select public.add_game_version($1, '1', 1, 100, 'index.html', true, false)`, [g!.id]);
      return g!.id;
    });
    // The main owner sees the co-owner's game too.
    const rows = await as(db, 'authenticated', owner, (q) => q(`select id from public.games where id = $1`, [game]));
    expect(rows).toHaveLength(1);
  });

  it('keeps everyone else out, and one studio per person', async () => {
    await expect(as(db, 'authenticated', stranger, (q) => q(`update public.studios set bio = 'x' where id = $1 returning id`, [studio]))).resolves.toEqual([]);
    const [none] = await as(db, 'authenticated', stranger, (q) => q<{ id: string | null }>(`select public.my_studio_id() as id`));
    expect(none!.id).toBeNull();
    await expect(
      as(db, 'authenticated', partner, (q) => q(`select public.create_studio('Second', 'second-studio', 'IN', 'b@example.test', 'v1', 'adult')`)),
    ).rejects.toThrow(/conflict/);
    // The main owner cannot be changed through an update.
    await expect(as(db, 'authenticated', partner, (q) => q(`update public.studios set owner_id = $2 where id = $1`, [studio, partner]))).rejects.toThrow(/permission denied/);
  });
});
