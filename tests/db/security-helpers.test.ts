import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0022: internal helpers are not callable by API users unless row security needs them. */
let db: PGlite;
let user: string;

beforeAll(async () => {
  db = await createDb();
  user = await createUser(db, 'helper_probe');
});

describe('internal helpers', () => {
  it('refuses helpers that publish, message, log or rate-limit', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const sql of [
      `select app.publish_version('${id}')`,
      `select app.notify('${id}', 'x', 'x')`,
      `select app.audit('x', 'x', 'x')`,
      `select app.take_token('send_code:someone', 1, 60)`,
      `select app.set_secret('edge_key', 'x')`,
    ]) {
      for (const role of ['anon', 'authenticated'] as const) {
        await expect(as(db, role, role === 'anon' ? null : user, (q) => q(sql)), `${role}: ${sql}`).rejects.toThrow(/permission denied/);
      }
    }
  });

  it('keeps the helpers row security needs', async () => {
    const [r] = await as(db, 'authenticated', user, (q) => q<{ ok: boolean }>(`select app.is_staff() as ok`));
    expect(r!.ok).toBe(false);
    // A policy that calls app.owns_studio still works for its owner.
    await as(db, 'authenticated', user, (q) => q(`select * from public.studios`));
  });
});
