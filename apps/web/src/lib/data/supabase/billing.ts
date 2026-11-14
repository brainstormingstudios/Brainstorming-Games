import type { BoostPackage, BoostStatus } from '@/lib/domain/premium';
import { PLANS, activePlan, type PremiumPlan } from '@/lib/domain/premium';
import { emitTopic } from '../bus';
import type { BoostOrder, CheckoutIntent, EmailRow, PaymentRow } from '../billingTypes';
import { RepoError, type BillingRepo } from '../repo';
import { WALLPAPERS } from '../wallpapers';
import { callFunction } from './account';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Row = Record<string, unknown>;
const check = <T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T => {
  if (error) throw toRepoError(error);
  return data;
};

async function me(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new RepoError('login_required');
  return id;
}

function toOrder(r: Row): BoostOrder {
  const game = (r.games as { title?: string; slug?: string } | null) ?? {};
  return {
    id: String(r.id),
    gameId: String(r.game_id),
    gameTitle: String(game.title ?? ''),
    gameSlug: String(game.slug ?? ''),
    studioName: String((r.studios as { name?: string } | null)?.name ?? ''),
    package: r.package as BoostPackage,
    amount: Number(r.amount_paise ?? 0),
    status: r.status as BoostStatus,
    shortUrls: (r.short_urls as string[]) ?? [],
    reelUrls: (r.reel_urls as string[]) ?? [],
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    heroUntil: (r.hero_until as string | null) ?? null,
    notes: String(r.notes ?? ''),
    createdAt: String(r.created_at),
  };
}

const BOOST_SELECT = '*, games(title, slug), studios(name)';

/** Premium and Boost against Supabase and Razorpay. Nothing is granted here: only the webhook does that. */
export const supabaseBilling: BillingRepo = {
  async premiumStatus() {
    const id = await me().catch(() => null);
    if (!id) return { premium: null, passesLeft: 0, passes: [], canBuy: false };
    const db = getSupabase();
    const profile = check(await db.from('profiles').select('username, is_minor, premium_plan, premium_until, premium_auto_renew, premium_from_pass').eq('id', id).maybeSingle<Row>());
    const passes = (check(await db.from('guest_passes').select('code, created_at, redeemed_by').eq('from_user', id).order('created_at', { ascending: false })) ?? []) as Row[];
    const premium =
      profile?.premium_plan && profile.premium_until
        ? { plan: profile.premium_plan as PremiumPlan, until: String(profile.premium_until), autoRenew: Boolean(profile.premium_auto_renew), fromPass: Boolean(profile.premium_from_pass) }
        : null;
    const plan = activePlan(premium);
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
    const usedThisMonth = passes.filter((p) => String(p.created_at) >= monthStart).length;
    return {
      premium,
      passesLeft: plan && !premium?.fromPass ? Math.max(0, PLANS[plan].guestPasses - usedThisMonth) : 0,
      passes: passes.map((p) => ({ code: String(p.code), createdAt: String(p.created_at), redeemed: Boolean(p.redeemed_by) })),
      canBuy: Boolean(profile?.username) && !profile?.is_minor,
    };
  },
  async subscribe(plan) {
    return callFunction<CheckoutIntent>('billing', { action: 'subscribe', plan });
  },
  async cancel() {
    await callFunction('billing', { action: 'cancel' });
    emitTopic('session', { local: true });
  },
  async completeTestPayment() {
    throw new RepoError('not_allowed', 'Test payments only exist on the local build.');
  },
  async confirmPayment(reference) {
    // The webhook usually lands within seconds of Checkout closing.
    for (let i = 0; i < 10; i++) {
      const { paid } = await callFunction<{ paid: boolean }>('billing', { action: 'confirm', reference });
      if (paid) {
        emitTopic('session', { local: true });
        emitTopic('revenue');
        return true;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  },
  async wallpapers() {
    const status = await supabaseBilling.premiumStatus();
    if (!activePlan(status.premium)) throw new RepoError('not_allowed');
    return WALLPAPERS;
  },
  async createGuestPass() {
    const code = check(await getSupabase().rpc('create_guest_pass')) as string;
    emitTopic('session', { local: true });
    return { code };
  },
  async redeemGuestPass(code) {
    check(await getSupabase().rpc('redeem_guest_pass', { p_code: code }));
    emitTopic('session', { local: true });
  },
  async orderBoost(gameId, pkg) {
    return callFunction<CheckoutIntent>('billing', { action: 'boost', gameId, pkg });
  },
  async myBoosts() {
    const rows = (check(await getSupabase().from('boosts').select(BOOST_SELECT).neq('status', 'pending_payment').order('created_at', { ascending: false })) ?? []) as Row[];
    return rows.map(toOrder);
  },
  async boosts() {
    const rows = (check(await getSupabase().from('boosts').select(BOOST_SELECT).neq('status', 'pending_payment').order('created_at', { ascending: false }).limit(300)) ?? []) as Row[];
    return rows.map(toOrder);
  },
  async updateBoost(id, patch) {
    check(
      await getSupabase().rpc('admin_update_boost', {
        p_id: id,
        p_status: patch.status ?? null,
        p_short_urls: patch.shortUrls ?? null,
        p_reel_urls: patch.reelUrls ?? null,
        p_notes: patch.notes ?? null,
      }),
    );
    emitTopic('revenue');
  },
  async payments() {
    const rows = (check(await getSupabase().from('payments').select('*').order('created_at', { ascending: false }).limit(300)) ?? []) as Row[];
    return rows.map(
      (r): PaymentRow => ({
        id: String(r.id),
        kind: r.kind as PaymentRow['kind'],
        what: String(r.what),
        amount: Number(r.amount_paise ?? 0),
        status: r.status as PaymentRow['status'],
        provider: 'razorpay',
        reference: String(r.provider_payment_id ?? r.provider_ref ?? ''),
        who: String(r.user_id ?? ''),
        createdAt: String(r.created_at),
      }),
    );
  },
  async emails() {
    const rows = (check(await getSupabase().from('email_outbox').select('id, to_email, template, status, error, created_at').order('created_at', { ascending: false }).limit(300)) ?? []) as Row[];
    return rows.map(
      (r): EmailRow => ({
        id: String(r.id),
        to: String(r.to_email),
        template: String(r.template),
        subject: String(r.template).replace(/_/g, ' '),
        status: r.status as EmailRow['status'],
        error: (r.error as string | null) ?? null,
        createdAt: String(r.created_at),
      }),
    );
  },
};
