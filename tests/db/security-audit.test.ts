import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './harness';

/**
 * Standing security audit of the whole schema. Each rule must hold for every table and function,
 * including ones added later, so a new migration cannot quietly open a hole.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows;

describe('database security audit', () => {
  it('turns on row-level security for every table in public', async () => {
    const open = await rows<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(open.map((r) => r.t)).toEqual([]);
  });

  it('never lets guests write to a table directly', async () => {
    const writes = await rows<{ t: string; p: string }>(
      `select table_name as t, privilege_type as p from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
    );
    expect(writes).toEqual([]);
  });

  it('checks the staff role inside every admin function', async () => {
    const unchecked = await rows<{ f: string }>(
      `select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'admin\\_%'
         and p.prosrc !~ '(is_staff|is_admin|service_role)'`,
    );
    expect(unchecked.map((r) => r.f)).toEqual([]);
  });

  it('pins search_path on every security-definer function (no hijacking through a schema)', async () => {
    const loose = await rows<{ f: string }>(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(loose.map((r) => r.f)).toEqual([]);
  });

  it('keeps secrets and payout details out of reach of the API', async () => {
    for (const table of ['studio_payout_profiles', 'creator_payout_profiles']) {
      const grants = await rows<{ g: string }>(
        `select grantee as g from information_schema.role_table_grants
         where table_schema = 'public' and table_name = '${table}' and grantee in ('anon', 'authenticated')`,
      );
      expect(grants, table).toEqual([]);
    }
    const secrets = await rows<{ g: string }>(
      `select grantee as g from information_schema.role_table_grants where table_schema = 'app' and table_name = 'secrets' and grantee in ('anon', 'authenticated')`,
    );
    expect(secrets).toEqual([]);
  });
});
