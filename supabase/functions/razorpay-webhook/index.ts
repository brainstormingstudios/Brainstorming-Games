// POST /functions/v1/razorpay-webhook  (set as the webhook URL in the Razorpay dashboard)
// Razorpay signs the raw body with RAZORPAY_WEBHOOK_SECRET; anything unsigned is refused. This is
// the only place a membership or a Boost is ever switched on.
import { adminClient } from '../_shared/http.ts';
import { hmacHex, sameHex } from '../_shared/razorpay.ts';

const DAY = 86_400_000;
const BOOST_DAYS = { spotlight: [3, 0], push: [7, 0], launch: [14, 2] } as const;
const ok = () => new Response('ok');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const raw = await req.text();
  const expected = await hmacHex(Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '', raw);
  if (!sameHex(expected, req.headers.get('x-razorpay-signature') ?? '')) return new Response('bad signature', { status: 401 });
  const event = JSON.parse(raw);
  const db = adminClient();

  // Memberships: a charge extends the paid period to the end of Razorpay's current cycle.
  if (event.event === 'subscription.charged' || event.event === 'subscription.activated') {
    const sub = event.payload.subscription.entity;
    const payment = event.payload.payment?.entity;
    const userId = sub.notes?.user_id;
    // Notes are set by our billing function; a subscription must also be one we created.
    const { data: known } = await db.from('payments').select('id').eq('provider_ref', sub.id).eq('user_id', userId ?? '').limit(1);
    if (!known?.length) return ok();
    const plan = sub.notes?.plan === 'max' ? 'max' : 'plus';
    if (!userId) return ok();
    const until = new Date((sub.current_end ?? Math.floor(Date.now() / 1000) + 30 * 86400) * 1000).toISOString();
    await db.from('profiles').update({ premium_plan: plan, premium_until: until, premium_auto_renew: true, premium_from_pass: false, razorpay_subscription_id: sub.id }).eq('id', userId);
    if (payment) {
      await db.from('payments').upsert(
        { user_id: userId, kind: 'premium', what: `Brainstorming ${plan === 'max' ? 'Max' : 'Plus'}`, amount_paise: payment.amount, status: 'paid', provider_ref: sub.id, provider_payment_id: payment.id },
        { onConflict: 'provider,provider_ref,provider_payment_id' },
      );
      await db.from('payments').delete().eq('provider_ref', sub.id).eq('status', 'pending');
    }
    if (event.event === 'subscription.activated') {
      const { data: u } = await db.auth.admin.getUserById(userId);
      await db.from('email_outbox').insert({
        to_email: u.user?.email,
        template: 'premium_welcome',
        data: { plan: plan === 'max' ? 'Max' : 'Plus', price: plan === 'max' ? '₹199 a month' : '₹99 a month', until: until.slice(0, 10) },
      });
    }
    return ok();
  }
  if (event.event === 'subscription.cancelled' || event.event === 'subscription.completed' || event.event === 'subscription.halted') {
    const sub = event.payload.subscription.entity;
    if (sub.notes?.user_id) await db.from('profiles').update({ premium_auto_renew: false }).eq('id', sub.notes.user_id);
    return ok();
  }

  // Boosts: a paid order starts the sponsored window.
  if (event.event === 'order.paid') {
    const order = event.payload.order.entity;
    const payment = event.payload.payment?.entity;
    const { data: boost } = await db.from('boosts').select('*').eq('razorpay_order_id', order.id).maybeSingle();
    if (!boost || boost.status !== 'pending_payment' || order.amount_paid < boost.amount_paise) return ok();
    const [days, heroDays] = BOOST_DAYS[boost.package as keyof typeof BOOST_DAYS];
    const now = Date.now();
    await db
      .from('boosts')
      .update({ status: 'paid', starts_at: new Date(now).toISOString(), ends_at: new Date(now + days * DAY).toISOString(), hero_until: heroDays ? new Date(now + heroDays * DAY).toISOString() : null })
      .eq('id', boost.id);
    await db.from('payments').update({ status: 'paid', provider_payment_id: payment?.id ?? null }).eq('provider_ref', order.id);
    const { data: game } = await db.from('games').select('title').eq('id', boost.game_id).single();
    const { data: studio } = await db.from('studios').select('contact_email, owner_id').eq('id', boost.studio_id).single();
    const owner = studio?.owner_id ? (await db.auth.admin.getUserById(studio.owner_id)).data.user?.email : null;
    await db.from('email_outbox').insert({
      to_email: owner ?? studio?.contact_email,
      template: 'boost_received',
      data: {
        game: game?.title,
        package: boost.package,
        amount: `₹${(boost.amount_paise / 100).toLocaleString('en-IN')}`,
        shorts: { spotlight: 1, push: 2, launch: 4 }[boost.package as 'push'],
        reels: { spotlight: 1, push: 2, launch: 4 }[boost.package as 'push'],
        window: `${days} days from ${new Date(now).toISOString().slice(0, 10)}`,
      },
    });
    return ok();
  }
  return ok();
});
