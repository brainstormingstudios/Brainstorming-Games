import { describe, expect, it } from 'vitest';
import { localizePath, splitLocale } from '@/i18n/config';
import { gameInCategory, tagSlug } from '@/lib/catalogue/categories';
import { applyQuery, buildRails, collectTags, mergeLive, relatedGames } from '@/lib/catalogue/listings';
import { searchGames } from '@/lib/catalogue/search';
import { DEFAULT_SITE_CONFIG, type GameSummary } from '@/lib/data/types';
import { bayesianRating10, isVoteInWindow } from '@/lib/domain/rating';
import { injectSparkSlots, isSparkWindowOver, orderSparkForExposure } from '@/lib/domain/spark';

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function game(id: string, over: Partial<GameSummary> = {}): GameSummary {
  return {
    id,
    slug: id,
    title: `Game ${id}`,
    shortDescription: '',
    category: 'arcade',
    tags: [],
    orientation: 'landscape',
    platforms: ['desktop', 'mobile'],
    isMultiplayer: false,
    sizeBytes: 5_000_000,
    initialLoadBytes: null,
    status: 'rise',
    schoolSafe: false,
    releasedAt: iso(30),
    updatedAt: iso(30),
    sparkStartedAt: null,
    studio: { id: 's1', slug: 'studio', name: 'Studio', country: null, isFirstParty: false, verified: false },
    cover: null,
    coverPortrait: null,
    coverSquare: null,
    preview: null,
    previewPortrait: null,
    coverVariants: [],
    stats: { plays: 0, plays7d: 0, rating10: null, votes: 0, likes: 0, dislikes: 0 },
    versionId: 'v',
    version: '1',
    playPath: `${id}/1/index.html`,
    usesSdk: false,
    ...over,
  };
}

describe('rating', () => {
  it('is null without votes and Bayesian with them', () => {
    expect(bayesianRating10(0, 0)).toBeNull();
    expect(bayesianRating10(1, 0)).toBe(7.1);
    expect(bayesianRating10(0, 1)).toBe(6.7);
    expect(bayesianRating10(980, 20)).toBe(9.7);
  });
  it('only counts votes from the last 180 days', () => {
    expect(isVoteInWindow(iso(179))).toBe(true);
    expect(isVoteInWindow(iso(181))).toBe(false);
  });
});

describe('spark launch', () => {
  it('ends at 7 days and 1,000 plays, or at 14 days', () => {
    expect(isSparkWindowOver(iso(6), 5000)).toBe(false);
    expect(isSparkWindowOver(iso(8), 999)).toBe(false);
    expect(isSparkWindowOver(iso(8), 1000)).toBe(true);
    expect(isSparkWindowOver(iso(14.1), 0)).toBe(true);
  });
  it('shows the least-played Spark games first', () => {
    const spark = [game('a', { stats: { ...game('a').stats, plays: 900 } }), game('b'), game('c', { stats: { ...game('c').stats, plays: 300 } })];
    expect(orderSparkForExposure(spark, 'seed').map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });
  it('gives Spark games 1 in 10 slots and keeps the rail length', () => {
    const rail = Array.from({ length: 20 }, (_, i) => game(`r${i}`));
    const spark = [game('s1', { status: 'spark' }), game('s2', { status: 'spark' }), game('s3', { status: 'spark' })];
    const out = injectSparkSlots(rail, spark, 'seed');
    expect(out).toHaveLength(20);
    expect(out[2]!.status).toBe('spark');
    expect(out[12]!.status).toBe('spark');
    expect(out.filter((g) => g.status === 'spark')).toHaveLength(2);
    // A rail that already holds every Spark game is left alone.
    expect(injectSparkSlots(spark, spark, 'seed')).toEqual(spark);
  });
});

describe('listings', () => {
  const games = [
    game('new', { releasedAt: iso(1), stats: { ...game('x').stats, plays: 10, plays7d: 10 } }),
    game('big', { sizeBytes: 50_000_000, stats: { ...game('x').stats, plays: 5000, plays7d: 40, rating10: 9, votes: 50 } }),
    game('mp', { isMultiplayer: true, tags: ['2-player', 'cards'], category: 'card-board' }),
    game('india', { studio: { ...game('x').studio, country: 'IN', slug: 'desi' }, tags: ['cards'] }),
    game('draft', { status: 'draft' }),
    game('paused', { status: 'paused' }),
  ];

  it('never lists games that are not public', () => {
    expect(applyQuery(games).items.map((g) => g.id)).not.toContain('draft');
    expect(applyQuery(games).items.map((g) => g.id)).not.toContain('paused');
    expect(applyQuery(games).total).toBe(4);
  });
  it('filters, sorts and pages', () => {
    expect(applyQuery(games, { sort: 'new' }).items[0]!.id).toBe('new');
    expect(applyQuery(games, { sort: 'popular' }).items[0]!.id).toBe('big');
    expect(applyQuery(games, { maxSize: 10_000_000 }).items.map((g) => g.id)).not.toContain('big');
    expect(applyQuery(games, { multiplayer: true }).items.map((g) => g.id)).toEqual(['mp']);
    expect(applyQuery(games, { tag: 'cards' }).total).toBe(2);
    expect(applyQuery(games, { newWithinDays: 7 }).items.map((g) => g.id)).toEqual(['new']);
    expect(applyQuery(games, { sort: 'new', offset: 1, limit: 2 }).items).toHaveLength(2);
  });
  it('derives the collection categories', () => {
    expect(gameInCategory(games[2]!, '2-player')).toBe(true);
    expect(gameInCategory(games[3]!, 'made-in-india')).toBe(true);
    expect(gameInCategory(games[0]!, 'made-in-india')).toBe(false);
    expect(applyQuery(games, { category: 'made-in-india' }).items.map((g) => g.id)).toEqual(['india']);
  });
  it('builds every homepage rail, empty or not', () => {
    const rails = buildRails(games, DEFAULT_SITE_CONFIG);
    expect(rails.map((r) => r.id)).toEqual(DEFAULT_SITE_CONFIG.railOrder);
    expect(rails.find((r) => r.id === 'multiplayer')!.games.map((g) => g.id)).toEqual(['mp']);
    expect(rails.find((r) => r.id === 'fresh')!.games).toEqual([]);
    expect(buildRails([], DEFAULT_SITE_CONFIG).every((r) => r.games.length === 0)).toBe(true);
  });
  it('suggests related games without repeating any', () => {
    const related = relatedGames(games[2]!, games);
    const ids = [...related.playNext, ...related.similar, ...related.fromStudio].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('mp');
    expect(related.similar.map((g) => g.id)).toContain('india');
  });
  it('merges live changes into a pre-rendered list', () => {
    const merged = mergeLive([game('a'), game('b')], [game('b', { status: 'paused' }), game('c')]);
    expect(merged.map((g) => g.id).sort()).toEqual(['a', 'c']);
  });
  it('counts tags', () => {
    expect(collectTags(games)[0]).toEqual({ tag: 'cards', count: 2 });
    expect(tagSlug('  Tower Defense! ')).toBe('tower-defense');
  });
});

describe('search', () => {
  const games = [game('a', { title: 'Brick Breaker', category: 'arcade' }), game('b', { title: 'Mind Maze', category: 'puzzle' })];
  it('matches titles with typos', () => {
    expect(searchGames('brik', games)[0]!.id).toBe('a');
    expect(searchGames('   ', games)).toEqual([]);
  });
});

describe('i18n', () => {
  it('builds locale-aware paths with trailing slashes', () => {
    expect(localizePath('/game/x', 'en')).toBe('/game/x/');
    expect(localizePath('/search?q=a', 'en')).toBe('/search/?q=a');
    expect(localizePath('https://example.com/x', 'en')).toBe('https://example.com/x');
    // Without a second language a two-letter first segment is just a path.
    expect(splitLocale('/hi/game/x/')).toEqual({ locale: 'en', path: '/hi/game/x/' });
    expect(splitLocale('/history/')).toEqual({ locale: 'en', path: '/history/' });
  });

});
