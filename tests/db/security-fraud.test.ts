import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0020: fake events cannot fake countries, flood plays or earn ad revenue without play. */
let db: PGlite;
let gameId: string;

beforeAll(async () => {
  db = await createDb();
  const dev = await createUser(db, 'fraud_dev');
  const studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Fraud Studio', 'fraud-studio', 'IN', 'f@example.test') returning id`,
    [dev],
  )).rows[0]!.id;
  gameId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls, status, released_at)
     values ($1, 'fraud-game', 'Fraud Game', 'A test', 'About', '{a,b,c}', '[]', 'rise', now()) returning id`,
    [studio],
  )).rows[0]!.id;
  await db.query(`select app.set_secret('edge_key', 'edge-secret-for-tests')`);
});

/** Ingests as a guest with the given request headers (what the platform would see). */
const ingest = (anon: string, events: unknown[], headers: Record<string, string> = {}, country: string | null = null) =>
  as(db, 'anon', null, async (q) => {
    await q(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
    const [r] = await q<{ n: number }>(`select public.ingest_events($1, 'mobile', null, $2::jsonb, $3, null) as n`, [anon, JSON.stringify(events), country]);
    return r!.n;
  });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('fake events', () => {
  it('takes the country from the platform, never from the caller', async () => {
    const s = uuid(1);
    await ingest(uuid(101), [{ type: 'play_click', game_id: gameId, session_id: s }], { 'cf-ipcountry': 'IN', 'cf-connecting-ip': '1.1.1.1' }, 'US');
    const [row] = (await db.query<{ country: string }>(`select country from public.events where session_id = $1`, [s])).rows;
    expect(row!.country).toBe('IN');
    // Our own Edge Function proves itself with the edge key and may pass the country it saw.
    const s2 = uuid(2);
    await ingest(uuid(102), [{ type: 'play_click', game_id: gameId, session_id: s2 }], { 'x-bg-edge-key': 'edge-secret-for-tests' }, 'GB');
    expect((await db.query<{ country: string }>(`select country from public.events where session_id = $1`, [s2])).rows[0]!.country).toBe('GB');
    // A wrong key is the same as no key.
    const s3 = uuid(3);
    await ingest(uuid(103), [{ type: 'play_click', game_id: gameId, session_id: s3 }], { 'x-bg-edge-key': 'guess' }, 'GB');
    expect((await db.query<{ country: string | null }>(`select country from public.events where session_id = $1`, [s3])).rows[0]!.country).toBeNull();
  });

  it('caps plays per browser per game per day, and per IP', async () => {
    const anon = uuid(200);
    let accepted = 0;
    for (let i = 0; i < 3; i++) {
      const batch = Array.from({ length: 10 }, (_, j) => ({ type: 'play_click', game_id: gameId, session_id: uuid(1000 + i * 10 + j) }));
      accepted += await ingest(anon, batch, { 'cf-connecting-ip': '2.2.2.2' });
    }
    expect(accepted).toBe(20);
    // New browser ids from the same IP stop at the IP cap (100 plays of one game a day).
    let fromIp = 0;
    for (let b = 0; b < 12; b++) {
      fromIp += await ingest(uuid(300 + b), Array.from({ length: 10 }, (_, j) => ({ type: 'play_click', game_id: gameId, session_id: uuid(5000 + b * 10 + j) })), { 'cf-connecting-ip': '3.3.3.3' });
    }
    expect(fromIp).toBe(100);
  });

  it('ignores a forged X-Forwarded-For when Cloudflare gives the real IP', async () => {
    // Rotating the first X-Forwarded-For entry used to look like many different people.
    let n = 0;
    for (let b = 0; b < 12; b++) {
      n += await ingest(uuid(400 + b), Array.from({ length: 10 }, (_, j) => ({ type: 'play_click', game_id: gameId, session_id: uuid(7000 + b * 10 + j) })), {
        'cf-connecting-ip': '4.4.4.4',
        'x-forwarded-for': `10.0.${b}.1, 4.4.4.4`,
      });
    }
    expect(n).toBe(100);
  });

  it('counts ad views for revenue only in sessions with real play', async () => {
    const played = uuid(9001);
    const bare = uuid(9002);
    await ingest(uuid(500), [
      { type: 'play_click', game_id: gameId, session_id: played },
      { type: 'ad_started', game_id: gameId, session_id: played },
      { type: 'session_end', game_id: gameId, session_id: played, payload: { t: 90 } },
      { type: 'ad_started', game_id: gameId, session_id: bare },
      { type: 'ad_started', game_id: gameId, session_id: bare },
    ], { 'cf-connecting-ip': '5.5.5.5' });
    await as(db, 'service_role', null, (q) => q(`select public.refresh_daily_game_kpis(current_date)`));
    const [k] = (await db.query<{ ad_impressions: number }>(`select ad_impressions from public.daily_game_kpis where game_id = $1 and day = current_date`, [gameId])).rows;
    expect(k!.ad_impressions).toBe(1);
  });

  it('never lets the API read or set secrets', async () => {
    await expect(as(db, 'anon', null, (q) => q(`select * from app.secrets`))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', null, (q) => q(`select app.set_secret('edge_key', 'x')`))).rejects.toThrow(/permission denied/);
  });
});
