import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** Migration 0030: account and studio deletes, studio hand-over, play history, sign-in hand-over. */
let db: PGlite;
let admin: string;
let dev: string;
let other: string;
let studio: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, 'pf_admin');
  dev = await createUser(db, 'pf_dev');
  other = await createUser(db, 'pf_other');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  await db.query(`update auth.users set email = 'other@example.test' where id = $1`, [other]);
  studio = await as(db, 'authenticated', dev, async (q) => (await q<{ id: string }>(`select public.create_studio('PF', 'pf-studio', 'IN', 'p@example.test', 'v1', 'adult') as id`))[0]!.id);
});

const asAdmin = (sql: string, params: unknown[]) => as(db, 'authenticated', admin, (q) => q(sql, params));

describe('accounts and studios', () => {
  it('says an account owns a studio instead of failing on the link', async () => {
    await expect(asAdmin(`select public.admin_delete_user($1, 'spam account')`, [dev])).rejects.toThrow(/owns_studio/);
  });

  it('hands a studio to another account, admins only', async () => {
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.admin_transfer_studio($1, 'other@example.test')`, [studio]))).rejects.toThrow(/not_allowed/);
    await expect(asAdmin(`select public.admin_transfer_studio($1, 'nobody@example.test')`, [studio])).rejects.toThrow(/not_found/);
    await asAdmin(`select public.admin_transfer_studio($1, 'OTHER@example.test')`, [studio]);
    expect((await db.query<{ owner_id: string }>(`select owner_id from public.studios where id = $1`, [studio])).rows[0]!.owner_id).toBe(other);
    // The old owner no longer owns anything, so the account can go.
    await asAdmin(`select public.admin_delete_user($1, 'spam account')`, [dev]);
  });

  it('deletes a studio with its games, but never the house studio', async () => {
    await db.query(`insert into public.games (studio_id, slug, title) values ($1, 'pf-game', 'PF Game')`, [studio]);
    await asAdmin(`select public.admin_delete_studio($1, 'closing it down')`, [studio]);
    expect((await db.query(`select 1 from public.games where slug = 'pf-game'`)).rows).toHaveLength(0);
    const house = (await db.query<{ id: string }>(`insert into public.studios (owner_id, slug, name, is_first_party) values ($1, 'house-pf', 'House', true) returning id`, [admin])).rows[0]!.id;
    await expect(asAdmin(`select public.admin_delete_studio($1, 'closing it down')`, [house])).rejects.toThrow(/invalid/);
  });
});

describe('play history', () => {
  it('lets players clear their own history', async () => {
    await as(db, 'authenticated', other, (q) => q(`delete from public.play_history where user_id = $1`, [other]));
  });
});

describe('sign-in hand-over', () => {
  it('makes a single-use code that only the server can spend, once, for its site', async () => {
    const code = (await as(db, 'authenticated', other, (q) => q<{ code: string }>(`select public.create_signin_handover('https://brainstorming-games-dev.pages.dev') as code`)))[0]!.code;
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    await expect(as(db, 'authenticated', other, (q) => q(`select public.redeem_signin_handover($1, 'https://brainstorming-games-dev.pages.dev')`, [code]))).rejects.toThrow(/permission denied|not_allowed/);
    const spend = (origin: string) => as(db, 'service_role', null, async (q) => (await q<{ u: string }>(`select public.redeem_signin_handover($1, $2) as u`, [code, origin]))[0]!.u);
    await expect(spend('https://evil.example')).rejects.toThrow(/invalid/);
    expect(await spend('https://brainstorming-games-dev.pages.dev')).toBe(other);
    await expect(spend('https://brainstorming-games-dev.pages.dev')).rejects.toThrow(/invalid/);
  });

  it('refuses visitors who are not signed in and odd targets', async () => {
    await expect(as(db, 'anon', null, (q) => q(`select public.create_signin_handover('https://x.example')`))).rejects.toThrow();
    await expect(as(db, 'authenticated', other, (q) => q(`select public.create_signin_handover('javascript:alert(1)')`))).rejects.toThrow(/invalid/);
  });
});
