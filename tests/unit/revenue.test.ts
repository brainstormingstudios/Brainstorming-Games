import { describe, expect, it } from 'vitest';
import {
  computeRevenue,
  daysInWindow,
  effectiveShare,
  parseRevenueCsv,
  splitLargestRemainder,
  type GameImpressions,
} from '@/lib/domain/revenue';

/** Phase 4 acceptance: a fake monthly revenue CSV produces correct per-studio statements. */
const CSV = `country,gross,refunds,invalid_traffic
IN,1000.00,50.00,30.00
US,500.00,0,20.00
ALL,100.00,0,0`;

const game = (over: Partial<GameImpressions> & Pick<GameImpressions, 'gameId' | 'studioId'>): GameImpressions => ({
  title: over.gameId,
  studioName: over.studioId,
  impressionsByCountry: {},
  refImpressions: 0,
  exclusiveUntil: null,
  riseStartedAt: null,
  ...over,
});

describe('revenue split', () => {
  it('parses the CSV and rejects bad lines', () => {
    const ok = parseRevenueCsv(CSV);
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toEqual([
      { country: 'IN', gross: 1000, refunds: 50, invalidTraffic: 30 },
      { country: 'US', gross: 500, refunds: 0, invalidTraffic: 20 },
      { country: 'ALL', gross: 100, refunds: 0, invalidTraffic: 0 },
    ]);
    expect(parseRevenueCsv('country,gross\nIndia,10\nUS,-5').errors).toHaveLength(2);
    expect(parseRevenueCsv('gross\n10').errors[0]).toContain('header');
  });

  it('splits money so the parts always add up exactly', () => {
    expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitLargestRemainder(1, [1, 1])).toEqual([1, 0]);
    expect(splitLargestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(splitLargestRemainder(10, [0, 0])).toEqual([0, 0]);
  });

  it('applies 70% standard, 85% referral and 80% exclusive shares', () => {
    const base = { gameId: 'g', studioId: 's', impressionsByCountry: { IN: 100 } };
    expect(effectiveShare(game(base), '2026-10')).toBeCloseTo(0.7);
    expect(effectiveShare(game({ ...base, refImpressions: 100 }), '2026-10')).toBeCloseTo(0.85);
    expect(effectiveShare(game({ ...base, refImpressions: 50 }), '2026-10')).toBeCloseTo(0.775);
    // Exclusive for the whole month.
    expect(effectiveShare(game({ ...base, riseStartedAt: '2026-09-15T00:00:00Z', exclusiveUntil: '2026-11-14T00:00:00Z' }), '2026-10')).toBeCloseTo(0.8);
    // Exclusive for the first 10 of 31 days.
    expect(daysInWindow('2026-10', '2026-09-01T00:00:00Z', '2026-10-11T00:00:00Z')).toEqual({ inside: 10, total: 31 });
  });

  it('produces correct statements per studio', () => {
    const games: GameImpressions[] = [
      game({ gameId: 'a1', studioId: 'alpha', impressionsByCountry: { IN: 3000, US: 0 } }),
      game({ gameId: 'a2', studioId: 'alpha', impressionsByCountry: { IN: 1000, US: 1000 }, refImpressions: 1000 }),
      game({ gameId: 'b1', studioId: 'beta', impressionsByCountry: { US: 3000 } }),
    ];
    const run = computeRevenue({
      month: '2026-10',
      currency: 'USD',
      rows: parseRevenueCsv(CSV).rows,
      games,
      countryWeights: { IN: 0.12, US: 1, default: 0.2 },
      carry: { beta: 1000 },
    });
    // Net: IN 920.00, US 480.00, ALL 100.00 = 1,500.00
    expect(run.totals.net).toBe(150_000);
    expect(run.totals.unattributed).toBe(0);

    // IN 920.00 split 3000:1000 → a1 690.00, a2 230.00. US 480.00 split 1000:3000 → a2 120.00, b1 360.00.
    // ALL 100.00 by impressions × weight: a1 360, a2 1120, b1 3000 (total 4480).
    const alpha = run.statements.find((s) => s.studioId === 'alpha')!;
    const beta = run.statements.find((s) => s.studioId === 'beta')!;
    const a1 = alpha.games.find((g) => g.gameId === 'a1')!;
    const a2 = alpha.games.find((g) => g.gameId === 'a2')!;
    const b1 = beta.games[0]!;
    expect(a1.net).toBe(69_000 + 804); // 690.00 + 8.04 (100 × 360 / 4480 = 8.0357 → largest remainder)
    expect(a2.net).toBe(23_000 + 12_000 + 2500); // 230 + 120 + 25.00
    expect(b1.net).toBe(36_000 + 6696); // 360 + 66.96
    expect(a1.net + a2.net + b1.net).toBe(run.totals.net);

    // a2 earned half of its impressions through the referral link: (0.85 + 0.7) / 2 = 77.5%.
    expect(a1.earned).toBe(Math.round(69_804 * 0.7));
    expect(a2.earned).toBe(Math.round(37_500 * 0.775));
    expect(alpha.earned).toBe(a1.earned + a2.earned);
    expect(alpha.payoutDue).toBe(alpha.earned);
    expect(alpha.belowThreshold).toBe(false);

    // Beta carries 10.00 over from last month.
    expect(beta.earned).toBe(Math.round(42_696 * 0.7));
    expect(beta.payoutDue).toBe(beta.earned + 1000);
  });

  it('rolls small balances over and reports revenue with no impressions as unattributed', () => {
    const run = computeRevenue({
      month: '2026-10',
      currency: 'INR',
      rows: [
        { country: 'IN', gross: 100, refunds: 0, invalidTraffic: 0 },
        { country: 'JP', gross: 40, refunds: 0, invalidTraffic: 0 },
      ],
      games: [game({ gameId: 'x', studioId: 'small', impressionsByCountry: { IN: 10 } })],
      countryWeights: { default: 1 },
      carry: {},
    });
    expect(run.totals.unattributed).toBe(4000);
    const s = run.statements[0]!;
    expect(s.payoutDue).toBe(7000); // ₹70.00
    expect(s.belowThreshold).toBe(true); // under ₹2,000
  });
  it('pays creators 10% of the net their players brought, without touching the developer share', () => {
    const run = computeRevenue({
      month: '2026-10',
      currency: 'INR',
      rows: [{ country: 'IN', gross: 10000, refunds: 0, invalidTraffic: 0 }],
      games: [
        game({ gameId: 'g1', studioId: 's1', impressionsByCountry: { IN: 100 }, creatorImpressions: { c1: 40, c2: 10 } }),
        game({ gameId: 'g2', studioId: 's2', impressionsByCountry: { IN: 100 } }),
      ],
      countryWeights: {},
      carry: {},
      creatorCarry: { c3: 50_000 },
    });
    // g1 gets half the net: ₹5,000. c1 brought 40% of its impressions: 10% of 40% of ₹5,000 = ₹200.
    const c1 = run.creatorStatements.find((c) => c.creatorId === 'c1')!;
    expect(c1.earned).toBe(20_000);
    // ₹200 is under the ₹2,000 payout threshold, so it rolls over like a studio balance.
    expect(c1.belowThreshold).toBe(true);
    const c2 = run.creatorStatements.find((c) => c.creatorId === 'c2')!;
    expect(c2.earned).toBe(5_000);
    expect(c2.belowThreshold).toBe(true);
    // A creator with only a carried balance keeps it.
    expect(run.creatorStatements.find((c) => c.creatorId === 'c3')!.payoutDue).toBe(50_000);
    // The developer still earns 70% of the game's net.
    expect(run.statements.find((s) => s.studioId === 's1')!.earned).toBe(350_000);
  });
});
