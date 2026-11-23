import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** Migration 0027: founding and paid Verified ticks, the monthly Boost, and BS Originals approved automatically. */
let db: PGlite;

beforeAll(async () => {
  db = await createDb();
});

const newStudio = async (username: string, slug: string) => {
  const user = await createUser(db, username);
  const id = await as(db, 'authenticated', user, async (q) => {
    const [row] = await q<{ id: string }>(`select public.create_studio($1, $2, 'IN', 'dev@example.test', 'v1', 'adult') as id`, [slug, slug]);
    return row!.id;
  });
  return { user, id };
};
const studio = async (id: string) =>
  (await db.query<{ verified: boolean; verified_source: string | null; founding_number: number | null; until_days: number | null; is_first_party: boolean }>(
    `select verified, verified_source, founding_number, is_first_party,
       round(extract(epoch from (verified_until - now())) / 86400)::int as until_days from public.studios where id = $1`,
    [id],
  )).rows[0]!;

describe('founding studios', () => {
  it('gives the first studios the tick free for a year, numbered in order', async () => {
    const a = await newStudio('found_a', 'found-a');
    const b = await newStudio('found_b', 'found-b');
    expect(await studio(a.id)).toMatchObject({ verified: true, verified_source: 'founding', founding_number: 1, until_days: 365 });
    expect((await studio(b.id)).founding_number).toBe(2);
  });

  it('stops after 100 studios', async () => {
    await db.query(`update public.studios set founding_number = 100 where slug = 'found-b'`);
    const late = await newStudio('found_late', 'found-late');
    expect(await studio(late.id)).toMatchObject({ verified: false, founding_number: null, verified_source: null });
  });

  it('shows the developer their own tick', async () => {
    const owner = (await db.query<{ owner_id: string }>(`select owner_id from public.studios where slug = 'found-a'`)).rows[0]!.owner_id;
    const [row] = await as(db, 'authenticated', owner, (q) => q<{ v: { verified: boolean; source: string; foundingNumber: number } }>(`select public.my_verified() as v`));
    expect(row!.v).toMatchObject({ verified: true, source: 'founding', foundingNumber: 1 });
  });
});

describe('paid tick and daily job', () => {
  it('extends from the later of now and the current end, server only', async () => {
    const s = await newStudio('paid_dev', 'paid-dev');
    await expect(as(db, 'authenticated', s.user, (q) => q(`select public.extend_verified($1, 30)`, [s.id]))).rejects.toThrow(/permission denied|not_allowed/);
    await as(db, 'service_role', null, (q) => q(`select public.extend_verified($1, 365)`, [s.id]));
    expect(await studio(s.id)).toMatchObject({ verified: true, verified_source: 'paid', until_days: 365 });
    await as(db, 'service_role', null, (q) => q(`select public.extend_verified($1, 30)`, [s.id]));
    expect((await studio(s.id)).until_days).toBe(395);
    await expect(as(db, 'service_role', null, (q) => q(`select public.extend_verified($1, 7)`, [s.id]))).rejects.toThrow(/invalid/);
  });

  it('ends expired ticks and gives verified studios one free Boost a month', async () => {
    const s = await newStudio('expire_dev', 'expire-dev');
    await as(db, 'service_role', null, (q) => q(`select public.extend_verified($1, 30)`, [s.id]));
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from public.boost_credits where studio_id = $1`, [s.id])).rows[0]!.n;
    await db.query(`select app.verified_daily()`);
    await db.query(`select app.verified_daily()`);
    const after = (await db.query<{ n: number }>(`select count(*)::int as n from public.boost_credits where studio_id = $1 and reason = 'verified_monthly'`, [s.id])).rows[0]!.n;
    expect(before).toBe(0);
    expect(after).toBe(1);
    await db.query(`update public.studios set verified_until = now() - interval '1 day' where id = $1`, [s.id]);
    await db.query(`select app.verified_daily()`);
    expect((await studio(s.id)).verified).toBe(false);
  });

  it('promises a review within 24 hours to verified studios, 72 to others', async () => {
    const sla = (slug: string) =>
      db.query<{ h: number }>(
        `select app.review_sla_hours(v.id) as h from public.game_versions v join public.games g on g.id = v.game_id join public.studios s on s.id = g.studio_id where s.slug = $1 limit 1`,
        [slug],
      );
    for (const slug of ['found-a', 'found-late']) {
      const owner = (await db.query<{ id: string }>(`select owner_id as id from public.studios where slug = $1`, [slug])).rows[0]!.id;
      await as(db, 'authenticated', owner, async (q) => {
        const [g] = await q<{ id: string }>(`insert into public.games (studio_id, slug, title) select id, $2, $2 from public.studios where slug = $1 returning id`, [slug, `${slug}-game`]);
        await q(`select public.add_game_version($1, '1', 1, 100, 'index.html', true, false)`, [g!.id]);
      });
    }
    expect((await sla('found-a')).rows[0]!.h).toBe(24);
    expect((await sla('found-late')).rows[0]!.h).toBe(72);
  });
});

describe('BS Originals', () => {
  it('publishes a submitted house-studio game once its test-play is clean, and only then', async () => {
    const house = await newStudio('house_dev', 'house-dev');
    await db.query(`update public.studios set is_first_party = true where id = $1`, [house.id]);
    const make = (slug: string) =>
      as(db, 'authenticated', house.user, async (q) => {
        const [g] = await q<{ id: string }>(`insert into public.games (studio_id, slug, title) values ($1, $2, $2) returning id`, [house.id, slug]);
        const [v] = await q<{ v: { version_id: string } }>(`select public.add_game_version($1, '1', 1, 100, 'index.html', true, false) as v`, [g!.id]);
        return { gameId: g!.id, versionId: v!.v.version_id };
      });
    const report = (versionId: string, status: string) =>
      as(db, 'service_role', null, async (q) => (await q<{ r: string }>(`select public.set_pre_qa_report($1, $2::jsonb) as r`, [versionId, JSON.stringify({ status, checks: [] })]))[0]!.r);

    const clean = await make('house-clean');
    await db.query(`update public.game_versions set qa_status = 'in_review' where id = $1`, [clean.versionId]);
    expect(await report(clean.versionId, 'warn')).toBe('approved');
    const game = (await db.query<{ status: string; released: boolean }>(`select status, released_at is not null as released from public.games where id = $1`, [clean.gameId])).rows[0]!;
    expect(game).toEqual({ status: 'spark', released: true });
    const [review] = (await db.query<{ action: string; reviewer_id: string | null; checklist: { automatic?: boolean } }>(`select action, reviewer_id, checklist from public.qa_reviews where version_id = $1`, [clean.versionId])).rows;
    expect(review).toMatchObject({ action: 'approve', reviewer_id: null, checklist: { automatic: true } });

    // A failed test-play waits for a person; so does a game from any other studio.
    const failed = await make('house-failed');
    await db.query(`update public.game_versions set qa_status = 'in_review' where id = $1`, [failed.versionId]);
    expect(await report(failed.versionId, 'fail')).toBe('in_review');
    const other = (await db.query<{ id: string }>(`select v.id from public.game_versions v join public.games g on g.id = v.game_id where g.slug = 'found-a-game'`)).rows[0]!.id;
    await db.query(`update public.game_versions set qa_status = 'in_review' where id = $1`, [other]);
    expect(await report(other, 'pass')).toBe('in_review');
  });
});
