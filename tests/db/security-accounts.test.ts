import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0023: payout details wait 48 hours, alerts reach staff, rotated keys keep working. */
let db: PGlite;
let admin: string;
let player: string;
let studio: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, 'sec_admin');
  player = await createUser(db, 'sec_player');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Hold Studio', 'hold-studio', 'IN', 'h@example.test') returning id`,
    [player],
  )).rows[0]!.id;
});

describe('payout details on hold', () => {
  it('keeps the old details in use until 48 hours have passed', async () => {
    await db.query(`insert into public.studio_payout_profiles (studio_id, ciphertext, iv, method, currency) values ($1, 'old', 'iv0', 'bank', 'INR')`, [studio]);
    await db.query(
      `update public.studio_payout_profiles set pending_ciphertext = 'new', pending_iv = 'iv1', pending_key_version = 1, pending_method = 'paypal',
       pending_currency = 'USD', pending_requested_at = now(), pending_effective_at = now() + interval '48 hours' where studio_id = $1`,
      [studio],
    );
    await as(db, 'service_role', null, (q) => q(`select public.promote_payout_profiles()`));
    expect((await db.query<{ ciphertext: string }>(`select ciphertext from public.studio_payout_profiles where studio_id = $1`, [studio])).rows[0]!.ciphertext).toBe('old');
    await db.query(`update public.studio_payout_profiles set pending_effective_at = now() - interval '1 minute' where studio_id = $1`, [studio]);
    await as(db, 'service_role', null, (q) => q(`select public.promote_payout_profiles()`));
    const [row] = (await db.query<{ ciphertext: string; method: string; pending_ciphertext: string | null }>(
      `select ciphertext, method, pending_ciphertext from public.studio_payout_profiles where studio_id = $1`, [studio])).rows;
    expect(row).toEqual({ ciphertext: 'new', method: 'paypal', pending_ciphertext: null });
  });

  it('cannot be moved early by a signed-in user', async () => {
    await expect(as(db, 'authenticated', player, (q) => q(`select public.promote_payout_profiles()`))).rejects.toThrow(/permission denied|not_allowed/);
  });
});

describe('security alerts', () => {
  it('records each alert once, e-mails admins about warnings, and only staff can read them', async () => {
    const raise = () => as(db, 'service_role', null, (q) => q(`select public.raise_security_alert('payout_change', 'warn', 'Payout details changed', '{}'::jsonb, 'k1')`));
    await raise();
    await raise();
    expect((await db.query(`select 1 from public.security_alerts where dedupe_key = 'k1'`)).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.email_outbox where template = 'security_alert'`)).rows).toHaveLength(1);
    await expect(as(db, 'authenticated', player, (q) => q(`select public.raise_security_alert('x_y', 'high', 't')`))).rejects.toThrow(/permission denied|not_allowed/);
    expect(await as(db, 'authenticated', player, (q) => q(`select * from public.security_alerts`))).toHaveLength(0);
    const [list] = await as(db, 'authenticated', admin, (q) => q<{ a: { id: number }[] }>(`select public.admin_security_alerts(true) as a`));
    expect(list!.a).toHaveLength(1);
    await as(db, 'authenticated', admin, (q) => q(`select public.admin_resolve_alert($1)`, [list!.a[0]!.id]));
    const [after] = await as(db, 'authenticated', admin, (q) => q<{ a: unknown[] }>(`select public.admin_security_alerts(true) as a`));
    expect(after!.a).toHaveLength(0);
  });

  it('shows staff the fraud overview and keeps it from everyone else', async () => {
    await expect(as(db, 'authenticated', player, (q) => q(`select public.admin_fraud_overview(7)`))).rejects.toThrow(/not_allowed/);
    const [r] = await as(db, 'authenticated', admin, (q) => q<{ o: unknown[] }>(`select public.admin_fraud_overview(7) as o`));
    expect(Array.isArray(r!.o)).toBe(true);
    await as(db, 'service_role', null, (q) => q(`select public.run_daily_jobs()`));
  });
});

describe('key rotation', () => {
  it('accepts the previous value of a secret while the new one rolls out', async () => {
    await db.query(`select app.set_secret('edge_key', 'new-value'), app.set_secret('edge_key_prev', 'old-value')`);
    const ok = async (v: string) => (await db.query<{ m: boolean }>(`select app.secret_matches('edge_key', $1) as m`, [v])).rows[0]!.m;
    expect(await ok('new-value')).toBe(true);
    expect(await ok('old-value')).toBe(true);
    expect(await ok('guess')).toBe(false);
  });
});
