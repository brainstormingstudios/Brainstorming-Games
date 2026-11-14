import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase');

/**
 * The few things Supabase provides before our migrations run: the API roles, the auth schema
 * and the helpers that read the caller from the request's JWT claims.
 */
const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  -- Supabase grants these by default; the migrations must lock them down again themselves.
  grant all on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(join(SUPABASE, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** A fresh in-memory Postgres with every migration and the seed applied. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(SUPABASE, 'migrations', file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  await db.exec(readFileSync(join(SUPABASE, 'seed.sql'), 'utf8'));
  return db;
}

export type Role = 'anon' | 'authenticated' | 'service_role';

/** Runs queries as an API role, the way PostgREST would, and rolls nothing back. */
export async function as<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: (q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
  /** Assurance level of the session: `aal2` has passed the owner code, `aal1` has not. */
  aal: 'aal1' | 'aal2' = 'aal2',
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [
      userId ?? '',
      role,
    ]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ aal, sub: userId ?? '', role })]);
    await tx.exec(`set local role ${role}`);
    const q = async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      (await tx.query<R>(sql, params)).rows;
    return fn(q);
  }) as Promise<T>;
}

export async function createUser(db: PGlite, username: string, birthYear = 1990): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [
    `${username}@example.test`,
  ]);
  const id = rows[0]!.id;
  await as(db, 'authenticated', id, (q) => q(`select public.complete_signup($1, $2, 'en')`, [username, birthYear]));
  return id;
}
