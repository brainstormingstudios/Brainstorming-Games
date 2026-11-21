import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0016: creator accounts, creator links on events, and creator revenue. */
let db: PGlite;
let creator: string;
let minor: string;
let admin: string;
let dev: string;
let gameId: string;
let creatorId: string;

beforeAll(async () => {
  db = await createDb();
  creator = await createUser(db, 'reel_maker');
  minor = await createUser(db, 'young_maker', new Date().getUTCFullYear() - 14);
  admin = await createUser(db, 'admin_three');
  dev = await createUser(db, 'studio_dev');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  const studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Clip Studio', 'clip-studio', 'IN', 'clip@example.test') returning id`,
    [dev],
  )).rows[0]!.id;
  gameId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls)
     values ($1, 'clip-game', 'Clip Game', 'A test', 'About', '{a,b,c}', '[]') returning id`,
    [studio],
  )).rows[0]!.id;
});

const apply = (user: string, handle: string) =>
  as(db, 'authenticated', user, (q) =>
    q<{ id: string; status: string }>(
      `select id, status from public.creator_apply($1, 'Reel Maker', '[{"kind":"youtube","url":"https://youtube.com/@reelmaker"}]', 'Short gaming videos for Indian players, 20k subscribers.', true)`,
      [handle],
    ),
  );

describe('creators', () => {
  it('lets adults apply with a unique handle, and not minors', async () => {
    const [row] = await apply(creator, 'reelmaker');
    expect(row!.status).toBe('pending');
    creatorId = row!.id;
    await expect(apply(minor, 'youngmaker')).rejects.toThrow(/not_allowed/);
    await expect(apply(dev, 'reelmaker')).rejects.toThrow(/conflict/);
    await expect(apply(creator, 'reelmaker')).rejects.toThrow(/conflict/);
    const [{ ok }] = (await as(db, 'anon', null, (q) => q<{ ok: boolean }>(`select public.creator_handle_available('reelmaker') as ok`))) as [{ ok: boolean }];
    expect(ok).toBe(false);
    // Creators see only their own row.
    expect(await as(db, 'authenticated', dev, (q) => q(`select * from public.creators`))).toHaveLength(0);
    expect(await as(db, 'authenticated', creator, (q) => q(`select * from public.creators`))).toHaveLength(1);
  });

  it('only staff approve, and approval queues an e-mail', async () => {
    await expect(as(db, 'authenticated', creator, (q) => q(`select public.admin_decide_creator($1, 'approve', '')`, [creatorId]))).rejects.toThrow(/not_allowed/);
    await as(db, 'authenticated', admin, (q) => q(`select public.admin_decide_creator($1, 'approve', '')`, [creatorId]));
    const { rows } = await db.query<{ status: string }>(`select status from public.creators where id = $1`, [creatorId]);
    expect(rows[0]!.status).toBe('approved');
    const mail = await db.query<{ template: string }>(`select template from public.email_outbox where template = 'creator_approved'`);
    expect(mail.rows).toHaveLength(1);
  });

  it('records the creator on events and credits ad impressions to the creator in the revenue inputs', async () => {
    const anon = '11111111-1111-4111-8111-111111111111';
    const month = new Date().toISOString().slice(0, 7);
    const events = JSON.stringify([
      { type: 'play_click', game_id: gameId, session_id: '22222222-2222-4222-8222-222222222222' },
      { type: 'ad_started', game_id: gameId, session_id: '22222222-2222-4222-8222-222222222222' },
      // Ad views only count in sessions with real play (at least 20 seconds).
      { type: 'session_end', game_id: gameId, session_id: '22222222-2222-4222-8222-222222222222', payload: { t: 45 } },
    ]);
    await as(db, 'anon', null, (q) => q(`select public.ingest_events($1, 'mobile', null, $2::jsonb, 'IN', 'ReelMaker')`, [anon, events]));
    // An impression from the studio's own referral link stays the studio's.
    await as(db, 'anon', null, (q) =>
      q(`select public.ingest_events($1, 'mobile', 'clip-studio', $2::jsonb, 'IN', 'reelmaker')`, [anon, JSON.stringify([{ type: 'ad_started', game_id: gameId }])]),
    );
    await db.query(`insert into public.daily_game_kpis (game_id, day, ad_impressions, ad_impressions_by_country) values ($1, current_date, 2, '{"IN":2}')`, [gameId]);

    const [stats] = (await as(db, 'authenticated', creator, (q) => q<{ s: { plays: number; adImpressions: number } }>(`select public.creator_stats(30) as s`))) as [{ s: { plays: number; adImpressions: number } }];
    expect(stats.s.plays).toBe(1);
    expect(stats.s.adImpressions).toBe(1);

    const [inputs] = (await as(db, 'authenticated', admin, (q) => q<{ i: { games: { creatorImpressions: Record<string, number> }[] } }>(`select public.admin_revenue_inputs($1) as i`, [month]))) as [
      { i: { games: { creatorImpressions: Record<string, number> }[] } },
    ];
    expect(inputs.i.games[0]!.creatorImpressions).toEqual({ [creatorId]: 1 });
  });

  it('writes creator statements and pays them once', async () => {
    const month = '2026-10';
    await as(db, 'authenticated', admin, (q) =>
      q(`select public.admin_write_creator_revenue($1, 'INR', $2::jsonb)`, [
        month,
        JSON.stringify([{ creatorId, earned: 2500, carryIn: 0, payoutDue: 2500, belowThreshold: false, games: [] }]),
      ]),
    );
    expect(await as(db, 'authenticated', creator, (q) => q(`select * from public.creator_months`))).toHaveLength(1);
    expect(await as(db, 'authenticated', dev, (q) => q(`select * from public.creator_months`))).toHaveLength(0);
    await as(db, 'authenticated', admin, (q) => q(`select public.admin_record_creator_payout($1, array[$2], 'bank', 'UTR123456')`, [creatorId, month]));
    await expect(as(db, 'authenticated', admin, (q) => q(`select public.admin_record_creator_payout($1, array[$2], 'bank', 'UTR123456')`, [creatorId, month]))).rejects.toThrow(/invalid/);
    // Payout details are never readable from the browser.
    await expect(as(db, 'authenticated', creator, (q) => q(`select * from public.creator_payout_profiles`))).rejects.toThrow(/permission denied/);
  });
});
