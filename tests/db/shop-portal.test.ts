import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** Migration 0034: mail timer token, puzzle hints, ad settings, pages, admin player tools. */
let db: PGlite;
let admin: string;
let player: string;
beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, 'sp_admin');
  player = await createUser(db, 'sp_player');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
});
const asAdmin = (sql: string, params: unknown[] = []) => as(db, 'authenticated', admin, (q) => q(sql, params));
const asPlayer = (sql: string, params: unknown[] = []) => as(db, 'authenticated', player, (q) => q(sql, params));

describe('mail timer', () => {
  it('keeps its token inside the database: only the server can check it', async () => {
    await expect(asPlayer(`select public.check_internal_token('mail_cron', 'guess')`)).rejects.toThrow(/permission denied|not_allowed/);
    const ok = await as(db, 'service_role', null, async (q) => (await q<{ r: boolean }>(`select public.check_internal_token('mail_cron', 'guess') as r`))[0]!.r);
    expect(ok).toBe(false);
  });
});

describe('puzzle hints', () => {
  it('costs 30 points, three a puzzle a day', async () => {
    await db.query(`update public.profiles set brain_points = 100 where id = $1`, [player]);
    for (let i = 1; i <= 3; i++) {
      const [r] = await asPlayer(`select public.buy_puzzle_hint('word', current_date) as n`);
      expect((r as { n: number }).n).toBe(i);
      if (i === 3) break;
    }
    await expect(asPlayer(`select public.buy_puzzle_hint('word', current_date)`)).rejects.toThrow(/conflict|insufficient_points/);
    expect((await db.query<{ p: number }>(`select brain_points as p from public.profiles where id = $1`, [player])).rows[0]!.p).toBe(10);
  });
});

describe('admin tools', () => {
  it('lets only admins change ads, pages, points and plans', async () => {
    await expect(asPlayer(`select public.admin_save_ad_settings('{}'::jsonb, '[]'::jsonb)`)).rejects.toThrow(/not_allowed/);
    await expect(asPlayer(`select public.admin_adjust_points($1, 50, 'gift')`, [player])).rejects.toThrow(/not_allowed/);
    await expect(asPlayer(`select public.admin_set_premium($1, 'max', 30)`, [player])).rejects.toThrow(/not_allowed/);
    await expect(asPlayer(`insert into public.site_pages (slug, title) values ('hack', 'Hack')`)).rejects.toThrow();

    await asAdmin(`select public.admin_adjust_points($1, 50, 'contest prize')`, [player]);
    await asAdmin(`select public.admin_set_premium($1, 'plus', 7)`, [player]);
    const [p] = (await db.query<{ plan: string; bp: number }>(`select premium_plan as plan, brain_points as bp from public.profiles where id = $1`, [player])).rows;
    expect(p).toMatchObject({ plan: 'plus', bp: 60 });
  });

  it('only accepts ads with https links and media from our own storage', async () => {
    const bad = JSON.stringify([{ href: 'javascript:alert(1)', media: '/promo/x.mp4' }]);
    await expect(asAdmin(`select public.admin_save_ad_settings('{}'::jsonb, $1::jsonb)`, [bad])).rejects.toThrow(/invalid/);
    const elsewhere = JSON.stringify([{ href: 'https://example.com', media: 'https://evil.example/ad.mp4' }]);
    await expect(asAdmin(`select public.admin_save_ad_settings('{}'::jsonb, $1::jsonb)`, [elsewhere])).rejects.toThrow(/invalid/);
    const good = JSON.stringify([{ href: 'https://example.com', media: '/promo/bs-ad-16x9.mp4' }]);
    await asAdmin(`select public.admin_save_ad_settings('{"grid": false}'::jsonb, $1::jsonb)`, [good]);
    const rows = await as(db, 'anon', null, (q) => q<{ placements: Record<string, boolean> }>(`select placements from public.ad_settings`));
    expect(rows[0]!.placements).toEqual({ grid: false });
  });

  it('shows visitors only published pages', async () => {
    await asAdmin(`insert into public.site_pages (slug, title, body_md, published) values ('rules', 'Rules', 'Be kind', true), ('secret', 'Draft', 'x', false)`);
    const seen = await as(db, 'anon', null, (q) => q<{ slug: string }>(`select slug from public.site_pages order by slug`));
    expect(seen.map((r) => r.slug)).toEqual(['rules']);
  });
});
