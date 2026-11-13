import type { Currency, GameImpressions } from '@/lib/domain/revenue';
import { validatePayoutProfile } from '@/lib/domain/payoutProfile';
import { emitTopic } from '../bus';
import { RepoError, type PayoutRow, type RevenueMonthRow, type RevenueRepo } from '../repo';
import { callFunction } from './account';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Row = Record<string, unknown>;
const check = <T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T => {
  if (error) throw toRepoError(error);
  return data;
};
// Postgres stores money as numeric(14,2) in major units; the engine works in minor units.
const minor = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const major = (v: number) => Math.round(v) / 100;

function toMonth(r: Row): RevenueMonthRow {
  const payoutDue = minor(r.payout_due);
  const carryIn = minor(r.carry_in);
  return {
    studioId: String(r.studio_id),
    studioName: String((r.studios as { name?: string } | null)?.name ?? ''),
    month: String(r.month),
    currency: r.currency as Currency,
    gross: minor(r.gross),
    net: minor(r.net),
    earned: payoutDue - carryIn,
    sharePct: Number(r.share_pct ?? 0),
    carryIn,
    payoutDue,
    status: r.status as RevenueMonthRow['status'],
    games: (r.breakdown as RevenueMonthRow['games']) ?? [],
  };
}

function toPayout(r: Row): PayoutRow {
  return {
    id: String(r.id),
    studioId: String(r.studio_id),
    studioName: String((r.studios as { name?: string } | null)?.name ?? ''),
    amount: minor(r.amount),
    currency: r.currency as Currency,
    method: r.method as PayoutRow['method'],
    reference: String(r.reference ?? ''),
    months: (r.months as string[]) ?? [],
    paidAt: String(r.paid_at),
  };
}

export const supabaseRevenue: RevenueRepo = {
  async inputs(month) {
    const data = check(await getSupabase().rpc('admin_revenue_inputs', { p_month: month })) as {
      games: (Omit<GameImpressions, 'impressionsByCountry'> & { impressionsByCountry: Record<string, number | string> })[];
      weights: Record<string, number>;
      carry: Record<string, number>;
    };
    return {
      games: (data.games ?? []).map((g) => ({
        ...g,
        refImpressions: Number(g.refImpressions ?? 0),
        impressionsByCountry: Object.fromEntries(Object.entries(g.impressionsByCountry ?? {}).map(([c, n]) => [c, Number(n)])),
      })),
      weights: data.weights ?? { default: 1 },
      carry: Object.fromEntries(Object.entries(data.carry ?? {}).map(([k, v]) => [k, minor(v)])),
    };
  },
  async finalise(run, rows, fxInr) {
    check(
      await getSupabase().rpc('admin_write_revenue', {
        p_month: run.month,
        p_import: { currency: run.currency, fxInr, rows },
        p_statements: run.statements.map((s) => ({
          studioId: s.studioId,
          gross: major(s.gross),
          net: major(s.net),
          sharePct: s.sharePct,
          payoutDue: major(s.payoutDue),
          carryIn: major(s.carryIn),
          belowThreshold: s.belowThreshold,
          games: s.games,
        })),
      }),
    );
    emitTopic('revenue');
  },
  async months() {
    const data = check(await getSupabase().from('revenue_months').select('*, studios(name)').order('month', { ascending: false }));
    return (data ?? []).map((r) => toMonth(r as Row));
  },
  async recordPayout(studioId, months, method, reference) {
    check(await getSupabase().rpc('admin_record_payout', { p_studio: studioId, p_months: months, p_method: method, p_reference: reference }));
    emitTopic('revenue');
  },
  async payouts() {
    const data = check(await getSupabase().from('payouts').select('*, studios(name)').order('paid_at', { ascending: false }));
    return (data ?? []).map((r) => toPayout(r as Row));
  },
  async myStatements() {
    return supabaseRevenue.months();
  },
  async myPayouts() {
    return supabaseRevenue.payouts();
  },
  async payoutProfile() {
    const r = await callFunction<{ profile: { method: PayoutRow['method']; currency: Currency; summary: string; updatedAt: string } | null }>('payout-profile', { action: 'get' });
    return r.profile;
  },
  async savePayoutProfile(input) {
    const error = validatePayoutProfile(input);
    if (error) throw new RepoError('invalid', error);
    await callFunction('payout-profile', { action: 'save', profile: input });
    emitTopic('revenue');
  },
};
