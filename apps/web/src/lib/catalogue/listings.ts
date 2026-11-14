import { LIMITS } from '@/lib/config';
import {
  DEFAULT_RAIL_ORDER,
  PUBLIC_STATUSES,
  type GamePage,
  type GameQuery,
  type GameSummary,
  type RailId,
  type SiteConfig,
  type SortOrder,
} from '@/lib/data/types';
import { injectSparkSlots, orderSparkForExposure } from '@/lib/domain/spark';
import { gameInCategory } from './categories';

/** Pure catalogue logic: the same functions run at build time and in the browser. */

const DAY = 86_400_000;
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export const isPublic = (g: Pick<GameSummary, 'status'>) => PUBLIC_STATUSES.includes(g.status);

/** Trending = recent plays, nudged by rating so a well-liked game beats a merely clicked one. */
export function trendingScore(g: GameSummary): number {
  const rating = g.stats.rating10 ?? 7;
  return g.stats.plays7d * (0.5 + rating / 10);
}

/** Popular = lifetime plays with the same rating nudge. */
export function popularScore(g: GameSummary): number {
  const rating = g.stats.rating10 ?? 7;
  return g.stats.plays * (0.5 + rating / 10);
}

export function sortGames(games: readonly GameSummary[], sort: SortOrder = 'popular'): GameSummary[] {
  const list = [...games];
  const byTitle = (a: GameSummary, b: GameSummary) => a.title.localeCompare(b.title);
  switch (sort) {
    case 'new':
      return list.sort((a, b) => time(b.releasedAt) - time(a.releasedAt) || byTitle(a, b));
    case 'updated':
      return list.sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || byTitle(a, b));
    case 'rating':
      return list.sort(
        (a, b) => (b.stats.rating10 ?? 0) - (a.stats.rating10 ?? 0) || b.stats.votes - a.stats.votes || byTitle(a, b),
      );
    case 'trending':
      return list.sort((a, b) => trendingScore(b) - trendingScore(a) || time(b.releasedAt) - time(a.releasedAt));
    case 'recommended':
      // Brain Rank first; games without a score yet fall back to popularity.
      return list.sort((a, b) => (b.stats.rank ?? 0) - (a.stats.rank ?? 0) || popularScore(b) - popularScore(a) || byTitle(a, b));
    case 'popular':
    default:
      return list.sort((a, b) => popularScore(b) - popularScore(a) || time(b.releasedAt) - time(a.releasedAt));
  }
}

export function matchesQuery(g: GameSummary, q: GameQuery, now: number = Date.now()): boolean {
  const statuses = q.status ?? PUBLIC_STATUSES;
  if (!statuses.includes(g.status)) return false;
  if (q.category && !gameInCategory(g, q.category)) return false;
  if (q.tag && !g.tags.includes(q.tag)) return false;
  if (q.studioSlug && g.studio.slug !== q.studioSlug) return false;
  if (q.multiplayer && !g.isMultiplayer) return false;
  if (q.mobile && !g.platforms.includes('mobile')) return false;
  if (q.maxSize != null && g.sizeBytes > q.maxSize) return false;
  if (q.newWithinDays != null && now - time(g.releasedAt) > q.newWithinDays * DAY) return false;
  if (q.originals && !g.studio.isFirstParty) return false;
  if (q.schoolSafeOnly && !g.schoolSafe) return false;
  return true;
}

/** Filter, sort and page a list of games exactly as the live repositories do. */
export function applyQuery(games: readonly GameSummary[], q: GameQuery = {}): GamePage {
  const matched = sortGames(
    games.filter((g) => matchesQuery(g, q)),
    q.sort,
  );
  const offset = q.offset ?? 0;
  const items = q.limit != null ? matched.slice(offset, offset + q.limit) : matched.slice(offset);
  return { items, total: matched.length };
}

export interface Rail {
  id: RailId;
  games: GameSummary[];
  /** Listing page that shows the whole set, when there is one. */
  href: string | null;
}

const RAIL_HREF: Record<RailId, string | null> = {
  'top-picks': null,
  fresh: null,
  trending: '/trending',
  new: '/new',
  originals: '/originals',
  multiplayer: '/multiplayer',
  'made-in-india': '/c/made-in-india',
  'under-10mb': null,
  updated: '/updated',
  'top-rated': null,
};

export interface RailOptions {
  /** Tiles per rail. */
  size?: number;
  /** Seed for the Spark rotation; changes daily at build time. */
  seed?: string;
  now?: number;
}

/** A game counts as "updated" once it has shipped a second version. */
const isUpdated = (g: GameSummary) => g.version != null && g.version !== '1' && g.version !== '1.0.0';

/** Builds the homepage rails from the public catalogue. Empty rails are kept; the UI decides. */
export function buildRails(
  games: readonly GameSummary[],
  config: Pick<SiteConfig, 'railOrder' | 'hiddenRails'>,
  { size = 18, seed = 'static', now = Date.now() }: RailOptions = {},
): Rail[] {
  const live = games.filter(isPublic);
  const spark = live.filter((g) => g.status === 'spark');
  const take = (list: GameSummary[]) => list.slice(0, size);

  const build: Record<RailId, () => GameSummary[]> = {
    'top-picks': () => take(sortGames(live, 'recommended')),
    fresh: () => take(orderSparkForExposure(spark, seed)),
    trending: () => take(sortGames(live, 'trending')),
    new: () => take(sortGames(live, 'new')),
    originals: () => take(sortGames(live.filter((g) => g.studio.isFirstParty), 'popular')),
    multiplayer: () => take(sortGames(live.filter((g) => g.isMultiplayer), 'popular')),
    'made-in-india': () => take(sortGames(live.filter((g) => gameInCategory(g, 'made-in-india')), 'popular')),
    'under-10mb': () => take(sortGames(live.filter((g) => g.sizeBytes <= LIMITS.under10Mb), 'popular')),
    updated: () => take(sortGames(live.filter(isUpdated), 'updated')),
    'top-rated': () => take(sortGames(live.filter((g) => g.stats.rating10 != null), 'rating')),
  };

  const order = [...config.railOrder, ...DEFAULT_RAIL_ORDER.filter((id) => !config.railOrder.includes(id))];
  void now;
  return order
    .filter((id) => !config.hiddenRails.includes(id))
    .map((id) => {
      const base = build[id]();
      // Spark games get 1 in 10 slots everywhere except their own rail.
      const railGames = id === 'fresh' ? base : injectSparkSlots(base, spark, `${seed}:${id}`);
      return { id, games: railGames, href: RAIL_HREF[id] };
    });
}

export interface RelatedGames {
  playNext: GameSummary[];
  similar: GameSummary[];
  fromStudio: GameSummary[];
}

/** Right-rail suggestions for a game page. Each list excludes the game and the lists above it. */
export function relatedGames(
  game: Pick<GameSummary, 'id' | 'category' | 'tags' | 'studio'>,
  all: readonly GameSummary[],
  size = 6,
): RelatedGames {
  const others = all.filter((g) => g.id !== game.id && isPublic(g));
  const used = new Set<string>();
  const claim = (list: GameSummary[]) => {
    const out = list.filter((g) => !used.has(g.id)).slice(0, size);
    out.forEach((g) => used.add(g.id));
    return out;
  };
  const playNext = claim(sortGames(others.filter((g) => g.category === game.category), 'rating'));
  const tagSet = new Set(game.tags);
  const overlap = (g: GameSummary) => g.tags.reduce((n, t) => n + (tagSet.has(t) ? 1 : 0), 0);
  const similar = claim(
    others
      .map((g) => ({ g, n: overlap(g) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || popularScore(b.g) - popularScore(a.g))
      .map((x) => x.g),
  );
  const fromStudio = claim(sortGames(others.filter((g) => g.studio.slug === game.studio.slug), 'popular'));
  return { playNext, similar, fromStudio };
}

/** Tag slugs with the number of public games using each, most used first. */
export function collectTags(games: readonly GameSummary[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const g of games) {
    if (!isPublic(g)) continue;
    for (const t of g.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Merges live changes into a pre-rendered list: changed games replace their old entry, new ones
 * are added, and games that stopped being public are dropped.
 */
export function mergeLive(initial: readonly GameSummary[], changes: readonly GameSummary[]): GameSummary[] {
  if (changes.length === 0) return [...initial];
  const byId = new Map(initial.map((g) => [g.id, g]));
  for (const g of changes) {
    if (isPublic(g)) byId.set(g.id, g);
    else byId.delete(g.id);
  }
  return [...byId.values()];
}
