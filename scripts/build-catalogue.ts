/**
 * Writes the catalogue snapshot that pages are pre-rendered from
 * (apps/web/src/generated/catalogue.json).
 *
 * Source, in order:
 *   1. Supabase, when NEXT_PUBLIC_SUPABASE_URL is set (public games only).
 *   2. BG_CATALOGUE_FIXTURE, a JSON file. Tests use this; it is never set in a real build.
 *   3. Nothing: an empty catalogue. This is the normal state of a fresh install and of mock mode.
 *
 * No games are ever created here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageToDetail } from '../apps/web/src/lib/data/supabase/index';
import {
  DEFAULT_SITE_CONFIG,
  PUBLIC_STATUSES,
  type CatalogueSnapshot,
  type GameDetail,
  type SiteConfig,
  type StudioDetail,
} from '../apps/web/src/lib/data/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'apps', 'web', 'src', 'generated', 'catalogue.json');

async function rest<T>(base: string, key: string, path: string): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'range-unit': 'items',
        range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${path} failed: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function fromSupabase(base: string, key: string): Promise<CatalogueSnapshot> {
  const statuses = PUBLIC_STATUSES.join(',');
  const cards = await rest<Parameters<typeof pageToDetail>[0]>(
    base,
    key,
    `game_cards?select=*&status=in.(${statuses})&order=released_at.desc`,
  );
  const studioRows = await rest<Record<string, unknown>>(base, key, 'studio_pages?select=*');
  const configRows = await rest<{ key: string; value: Partial<SiteConfig> }>(
    base,
    key,
    'site_config?select=key,value&key=eq.home',
  );
  const studios: StudioDetail[] = studioRows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    country: (r.country as string | null) ?? null,
    isFirstParty: Boolean(r.is_first_party),
    verified: Boolean(r.verified),
    bio: String(r.bio ?? ''),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    links: (r.links as StudioDetail['links'] | null) ?? [],
    level: (r.level as StudioDetail['level']) ?? 'rookie',
    followers: Number(r.followers ?? 0),
    createdAt: String(r.created_at),
  }));
  return {
    generatedAt: new Date().toISOString(),
    source: 'supabase',
    games: cards.map(pageToDetail),
    studios,
    config: { ...DEFAULT_SITE_CONFIG, ...(configRows[0]?.value ?? {}) },
  };
}

function fromFixture(file: string): CatalogueSnapshot {
  const path = isAbsolute(file) ? file : join(ROOT, file);
  if (!existsSync(path)) throw new Error(`BG_CATALOGUE_FIXTURE not found: ${path}`);
  const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<CatalogueSnapshot>;
  return {
    generatedAt: new Date().toISOString(),
    source: 'fixture',
    games: (data.games ?? []) as GameDetail[],
    studios: data.studios ?? [],
    config: { ...DEFAULT_SITE_CONFIG, ...(data.config ?? {}) },
  };
}

async function main() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const fixture = process.env.BG_CATALOGUE_FIXTURE;

  let snapshot: CatalogueSnapshot;
  if (fixture) snapshot = fromFixture(fixture);
  else if (base && key) snapshot = await fromSupabase(base, key);
  else {
    snapshot = {
      generatedAt: new Date().toISOString(),
      source: 'empty',
      games: [],
      studios: [],
      config: DEFAULT_SITE_CONFIG,
    };
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(snapshot)}\n`);
  console.log(
    `[catalogue] ${snapshot.source}: ${snapshot.games.length} games, ${snapshot.studios.length} studios`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
