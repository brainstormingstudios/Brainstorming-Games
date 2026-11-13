import { describe, expect, it } from 'vitest';
import { jamIsOpen, jamPhase } from '@/lib/data/growthTypes';
import { AB_MIN_IMPRESSIONS, clickRate, pickWinner, variantFor } from '@/lib/domain/abTest';

describe('thumbnail A/B tests', () => {
  it('shows a visitor the same cover every time and spreads visitors across covers', () => {
    const labels = ['B', 'A', 'C'];
    const first = variantFor('visitor-1', 'game-1', labels);
    expect(labels).toContain(first);
    expect(variantFor('visitor-1', 'game-1', ['C', 'A', 'B'])).toBe(first);
    const seen = new Set(Array.from({ length: 200 }, (_, i) => variantFor(`visitor-${i}`, 'game-1', labels)));
    expect(seen.size).toBe(3);
    expect(variantFor('visitor-1', 'game-1', [])).toBeNull();
  });

  it('waits until every cover has 1,000 impressions', () => {
    expect(AB_MIN_IMPRESSIONS).toBe(1000);
    expect(pickWinner([{ label: 'A', impressions: 5000, clicks: 400 }])).toBeNull();
    expect(
      pickWinner([
        { label: 'A', impressions: 1000, clicks: 90 },
        { label: 'B', impressions: 999, clicks: 300 },
      ]),
    ).toBeNull();
  });

  it('picks the best click rate, not the most clicks, and breaks ties by label', () => {
    expect(
      pickWinner([
        { label: 'A', impressions: 4000, clicks: 200 }, // 5%
        { label: 'B', impressions: 1000, clicks: 80 }, // 8%
      ]),
    ).toBe('B');
    expect(
      pickWinner([
        { label: 'B', impressions: 1000, clicks: 50 },
        { label: 'A', impressions: 2000, clicks: 100 },
      ]),
    ).toBe('A');
    expect(clickRate({ impressions: 0, clicks: 0 })).toBeNull();
  });
});

describe('jams', () => {
  const jam = { status: 'published' as const, startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-11-20T00:00:00.000Z' };

  it('accepts entries only while published and inside the window', () => {
    expect(jamIsOpen(jam, new Date('2026-11-15T12:00:00Z'))).toBe(true);
    expect(jamIsOpen(jam, new Date('2026-11-09T23:59:00Z'))).toBe(false);
    expect(jamIsOpen(jam, new Date('2026-11-20T00:01:00Z'))).toBe(false);
    expect(jamIsOpen({ ...jam, status: 'closed' }, new Date('2026-11-15T12:00:00Z'))).toBe(false);
    expect(jamIsOpen({ ...jam, status: 'draft' }, new Date('2026-11-15T12:00:00Z'))).toBe(false);
  });

  it('names the phase players see', () => {
    expect(jamPhase(jam, new Date('2026-11-01T00:00:00Z'))).toBe('upcoming');
    expect(jamPhase(jam, new Date('2026-11-15T00:00:00Z'))).toBe('open');
    expect(jamPhase(jam, new Date('2026-12-01T00:00:00Z'))).toBe('ended');
    expect(jamPhase({ ...jam, status: 'closed' }, new Date('2026-11-15T00:00:00Z'))).toBe('ended');
  });
});
