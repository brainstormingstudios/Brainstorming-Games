import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0019: the 72-hour review promise and free Boost credits; jam prizes. */
let db: PGlite;
let dev: string;
let other: string;
let gameId: string;
let versionId: string;

beforeAll(async () => {
  db = await createDb();
  dev = await createUser(db, 'perk_dev');
  other = await createUser(db, 'other_dev');
  const studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Perk Studio', 'perk-studio', 'IN', 'p@example.test') returning id`,
    [dev],
  )).rows[0]!.id;
  gameId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls, status, released_at)
     values ($1, 'perk-game', 'Perk Game', 'A test', 'About', '{a,b,c}', '[]', 'rise', now()) returning id`,
    [studio],
  )).rows[0]!.id;
  versionId = (await db.query<{ id: string }>(
    `insert into public.game_versions (game_id, version, storage_prefix, entry_file, total_bytes, qa_status) values ($1, '2', 'x/2', 'index.html', 1000, 'pre_qa_passed') returning id`,
    [gameId],
  )).rows[0]!.id;
});

describe('developer perks', () => {
  it('times reviews from submission, and a late review earns one free Boost credit', async () => {
    await db.query(`update public.game_versions set qa_status = 'in_review' where id = $1`, [versionId]);
    const [v] = (await db.query<{ submitted_at: string | null }>(`select submitted_at from public.game_versions where id = $1`, [versionId])).rows;
    expect(v!.submitted_at).not.toBeNull();
    // Pretend it waited 4 days, then the daily job runs: the credit arrives before the decision.
    await db.query(`update public.game_versions set submitted_at = now() - interval '4 days' where id = $1`, [versionId]);
    const [{ n }] = (await db.query<{ n: number }>(`select app.grant_overdue_review_credits() as n`)).rows as [{ n: number }];
    expect(n).toBe(1);
    // Deciding late does not give a second credit for the same version.
    await db.query(`update public.game_versions set qa_status = 'approved' where id = $1`, [versionId]);
    const [{ c }] = (await db.query<{ c: number }>(`select count(*)::int as c from public.boost_credits`)).rows as [{ c: number }];
    expect(c).toBe(1);
    const [{ k }] = (await as(db, 'authenticated', dev, (q) => q<{ k: number }>(`select public.my_boost_credits() as k`))) as [{ k: number }];
    expect(k).toBe(1);
  });

  it('turns a credit into a free Spotlight Boost, only for the owner and only once', async () => {
    await expect(as(db, 'authenticated', other, (q) => q(`select public.redeem_boost_credit($1)`, [gameId]))).rejects.toThrow(/not_allowed/);
    await as(db, 'authenticated', dev, (q) => q(`select public.redeem_boost_credit($1)`, [gameId]));
    const [b] = (await db.query<{ package: string; amount_paise: number; status: string }>(`select package, amount_paise, status from public.boosts where game_id = $1`, [gameId])).rows;
    expect(b).toEqual({ package: 'spotlight', amount_paise: 0, status: 'paid' });
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.redeem_boost_credit($1)`, [gameId]))).rejects.toThrow(/conflict|not_found/);
  });

  it('keeps jam prizes as a short list and sponsor links as https', async () => {
    await db.query(
      `insert into public.jams (slug, title, starts_at, ends_at, sponsor_name, sponsor_url, prizes) values ('nov-jam', 'November Jam', now(), now() + interval '30 days', 'Acme', 'https://acme.example', '[{"rank":1,"prize":"₹10,000"}]')`,
    );
    await expect(db.query(`update public.jams set sponsor_url = 'javascript:alert(1)' where slug = 'nov-jam'`)).rejects.toThrow(/check/);
  });
});
