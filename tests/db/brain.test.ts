import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0017: skill tags, play rows for the Brain Profile, and the weekly report. */
let db: PGlite;
let player: string;
let gameId: string;
const session = '33333333-3333-4333-8333-333333333333';
const anon = '44444444-4444-4444-8444-444444444444';

beforeAll(async () => {
  db = await createDb();
  player = await createUser(db, 'brainy_one');
  const dev = await createUser(db, 'brain_dev');
  const studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Brain Studio', 'brain-studio', 'IN', 'b@example.test') returning id`,
    [dev],
  )).rows[0]!.id;
  gameId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls, skills)
     values ($1, 'brain-game', 'Brain Game', 'A test', 'About', '{a,b,c}', '[]', '{logic,memory}') returning id`,
    [studio],
  )).rows[0]!.id;
});

describe('brain profile', () => {
  it('only accepts known skills, at most three', async () => {
    await expect(db.query(`update public.games set skills = '{logic,cooking}' where id = $1`, [gameId])).rejects.toThrow(/check/);
    await expect(db.query(`update public.games set skills = '{logic,memory,speed,focus}' where id = $1`, [gameId])).rejects.toThrow(/check/);
  });

  it('returns the caller’s play time per game and day with the game’s skills', async () => {
    const events = JSON.stringify([
      { type: 'play_click', game_id: gameId, session_id: session },
      { type: 'gameplay_stop', game_id: gameId, session_id: session, payload: { t: 300 } },
      { type: 'session_end', game_id: gameId, session_id: session, payload: { t: 600 } },
    ]);
    await as(db, 'authenticated', player, (q) => q(`select public.ingest_events($1, 'mobile', null, $2::jsonb, 'IN', null)`, [anon, events]));
    const [mine] = (await as(db, 'authenticated', player, (q) => q<{ p: { rows: { seconds: number }[]; skills: Record<string, string[]> } }>(`select public.brain_profile(null) as p`))) as [
      { p: { rows: { seconds: number }[]; skills: Record<string, string[]> } },
    ];
    expect(mine.p.rows).toHaveLength(1);
    expect(Number(mine.p.rows[0]!.seconds)).toBe(600);
    expect(mine.p.skills[gameId]).toEqual(['logic', 'memory']);
    // Another player sees it only through the public profile, never by asking for this player's events.
    const [pub] = (await as(db, 'anon', null, (q) => q<{ p: { username: string; rows: unknown[] } | null }>(`select public.brain_profile_of('brainy_one') as p`))) as [{ p: { username: string; rows: unknown[] } }];
    expect(pub.p.username).toBe('brainy_one');
    await db.query(`update public.profiles set profile_public = false where id = $1`, [player]);
    const [hidden] = (await as(db, 'anon', null, (q) => q<{ p: unknown }>(`select public.brain_profile_of('brainy_one') as p`))) as [{ p: unknown }];
    expect(hidden.p).toBeNull();
  });

  it('queues the weekly report for players who played, unless they turned it off', async () => {
    const [{ n }] = (await db.query<{ n: number }>(`select app.weekly_brain_reports() as n`)).rows as [{ n: number }];
    expect(n).toBe(1);
    const mail = await db.query<{ data: { minutes: number; skills: Record<string, { week: number }> } }>(`select data from public.email_outbox where template = 'brain_report'`);
    expect(mail.rows[0]!.data.skills.logic!.week).toBe(5);
    await as(db, 'authenticated', player, (q) => q(`select public.set_brain_report(false)`));
    const [{ m }] = (await db.query<{ m: number }>(`select app.weekly_brain_reports() as m`)).rows as [{ m: number }];
    expect(m).toBe(0);
  });
});
