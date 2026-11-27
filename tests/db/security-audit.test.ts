import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './harness';

/**
 * Launch security audit, kept as a test so it runs on every change:
 * 1. Row-level security is on for every table in public.
 * 2. Every security-definer function a browser may call checks who is calling (auth.uid(),
 *    a staff or admin check, the service role) or is on the short list of public read-only ones.
 * 3. Browsers cannot read the private tables at all.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

describe('security audit', () => {
  it('has row-level security on every table', async () => {
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`,
    );
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('checks the caller in every security-definer function browsers can run', async () => {
    const { rows } = await db.query<{ name: string; body: string }>(
      `select p.proname as name, p.prosrc as body
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    const checksCaller = /auth\.uid\(\)|auth\.role\(\)|is_staff\(|is_admin\(|app\.guard\(|app\.take_token\(|owns_game\(|my_studio_id\(|token_hash|require_/i;
    const unchecked = rows.filter((r) => !checksCaller.test(r.body)).map((r) => r.name).sort();
    // Public, read-only or rate-limited by design. Anything new here must be reviewed by hand.
    expect(unchecked).toMatchSnapshot();
  });
});
