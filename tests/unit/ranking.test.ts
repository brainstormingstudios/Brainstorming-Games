import { describe, expect, it } from 'vitest';
import { applyQuery } from '@/lib/catalogue/listings';
import type { GameSummary } from '@/lib/data/types';
import { explorationLeft, rankBreakdown, rankScore, type RankInputs } from '@/lib/domain/ranking';
import { sitePath } from '@/lib/sites';

const base: RankInputs = { impressions: 0, clicks: 0, plays: 0, conversion: null, avgSessionSec: null, d1: null, likes: 0, dislikes: 0, ageDays: 0 };

describe('Brain Rank', () => {
  it('gives a brand-new game a fair starting score from priors, exploration and freshness', () => {
    // Pinned: the SQL function app.rank_score must return the same numbers (tests/db).
    expect(rankScore(base)).toBe(67.4);
    expect(explorationLeft(0)).toBe(1000);
    expect(explorationLeft(250)).toBe(750);
    expect(explorationLeft(5000)).toBe(0);
  });

  it('needs evidence: a handful of lucky clicks does not beat a proven game', () => {
    const lucky = rankScore({ ...base, impressions: 4, clicks: 3, ageDays: 30 });
    const proven = rankScore({ ...base, impressions: 5000, clicks: 700, plays: 600, conversion: 0.8, avgSessionSec: 540, d1: 0.14, likes: 80, dislikes: 10, ageDays: 30 });
    expect(proven).toBeGreaterThan(lucky);
    expect(proven).toBe(87.5);
  });

  it('rewards each step of the funnel', () => {
    const game: RankInputs = { ...base, impressions: 3000, clicks: 240, plays: 200, conversion: 0.5, avgSessionSec: 200, d1: 0.05, likes: 10, dislikes: 5, ageDays: 40 };
    const score = rankScore(game);
    expect(rankScore({ ...game, clicks: 480 })).toBeGreaterThan(score);
    expect(rankScore({ ...game, conversion: 0.8 })).toBeGreaterThan(score);
    expect(rankScore({ ...game, avgSessionSec: 500 })).toBeGreaterThan(score);
    expect(rankScore({ ...game, d1: 0.12 })).toBeGreaterThan(score);
    expect(rankScore({ ...game, likes: 40 })).toBeGreaterThan(score);
  });

  it('fades the exploration bonus over the first 1,000 impressions and never exceeds 100', () => {
    const parts = (impressions: number) => rankBreakdown({ ...base, impressions, ageDays: 100 });
    expect(parts(0).exploration).toBe(15);
    expect(parts(500).exploration).toBe(7.5);
    expect(parts(1000).exploration).toBe(0);
    const perfect = rankScore({ ...base, impressions: 100, clicks: 100, plays: 5000, conversion: 1, avgSessionSec: 3600, d1: 1, likes: 500, dislikes: 0, ageDays: 0 });
    expect(perfect).toBeLessThanOrEqual(100);
  });

  it('orders the "recommended" sort by score', () => {
    const game = (id: string, rank: number, plays: number) =>
      ({ id, slug: id, title: id, status: 'rise', tags: [], platforms: ['desktop'], category: 'puzzle', studio: { slug: 's', isFirstParty: false }, sizeBytes: 1, releasedAt: '2026-01-01T00:00:00.000Z', stats: { plays, plays7d: plays, rating10: null, votes: 0, likes: 0, dislikes: 0, rank } }) as unknown as GameSummary;
    const { items } = applyQuery([game('a', 40, 9000), game('b', 85, 10), game('c', 60, 500)], { sort: 'recommended' });
    expect(items.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('three sites', () => {
  it('maps product paths to the site they live on', () => {
    expect(sitePath('/game/x')).toEqual({ site: 'play', path: '/game/x' });
    expect(sitePath('/dev')).toEqual({ site: 'developers', path: '/' });
    expect(sitePath('/dev/games/view?id=1')).toEqual({ site: 'developers', path: '/games/view?id=1' });
    expect(sitePath('/admin/qa/')).toEqual({ site: 'manage', path: '/qa/' });
    // Not a portal path: only the exact first segment counts.
    expect(sitePath('/developers')).toEqual({ site: 'play', path: '/developers' });
    expect(sitePath('/devlog')).toEqual({ site: 'play', path: '/devlog' });
  });
});
