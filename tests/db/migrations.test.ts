import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/**
 * Runs the real migrations in an in-memory Postgres (PGlite) and checks the security model and
 * the functions that untrusted clients call.
 */
let db: PGlite;
let dev: string;
let admin: string;
let player: string;
let gameId: string;
let versionId: string;

beforeAll(async () => {
  db = await createDb();
  dev = await createUser(db, 'dev_one');
  admin = await createUser(db, 'admin_one');
  player = await createUser(db, 'player_one');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
});

describe('schema', () => {
  it('enables row-level security on every public table', async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('seeds quests and exactly 30 cosmetics, and no games', async () => {
    const [{ n: cosmetics }] = (await db.query<{ n: number }>(`select count(*)::int as n from public.cosmetics`)).rows as [{ n: number }];
    const [{ n: games }] = (await db.query<{ n: number }>(`select count(*)::int as n from public.games`)).rows as [{ n: number }];
    const [{ n: quests }] = (await db.query<{ n: number }>(`select count(*)::int as n from public.quests`)).rows as [{ n: number }];
    expect(cosmetics).toBe(30);
    expect(games).toBe(0);
    expect(quests).toBeGreaterThanOrEqual(8);
  });

  it('keeps private tables out of reach of guests', async () => {
    for (const table of ['profiles', 'events', 'studio_payout_profiles', 'rate_limits', 'admin_audit_log', 'brain_point_ledger']) {
      await expect(as(db, 'anon', null, (q) => q(`select * from public.${table} limit 1`))).rejects.toThrow(/permission denied/);
    }
    // Public read models work for guests.
    await expect(as(db, 'anon', null, (q) => q(`select * from public.game_cards`))).resolves.toEqual([]);
  });

  it('does not let a guest call staff or service functions', async () => {
    await expect(as(db, 'anon', null, (q) => q(`select public.run_daily_jobs()`))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, 'authenticated', player, (q) => q(`select public.admin_set_site_config('home', '{}')`)),
    ).rejects.toThrow(/not_allowed/);
  });
});

describe('age gate', () => {
  it('treats anyone who could still be 17 as a minor with consent pending', async () => {
    const year = new Date().getUTCFullYear();
    const minor = await createUser(db, 'young_one', year - 15);
    const edge = await createUser(db, 'edge_one', year - 18);
    const { rows } = await db.query<{ username: string; is_minor: boolean; parental_consent_status: string }>(
      `select username, is_minor, parental_consent_status from public.profiles where id = any($1) order by username`,
      [[minor, edge, player]],
    );
    expect(rows).toEqual([
      { username: 'edge_one', is_minor: true, parental_consent_status: 'pending' },
      { username: 'player_one', is_minor: false, parental_consent_status: 'not_required' },
      { username: 'young_one', is_minor: true, parental_consent_status: 'pending' },
    ]);
    // A minor without consent cannot send friend requests.
    await expect(as(db, 'authenticated', minor, (q) => q(`select public.friend_request('player_one')`))).rejects.toThrow(
      /not_allowed/,
    );
  });
});

describe('developer flow', () => {
  it('goes from studio to Basic Launch through review only', async () => {
    const studio = await as(db, 'authenticated', dev, async (q) => {
      const [row] = await q<{ id: string }>(
        `select public.create_studio('Probe Studio', 'probe-studio', 'IN', 'dev@example.test', 'v1', 'adult') as id`,
      );
      return row!.id;
    });
    gameId = await as(db, 'authenticated', dev, async (q) => {
      const [row] = await q<{ id: string }>(
        `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls)
         values ($1, 'probe-quest', 'Probe Quest', 'A test', 'About', '{logic,fixture,puzzle}', '[{"action":"Move","keyboard":"Arrow keys","touch":"Swipe"}]')
         returning id`,
        [studio],
      );
      return row!.id;
    });

    // The developer cannot publish by editing the status column.
    await expect(
      as(db, 'authenticated', dev, (q) => q(`update public.games set status = 'rise' where id = $1`, [gameId])),
    ).rejects.toThrow(/permission denied/);

    versionId = await as(db, 'authenticated', dev, async (q) => {
      const [row] = await q<{ v: { version_id: string; preview_token: string } }>(
        `select public.add_game_version($1, '1', 3, 20000, 'index.html', true, false) as v`,
        [gameId],
      );
      await q(
        `insert into public.game_media (game_id, kind, url, widths, width, height) values
           ($1, 'cover_landscape', 'https://example.test/c-1920.webp', '{320,1920}', 1920, 1080),
           ($1, 'cover_portrait', 'https://example.test/p-800.webp', '{200,800}', 800, 1200),
           ($1, 'cover_square', 'https://example.test/s-800.webp', '{200,800}', 800, 800)`,
        [gameId],
      );
      return row!.v.version_id;
    });

    // Not submittable before pre-QA; the bot's report arrives with the service role.
    const declaration = JSON.stringify({ ownsRights: true, noCopies: true, credits: '' });
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.submit_for_review($1, $2)`, [gameId, declaration]))).rejects.toThrow(/invalid/);
    await as(db, 'service_role', null, (q) => q(`select public.set_pre_qa_report($1, '{"status":"pass","usesSdk":true}')`, [versionId]));
    // Still not: the landscape preview video is required, and so is the rights declaration.
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.submit_for_review($1, $2)`, [gameId, declaration]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', dev, (q) =>
      q(`insert into public.game_media (game_id, kind, url, widths, width, height) values ($1, 'preview_landscape', 'https://example.test/v.mp4', '{}', 1280, 720)`, [gameId]),
    );
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.submit_for_review($1, '{"ownsRights":false}')`, [gameId]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', dev, (q) => q(`select public.submit_for_review($1, $2)`, [gameId, declaration]));

    // A player cannot approve; an admin can.
    await expect(as(db, 'authenticated', player, (q) => q(`select public.qa_decide($1, 'approve')`, [versionId]))).rejects.toThrow(
      /not_allowed/,
    );
    await as(db, 'authenticated', admin, (q) => q(`select public.qa_decide($1, 'approve', '', '{}', true)`, [versionId]));

    const cards = await as(db, 'anon', null, (q) =>
      q<{ slug: string; status: string; school_safe: boolean; storage_prefix: string }>(
        `select slug, status, school_safe, storage_prefix from public.game_cards`,
      ),
    );
    expect(cards).toEqual([{ slug: 'probe-quest', status: 'spark', school_safe: true, storage_prefix: `${gameId}/1` }]);
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int as n from public.admin_audit_log`)).rows as [{ n: number }];
    expect(n).toBeGreaterThan(0);
  });

  it('finds the game through full-text search with prefix matching', async () => {
    const rows = await as(db, 'anon', null, (q) => q<{ slug: string }>(`select slug from public.search_games('prob')`));
    expect(rows.map((r) => r.slug)).toEqual(['probe-quest']);
  });
});

describe('player functions', () => {
  const anon = '11111111-1111-4111-8111-111111111111';

  it('counts one vote per voter and computes the Bayesian rating', async () => {
    const stats = await as(db, 'anon', null, async (q) => {
      await q(`select public.rate_game($1, 1, null, $2)`, [gameId, anon]);
      const [row] = await q<{ s: { likes: number; votes: number; rating10: number } }>(
        `select public.rate_game($1, 1, null, $2) as s`,
        [gameId, anon],
      );
      return row!.s;
    });
    expect(stats.likes).toBe(1);
    expect(stats.votes).toBe(1);
    // 10 * (20 * 0.7 + 1) / 21 = 7.1
    expect(Number(stats.rating10)).toBe(7.1);
  });

  it('rate limits a voter', async () => {
    const run = as(db, 'anon', null, async (q) => {
      for (let i = 0; i < 30; i++) await q(`select public.rate_game($1, 1, null, $2)`, [gameId, '22222222-2222-4222-8222-222222222222']);
    });
    await expect(run).rejects.toThrow(/rate_limited/);
  });

  it('ingests events, counts plays and rolls up KPIs', async () => {
    const session = '33333333-3333-4333-8333-333333333333';
    const events = [
      { type: 'play_click', session_id: session, game_id: gameId, version_id: versionId, ts: new Date().toISOString(), payload: {} },
      { type: 'gameplay_stop', session_id: session, game_id: gameId, ts: new Date().toISOString(), payload: { t: 95 } },
      { type: 'ad_started', session_id: session, game_id: gameId, ts: new Date().toISOString(), payload: {} },
      { type: 'not_a_type', game_id: gameId },
    ];
    const count = await as(db, 'authenticated', player, async (q) => {
      const [row] = await q<{ n: number }>(`select public.ingest_events($1, 'mobile', null, $2::jsonb, 'IN') as n`, [
        anon,
        JSON.stringify(events),
      ]);
      return row!.n;
    });
    expect(count).toBe(3);
    await as(db, 'service_role', null, (q) => q(`select public.refresh_daily_game_kpis(current_date)`));
    const { rows } = await db.query<{ plays: number; conversion_1min: string; ad_impressions: number; by: Record<string, number> }>(
      `select plays, conversion_1min, ad_impressions, ad_impressions_by_country as by from public.daily_game_kpis where game_id = $1`,
      [gameId],
    );
    expect(rows[0]).toMatchObject({ plays: 1, ad_impressions: 1, by: { IN: 1 } });
    expect(Number(rows[0]!.conversion_1min)).toBe(1);

    // The signed-in player's streak and quests moved because of the play.
    const { rows: profile } = await db.query<{ streak_days: number; brain_points: number }>(
      `select streak_days, brain_points from public.profiles where id = $1`,
      [player],
    );
    expect(profile[0]!.streak_days).toBe(1);
    const { rows: ledger } = await db.query<{ total: number }>(
      `select coalesce(sum(delta), 0)::int as total from public.brain_point_ledger where user_id = $1`,
      [player],
    );
    expect(ledger[0]!.total).toBe(profile[0]!.brain_points);
  });

  it('rejects scores that are faster than the declared maximum rate', async () => {
    await db.query(`update public.games set max_score_per_sec = 10 where id = $1`, [gameId]);
    const session = await as(db, 'authenticated', player, async (q) => {
      const [row] = await q<{ id: string }>(`select public.start_play_session($1, $2, null) as id`, [gameId, versionId]);
      return row!.id;
    });
    await expect(
      as(db, 'authenticated', player, (q) => q(`select public.submit_score($1, 'main', 100000, $2)`, [gameId, session])),
    ).rejects.toThrow(/invalid/);
    // A session that belongs to someone else is refused.
    await expect(
      as(db, 'authenticated', dev, (q) => q(`select public.submit_score($1, 'main', 1, $2)`, [gameId, session])),
    ).rejects.toThrow(/invalid/);
    const ok = await as(db, 'authenticated', player, async (q) => {
      const [row] = await q<{ r: { accepted: boolean } }>(`select public.submit_score($1, 'main', 5, $2) as r`, [gameId, session]);
      return row!.r;
    });
    expect(ok.accepted).toBe(true);
    const top = await as(db, 'anon', null, async (q) => {
      const [row] = await q<{ t: { entries: { name: string; score: number }[] } }>(`select public.leaderboard_top($1, 'main') as t`, [gameId]);
      return row!.t;
    });
    expect(top.entries).toEqual([expect.objectContaining({ name: 'player_one', score: 5 })]);
  });

  it('keeps cloud saves private to their owner', async () => {
    await as(db, 'authenticated', player, (q) =>
      q(`insert into public.cloud_saves (user_id, game_id, key, value) values ($1, $2, 'slot1', '{"level":3}')`, [player, gameId]),
    );
    const mine = await as(db, 'authenticated', player, (q) => q(`select key from public.cloud_saves`));
    const theirs = await as(db, 'authenticated', dev, (q) => q(`select key from public.cloud_saves`));
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
  });
});
