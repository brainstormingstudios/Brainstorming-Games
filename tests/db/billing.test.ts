import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0013: memberships, guest passes, Boost orders and the e-mail outbox. */
let db: PGlite;
let maxMember: string;
let friend: string;
let stranger: string;

beforeAll(async () => {
  db = await createDb();
  maxMember = await createUser(db, 'max_member');
  friend = await createUser(db, 'friend_one');
  stranger = await createUser(db, 'stranger_one');
  await db.query(`update public.profiles set premium_plan = 'max', premium_until = now() + interval '20 days' where id = $1`, [maxMember]);
});

describe('billing', () => {
  it('keeps payments, boosts and the outbox away from browsers', async () => {
    await db.query(
      `insert into public.payments (user_id, kind, what, amount_paise, status, provider_ref) values ($1, 'premium', 'Max', 19900, 'paid', 'sub_1')`,
      [maxMember],
    );
    expect(await as(db, 'authenticated', maxMember, (q) => q(`select * from public.payments`))).toHaveLength(1);
    expect(await as(db, 'authenticated', stranger, (q) => q(`select * from public.payments`))).toHaveLength(0);
    await expect(as(db, 'authenticated', maxMember, (q) => q(`update public.profiles set premium_until = now() + interval '9 years' where id = auth.uid()`))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', null, (q) => q(`select * from public.email_outbox`))).rejects.toThrow(/permission denied/);
    expect(await as(db, 'authenticated', stranger, (q) => q(`select * from public.email_outbox`))).toEqual([]);
  });

  it('lets a Max member share two guest passes a month, each used once by someone new', async () => {
    const [{ code }] = (await as(db, 'authenticated', maxMember, (q) => q<{ code: string }>(`select public.create_guest_pass() as code`))) as [{ code: string }];
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(as(db, 'authenticated', maxMember, (q) => q(`select public.redeem_guest_pass($1)`, [code]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', friend, (q) => q(`select public.redeem_guest_pass($1)`, [code]));
    const [p] = (await db.query<{ premium_plan: string; premium_from_pass: boolean }>(`select premium_plan, premium_from_pass from public.profiles where id = $1`, [friend])).rows;
    expect(p).toEqual({ premium_plan: 'plus', premium_from_pass: true });
    await expect(as(db, 'authenticated', stranger, (q) => q(`select public.redeem_guest_pass($1)`, [code]))).rejects.toThrow(/not_found/);
    await as(db, 'authenticated', maxMember, (q) => q(`select public.create_guest_pass()`));
    await expect(as(db, 'authenticated', maxMember, (q) => q(`select public.create_guest_pass()`))).rejects.toThrow(/not_allowed/);
    // A pass holder cannot hand out passes, and neither can a player without Max.
    await expect(as(db, 'authenticated', friend, (q) => q(`select public.create_guest_pass()`))).rejects.toThrow(/not_allowed/);
    await expect(as(db, 'authenticated', stranger, (q) => q(`select public.create_guest_pass()`))).rejects.toThrow(/not_allowed/);
  });

  it('queues the e-mails for each step and doubles quest points for Max', async () => {
    const { rows } = await db.query<{ template: string }>(`select template from public.email_outbox order by id`);
    expect(rows.map((r) => r.template)).toContain('guest_pass_redeemed');
    await db.query(`select app.award_points($1, 10, 'quest', 'quest', 'q1')`, [maxMember]);
    await db.query(`select app.award_points($1, 10, 'quest', 'quest', 'q1')`, [stranger]);
    const points = (await db.query<{ id: string; brain_points: number }>(`select id, brain_points from public.profiles where id in ($1, $2)`, [maxMember, stranger])).rows;
    expect(points.find((r) => r.id === maxMember)!.brain_points).toBe(20);
    expect(points.find((r) => r.id === stranger)!.brain_points).toBe(10);
  });
});
