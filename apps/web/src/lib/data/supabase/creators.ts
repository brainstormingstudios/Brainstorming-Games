import type { Currency } from '@/lib/domain/revenue';
import { validatePayoutProfile } from '@/lib/domain/payoutProfile';
import { emitTopic } from '../bus';
import type { AdminCreatorRow, Creator, CreatorMonthRow, CreatorPayoutRow, CreatorStats } from '../creatorTypes';
import { getAnonId } from '../local';
import { RepoError, type CreatorRepo, type PayoutRow } from '../repo';
import { callFunction } from './account';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Row = Record<string, unknown>;
const check = <T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T => {
  if (error) throw toRepoError(error);
  return data;
};
const minor = (v: unknown) => Math.round(Number(v ?? 0) * 100);

function toCreator(r: Row): Creator {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    handle: String(r.handle),
    displayName: String(r.display_name ?? ''),
    channels: (r.channels as Creator['channels']) ?? [],
    about: String(r.about ?? ''),
    status: r.status as Creator['status'],
    reviewNote: (r.review_note as string | null) ?? null,
    createdAt: String(r.created_at),
    approvedAt: (r.approved_at as string | null) ?? null,
  };
}

function toMonth(r: Row): CreatorMonthRow {
  return {
    creatorId: String(r.creator_id),
    handle: String(r.handle ?? (r.creators as { handle?: string } | null)?.handle ?? ''),
    month: String(r.month),
    currency: r.currency as Currency,
    earned: minor(r.earned),
    carryIn: minor(r.carry_in),
    payoutDue: minor(r.payout_due),
    status: r.status as CreatorMonthRow['status'],
    games: (r.breakdown as CreatorMonthRow['games']) ?? [],
  };
}

function toPayout(r: Row): CreatorPayoutRow {
  return {
    id: String(r.id),
    creatorId: String(r.creator_id),
    handle: String(r.handle ?? (r.creators as { handle?: string } | null)?.handle ?? ''),
    amount: minor(r.amount),
    currency: r.currency as Currency,
    method: r.method as PayoutRow['method'],
    reference: String(r.reference ?? ''),
    months: (r.months as string[]) ?? [],
    paidAt: String(r.paid_at),
  };
}

async function myRow(): Promise<Row | null> {
  const { data: session } = await getSupabase().auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  return (check(await getSupabase().from('creators').select('*').eq('user_id', uid).maybeSingle()) as Row | null) ?? null;
}

export const supabaseCreators: CreatorRepo = {
  async mine() {
    const r = await myRow();
    return r ? toCreator(r) : null;
  },
  async handleAvailable(handle) {
    return Boolean(check(await getSupabase().rpc('creator_handle_available', { p_handle: handle })));
  },
  async apply(input) {
    if (!input.agreed) throw new RepoError('invalid', 'Please accept the Creator Agreement.');
    const data = check(
      await getSupabase()
        .rpc('creator_apply', { p_handle: input.handle, p_display_name: input.displayName, p_channels: input.channels, p_about: input.about, p_agreed: input.agreed })
        .single(),
    );
    emitTopic('creators');
    return toCreator(data as Row);
  },
  async recordVisit(handle) {
    await getSupabase().rpc('record_creator_visit', { p_handle: handle, p_anon_id: getAnonId() });
  },
  async stats(days) {
    return check(await getSupabase().rpc('creator_stats', { p_days: days })) as CreatorStats;
  },
  async myStatements() {
    const data = check(await getSupabase().from('creator_months').select('*, creators(handle)').order('month', { ascending: false }));
    return (data ?? []).map((r) => toMonth(r as Row));
  },
  async myPayouts() {
    const data = check(await getSupabase().from('creator_payouts').select('*, creators(handle)').order('paid_at', { ascending: false }));
    return (data ?? []).map((r) => toPayout(r as Row));
  },
  async payoutProfile() {
    const r = await callFunction<{ profile: Awaited<ReturnType<CreatorRepo['payoutProfile']>> }>('payout-profile', { action: 'get', scope: 'creator' });
    return r.profile;
  },
  async savePayoutProfile(input) {
    const error = validatePayoutProfile(input);
    if (error) throw new RepoError('invalid', error);
    await callFunction('payout-profile', { action: 'save', scope: 'creator', profile: input });
    emitTopic('creators');
  },
  async cancelPayoutChange() {
    await callFunction('payout-profile', { action: 'cancel', scope: 'creator' });
    emitTopic('creators');
  },
  async list(status) {
    const data = check(await getSupabase().rpc('admin_creators', { p_status: status })) as Row[] | null;
    return (data ?? []).map<AdminCreatorRow>((r) => ({ ...toCreator(r), username: (r.username as string | null) ?? null, email: (r.email as string | null) ?? null }));
  },
  async decide(creatorId, decision, note) {
    check(await getSupabase().rpc('admin_decide_creator', { p_creator: creatorId, p_decision: decision, p_note: note }));
    emitTopic('creators');
  },
  async months() {
    const data = check(await getSupabase().rpc('admin_creator_months')) as Row[] | null;
    return (data ?? []).map(toMonth);
  },
  async recordPayout(creatorId, months, method, reference) {
    check(await getSupabase().rpc('admin_record_creator_payout', { p_creator: creatorId, p_months: months, p_method: method, p_reference: reference }));
    emitTopic('creators');
  },
  async payouts() {
    const data = check(await getSupabase().rpc('admin_creator_payouts')) as Row[] | null;
    return (data ?? []).map(toPayout);
  },
};
