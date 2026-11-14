/**
 * The revenue engine. Each month an admin uploads the ad revenue we received (a CSV); this splits
 * it across games and studios and produces one statement per studio.
 *
 *   net          = gross − refunds − invalid traffic
 *   per country  a country row's net is shared across games by their ad impressions in that
 *                country; an "ALL" row is shared by impressions × country weight
 *   share        85% of net for impressions from the studio's referral link, 80% during the
 *                60-day web-exclusive window after Full Launch, 70% otherwise
 *   payout       monthly; amounts under ₹2,000 / $25 roll over to the next month
 *
 * Money is handled in integer minor units (paise / cents) and split with the largest-remainder
 * method, so the parts always add up exactly to the whole.
 */

export const SHARES = { standard: 0.7, referral: 0.85, exclusive: 0.8 } as const;
export const THRESHOLD_MINOR = { INR: 200_000, USD: 2_500 } as const;
export type Currency = keyof typeof THRESHOLD_MINOR;

export interface RevenueRow {
  /** ISO country code, or "ALL" for revenue not broken down by country. */
  country: string;
  gross: number;
  refunds: number;
  invalidTraffic: number;
}

export interface GameImpressions {
  gameId: string;
  title: string;
  studioId: string;
  studioName: string;
  /** Ad impressions this month, per country. */
  impressionsByCountry: Record<string, number>;
  /** Of those, impressions from players who came through the studio's referral link. */
  refImpressions: number;
  /** When the web-exclusive window ends (ISO), or null. */
  exclusiveUntil: string | null;
  riseStartedAt: string | null;
}

export interface GameLine {
  gameId: string;
  title: string;
  impressions: number;
  /** Net revenue attributed to the game, minor units. */
  net: number;
  /** Effective developer share (0 to 1) after mixing referral, exclusive and standard. */
  share: number;
  /** Developer earnings, minor units. */
  earned: number;
}

export interface StudioStatement {
  studioId: string;
  studioName: string;
  month: string;
  currency: Currency;
  /** Gross attributed to the studio's games before deductions, minor units. */
  gross: number;
  net: number;
  earned: number;
  /** Rolled-over balance from earlier months, minor units. */
  carryIn: number;
  /** earned + carryIn. */
  payoutDue: number;
  belowThreshold: boolean;
  sharePct: number;
  games: GameLine[];
}

export interface RevenueRun {
  month: string;
  currency: Currency;
  totals: { gross: number; refunds: number; invalidTraffic: number; net: number; unattributed: number };
  statements: StudioStatement[];
}

const toMinor = (v: number) => Math.round(v * 100);

/** Splits `total` (integer) by `weights`, so the parts add up to `total` exactly. */
export function splitLargestRemainder(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/** Days of `month` (YYYY-MM) that fall inside [from, until). */
export function daysInWindow(month: string, from: string | null, until: string | null): { inside: number; total: number } {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const total = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (!until) return { inside: 0, total };
  const a = Math.max(start.getTime(), from ? new Date(from).getTime() : start.getTime());
  const b = Math.min(end.getTime(), new Date(until).getTime());
  return { inside: Math.max(0, Math.round((b - a) / 86_400_000)), total };
}

/** The developer's share of one game's revenue this month (0 to 1). */
export function effectiveShare(game: GameImpressions, month: string): number {
  const total = Object.values(game.impressionsByCountry).reduce((a, b) => a + b, 0);
  const refFraction = total > 0 ? Math.min(1, game.refImpressions / total) : 0;
  const { inside, total: days } = daysInWindow(month, game.riseStartedAt, game.exclusiveUntil);
  const exclusiveFraction = days > 0 ? inside / days : 0;
  const nonRef = exclusiveFraction * SHARES.exclusive + (1 - exclusiveFraction) * SHARES.standard;
  return refFraction * SHARES.referral + (1 - refFraction) * nonRef;
}

export interface RevenueInput {
  month: string;
  currency: Currency;
  rows: RevenueRow[];
  games: GameImpressions[];
  /** Weight of an impression per country for "ALL" rows (missing countries use `default`). */
  countryWeights: Record<string, number>;
  /** Rolled-over balance per studio, minor units. */
  carry: Record<string, number>;
}

export function computeRevenue(input: RevenueInput): RevenueRun {
  const { month, currency, rows, games, countryWeights, carry } = input;
  const grossByGame = new Map<string, number>();
  const netByGame = new Map<string, number>();
  let unattributed = 0;
  const totals = { gross: 0, refunds: 0, invalidTraffic: 0, net: 0, unattributed: 0 };

  for (const row of rows) {
    const gross = toMinor(row.gross);
    const net = Math.max(0, gross - toMinor(row.refunds) - toMinor(row.invalidTraffic));
    totals.gross += gross;
    totals.refunds += toMinor(row.refunds);
    totals.invalidTraffic += toMinor(row.invalidTraffic);
    totals.net += net;
    const country = row.country.toUpperCase();
    const weights = games.map((g) => {
      if (country === 'ALL') {
        return Object.entries(g.impressionsByCountry).reduce(
          (n, [c, imp]) => n + imp * (countryWeights[c] ?? countryWeights.default ?? 1),
          0,
        );
      }
      return g.impressionsByCountry[country] ?? 0;
    });
    if (weights.every((w) => w <= 0)) {
      unattributed += net;
      continue;
    }
    const netParts = splitLargestRemainder(net, weights);
    const grossParts = splitLargestRemainder(gross, weights);
    games.forEach((g, i) => {
      netByGame.set(g.gameId, (netByGame.get(g.gameId) ?? 0) + netParts[i]!);
      grossByGame.set(g.gameId, (grossByGame.get(g.gameId) ?? 0) + grossParts[i]!);
    });
  }
  totals.unattributed = unattributed;

  const byStudio = new Map<string, StudioStatement>();
  for (const g of games) {
    const net = netByGame.get(g.gameId) ?? 0;
    // Whole basis points, so 77.5% is exactly 7750 and never 0.77499…
    const bps = Math.round(effectiveShare(g, month) * 10_000);
    const line: GameLine = {
      gameId: g.gameId,
      title: g.title,
      impressions: Object.values(g.impressionsByCountry).reduce((a, b) => a + b, 0),
      net,
      share: bps / 10_000,
      earned: Math.round((net * bps) / 10_000),
    };
    let s = byStudio.get(g.studioId);
    if (!s) {
      s = {
        studioId: g.studioId,
        studioName: g.studioName,
        month,
        currency,
        gross: 0,
        net: 0,
        earned: 0,
        carryIn: carry[g.studioId] ?? 0,
        payoutDue: 0,
        belowThreshold: false,
        sharePct: 0,
        games: [],
      };
      byStudio.set(g.studioId, s);
    }
    s.gross += grossByGame.get(g.gameId) ?? 0;
    s.net += net;
    s.earned += line.earned;
    s.games.push(line);
  }
  const statements = [...byStudio.values()].map((s) => {
    const payoutDue = s.earned + s.carryIn;
    return {
      ...s,
      payoutDue,
      belowThreshold: payoutDue < THRESHOLD_MINOR[currency],
      sharePct: s.net > 0 ? Math.round((s.earned / s.net) * 10_000) / 100 : 0,
    };
  });
  return { month, currency, totals, statements: statements.sort((a, b) => b.payoutDue - a.payoutDue) };
}

export interface CsvParseResult {
  rows: RevenueRow[];
  errors: string[];
}

/**
 * Parses the monthly revenue CSV. Columns (header row required, any order):
 * `country,gross,refunds,invalid_traffic`. Refunds and invalid traffic may be omitted.
 */
export function parseRevenueCsv(text: string): CsvParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ['The CSV needs a header row and at least one data row.'] };
  const header = lines[0]!.toLowerCase().split(',').map((h) => h.trim().replace(/\s+/g, '_'));
  const col = (name: string) => header.indexOf(name);
  if (col('country') < 0 || col('gross') < 0) return { rows: [], errors: ['The header must include "country" and "gross".'] };
  const rows: RevenueRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const num = (name: string) => {
      const idx = col(name);
      if (idx < 0) return 0;
      const v = Number((cells[idx] ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(v) ? v : Number.NaN;
    };
    const country = (cells[col('country')] ?? '').toUpperCase();
    const row = { country, gross: num('gross'), refunds: num('refunds'), invalidTraffic: num('invalid_traffic') };
    if (!/^([A-Z]{2}|ALL|ZZ)$/.test(country)) errors.push(`Line ${i + 2}: "${country}" is not a country code or ALL.`);
    else if ([row.gross, row.refunds, row.invalidTraffic].some((v) => Number.isNaN(v) || v < 0)) errors.push(`Line ${i + 2}: amounts must be positive numbers.`);
    else rows.push(row);
  });
  return { rows, errors };
}

export function formatMoney(minor: number, currency: Currency, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}
