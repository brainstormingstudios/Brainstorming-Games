// POST /functions/v1/billing
//   { action: 'subscribe', plan: 'plus' | 'max' }       → a Razorpay subscription for Checkout
//   { action: 'cancel' }                                → stop renewal at the end of the period
//   { action: 'boost', gameId, pkg }                    → a Razorpay order for a Boost
//   { action: 'verify', plan: 'month' | 'year' }        → a Razorpay order for the Verified tick
//   { action: 'confirm', reference }                    → whether the webhook has recorded it
// Nothing here grants anything: memberships and Boosts start only when razorpay-webhook receives
// Razorpay's signed confirmation.
import { adminClient, json, preflight, requireUser } from '../_shared/http.ts';
import { razorpay, razorpayKeyId } from '../_shared/razorpay.ts';

const PRICES = { plus: 9900, max: 19900 } as const;
const BOOSTS = { spotlight: 49900, push: 149900, launch: 399900 } as const;
const PLAN_ENV = { plus: 'RAZORPAY_PLAN_PLUS', max: 'RAZORPAY_PLAN_MAX' } as const;
/** The Verified tick for studios: ₹49 a month or ₹399 a year (migration 0027). */
const VERIFIED = { month: { paise: 4900, days: 30 }, year: { paise: 39900, days: 365 } } as const;

/** The studio's main owner or a co-owner (migration 0028). */
async function managesStudio(db: ReturnType<typeof adminClient>, studioId: string, ownerId: string | undefined, userId: string): Promise<boolean> {
  if (ownerId === userId) return true;
  const { data } = await db.from('studio_members').select('user_id').eq('studio_id', studioId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = await requireUser(req);
  if (!user) return json(req, 401, { error: 'login_required' });
  const body = (await req.json().catch(() => ({}))) as { action?: string; plan?: string; gameId?: string; pkg?: string; reference?: string };
  const db = adminClient();
  const { data: profile } = await db.from('profiles').select('username, display_name, is_minor, premium_until, razorpay_subscription_id, banned_at').eq('id', user.id).maybeSingle();
  if (!profile?.username || profile.banned_at) return json(req, 403, { error: 'not_allowed' });
  const { data: limited } = await db.rpc('take_token_public', { p_key: `billing:${user.id}`, p_capacity: 10, p_window_seconds: 600 });
  if (limited === false) return json(req, 429, { error: 'rate_limited' });
  const prefill = { email: user.email ?? '', name: profile.display_name || profile.username };
  // Sales are open in India only for now (lib/domain/market.ts). Razorpay also refuses foreign
  // cards while international payments are switched off in its dashboard.
  const country = (req.headers.get('cf-ipcountry') ?? '').toUpperCase();
  if ((body.action === 'subscribe' || body.action === 'boost' || body.action === 'verify') && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'IN') {
    return json(req, 403, { error: 'country_unavailable', message: 'Payments are available in India only for now.' });
  }

  try {
    if (body.action === 'subscribe') {
      const plan = body.plan === 'max' ? 'max' : body.plan === 'plus' ? 'plus' : null;
      if (!plan) return json(req, 400, { error: 'invalid' });
      if (profile.is_minor) return json(req, 403, { error: 'not_allowed', message: 'Memberships are for adults.' });
      const sub = await razorpay<{ id: string }>('subscriptions', {
        plan_id: Deno.env.get(PLAN_ENV[plan]),
        total_count: 120,
        customer_notify: 1,
        notes: { user_id: user.id, plan },
      });
      await db.from('payments').insert({ user_id: user.id, kind: 'premium', what: `Brainstorming ${plan === 'max' ? 'Max' : 'Plus'}`, amount_paise: PRICES[plan], status: 'pending', provider_ref: sub.id });
      return json(req, 200, { mode: 'razorpay', keyId: razorpayKeyId(), subscriptionId: sub.id, amount: PRICES[plan], description: `Brainstorming ${plan === 'max' ? 'Max' : 'Plus'}, monthly`, prefill });
    }
    if (body.action === 'cancel') {
      if (!profile.razorpay_subscription_id) return json(req, 404, { error: 'not_found' });
      await razorpay(`subscriptions/${profile.razorpay_subscription_id}/cancel`, { cancel_at_cycle_end: 1 });
      await db.from('profiles').update({ premium_auto_renew: false }).eq('id', user.id);
      return json(req, 200, { ok: true });
    }
    if (body.action === 'boost') {
      const pkg = body.pkg as keyof typeof BOOSTS;
      if (!(pkg in BOOSTS)) return json(req, 400, { error: 'invalid' });
      const { data: game } = await db.from('games').select('id, title, status, studio_id, studios!inner(owner_id)').eq('id', body.gameId ?? '').maybeSingle();
      if (!game || !(await managesStudio(db, game.studio_id, (game.studios as { owner_id?: string }).owner_id, user.id))) return json(req, 404, { error: 'not_found' });
      if (!['spark', 'rise', 'featured'].includes(game.status)) return json(req, 400, { error: 'invalid', message: 'Only a live game can be boosted.' });
      const { data: running } = await db.from('boosts').select('id').eq('game_id', game.id).in('status', ['paid', 'live']).gt('ends_at', new Date().toISOString()).limit(1);
      if (running?.length) return json(req, 409, { error: 'conflict', message: 'This game already has a Boost running.' });
      const order = await razorpay<{ id: string }>('orders', { amount: BOOSTS[pkg], currency: 'INR', notes: { user_id: user.id, game_id: game.id, pkg } });
      await db.from('boosts').insert({ game_id: game.id, studio_id: game.studio_id, package: pkg, amount_paise: BOOSTS[pkg], status: 'pending_payment', razorpay_order_id: order.id });
      await db.from('payments').insert({ user_id: user.id, kind: 'boost', what: `Boost ${pkg}: ${game.title}`, amount_paise: BOOSTS[pkg], status: 'pending', provider_ref: order.id });
      return json(req, 200, { mode: 'razorpay', keyId: razorpayKeyId(), orderId: order.id, amount: BOOSTS[pkg], description: `Boost: ${game.title}`, prefill });
    }
    if (body.action === 'verify') {
      const plan = body.plan === 'year' ? 'year' : body.plan === 'month' ? 'month' : null;
      if (!plan) return json(req, 400, { error: 'invalid' });
      const { data: member } = await db.from('studio_members').select('studio_id').eq('user_id', user.id).maybeSingle();
      const { data: studio } = member
        ? await db.from('studios').select('id, name, is_first_party, suspended_at').eq('id', member.studio_id).maybeSingle()
        : await db.from('studios').select('id, name, is_first_party, suspended_at').eq('owner_id', user.id).maybeSingle();
      if (!studio || studio.suspended_at) return json(req, 403, { error: 'not_allowed' });
      if (studio.is_first_party) return json(req, 400, { error: 'invalid', message: 'The house studio is always official.' });
      const price = VERIFIED[plan];
      const order = await razorpay<{ id: string }>('orders', { amount: price.paise, currency: 'INR', notes: { user_id: user.id, studio_id: studio.id, verified: plan } });
      await db.from('payments').insert({ user_id: user.id, kind: 'verified', what: `Verified tick (${plan === 'year' ? '1 year' : '1 month'}): ${studio.name}`, amount_paise: price.paise, status: 'pending', provider_ref: order.id });
      return json(req, 200, { mode: 'razorpay', keyId: razorpayKeyId(), orderId: order.id, amount: price.paise, description: `Verified tick: ${studio.name}`, prefill });
    }
    if (body.action === 'confirm') {
      const { data } = await db.from('payments').select('status').eq('user_id', user.id).eq('provider_ref', body.reference ?? '').eq('status', 'paid').limit(1);
      return json(req, 200, { paid: Boolean(data?.length) });
    }
    return json(req, 400, { error: 'invalid' });
  } catch (err) {
    console.error(err);
    return json(req, 502, { error: 'unavailable' });
  }
});
