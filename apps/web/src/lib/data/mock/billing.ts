import { BOOSTS, GUEST_PASS, PLANS, activePlan, formatInr, type PremiumPlan } from '@/lib/domain/premium';
import { emitTopic } from '../bus';
import type { BoostOrder, CheckoutIntent, PaymentRow } from '../billingTypes';
import { PUBLIC_STATUSES } from '../types';
import type { BillingRepo } from '../repo';
import { currentMockUser, requireProfile, requireStaff, updateUser } from './auth';
import { audit, fail, mutateTable, newId, notify, nowIso, readTable, takeToken, type MockTables } from './db';
import { requireStudio } from './dev';
import { WALLPAPERS } from '../wallpapers';
import { sendMail } from './mail';

/**
 * Premium and Boost on the local data layer. Payments here are test payments: the checkout says
 * so and no money moves. On the live site the same flows go through Razorpay (supabase/billing.ts).
 */
const DAY = 86_400_000;
const PLAN_NAME: Record<PremiumPlan, string> = { plus: 'Plus', max: 'Max' };
const BOOST_NAME = { spotlight: 'Spotlight', push: 'Push', launch: 'Launch' } as const;
const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

function toOrder(b: MockTables['boosts'][number]): BoostOrder {
  const game = readTable('games').find((g) => g.id === b.gameId);
  const studio = readTable('studios').find((s) => s.id === b.studioId);
  return {
    id: b.id,
    gameId: b.gameId,
    gameTitle: game?.title ?? '',
    gameSlug: game?.slug ?? '',
    studioName: studio?.name ?? '',
    package: b.package,
    amount: b.amount,
    status: b.status,
    shortUrls: b.shortUrls,
    reelUrls: b.reelUrls,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    heroUntil: b.heroUntil,
    notes: b.notes,
    createdAt: b.createdAt,
  };
}

function recordPayment(row: Omit<PaymentRow, 'id' | 'createdAt'>): void {
  mutateTable('payments', (rows) => {
    rows.push({ ...row, id: newId(), createdAt: nowIso() });
  });
}

/** Marks a paid checkout as done: starts the membership or schedules the Boost. */
function fulfil(intent: MockTables['intents'][number]): void {
  const user = readTable('users').find((u) => u.id === intent.userId);
  if (!user) fail('not_found');
  if (intent.kind === 'premium') {
    const plan = intent.ref as PremiumPlan;
    // Upgrading or renewing extends from whichever is later: now, or the end of the current period.
    const from = Math.max(Date.now(), user.premiumUntil ? new Date(user.premiumUntil).getTime() : 0);
    const until = new Date(from + 30 * DAY).toISOString();
    updateUser(user.id, { premiumPlan: plan, premiumUntil: until, premiumAutoRenew: true, premiumFromPass: false });
    recordPayment({ kind: 'premium', what: `Brainstorming ${PLAN_NAME[plan]}, 1 month`, amount: intent.amount, status: 'paid', provider: 'test', reference: intent.id, who: user.username ?? user.email });
    notify(user.id, 'premium', `Welcome to ${PLAN_NAME[plan]}`, `Active until ${dateText(until)}.`, '/premium/');
    sendMail(user.email, 'premium_welcome', { plan: PLAN_NAME[plan], price: `${formatInr(PLANS[plan].price)} a month`, until: dateText(until) });
  } else {
    const def = BOOSTS[intent.pkg!];
    const start = Date.now();
    mutateTable('boosts', (rows) => {
      const b = rows.find((x) => x.id === intent.ref);
      if (!b) return;
      b.status = 'paid';
      b.startsAt = new Date(start).toISOString();
      b.endsAt = new Date(start + def.sponsoredDays * DAY).toISOString();
      b.heroUntil = def.heroDays ? new Date(start + def.heroDays * DAY).toISOString() : null;
    });
    const b = readTable('boosts').find((x) => x.id === intent.ref)!;
    const game = readTable('games').find((g) => g.id === b.gameId);
    recordPayment({ kind: 'boost', what: `Boost ${BOOST_NAME[b.package]}: ${game?.title ?? ''}`, amount: intent.amount, status: 'paid', provider: 'test', reference: intent.id, who: user.username ?? user.email });
    sendMail(user.email, 'boost_received', {
      game: game?.title,
      package: BOOST_NAME[b.package],
      amount: formatInr(b.amount),
      shorts: def.shorts,
      reels: def.reels,
      window: `${dateText(b.startsAt!)} to ${dateText(b.endsAt!)}`,
    });
    emitTopic('catalogue');
  }
  mutateTable('intents', (rows) => rows.filter((x) => x.id !== intent.id));
  emitTopic('session');
  emitTopic('revenue');
}

/** Mock side of app.grant_review_credit (0019): one free Spotlight Boost per late review. */
export function grantReviewCredit(versionId: string): void {
  if (readTable('boostCredits').some((c) => c.versionId === versionId)) return;
  const v = readTable('versions').find((x) => x.id === versionId);
  const g = v && readTable('games').find((x) => x.id === v.gameId);
  if (!g) return;
  mutateTable('boostCredits', (rows) => {
    rows.push({ id: newId(), studioId: g.studioId, versionId, createdAt: nowIso(), usedAt: null, usedBoostId: null });
  });
  notify(readTable('studios').find((s) => s.id === g.studioId)?.ownerId, 'boost', 'Your review took over 72 hours: a free Boost', `Sorry for the wait on ${g.title}. Your next Spotlight Boost is free: use it on the Boost page.`, '/dev/boost/');
  emitTopic('notifications');
}

function newIntent(kind: 'premium' | 'boost', userId: string, ref: string, amount: number, description: string, pkg?: keyof typeof BOOSTS): CheckoutIntent {
  const id = newId();
  mutateTable('intents', (rows) => {
    rows.push({ id, kind, userId, ref, pkg: pkg ?? null, amount, createdAt: nowIso() });
  });
  return { mode: 'test', intentId: id, amount, description };
}

export const mockBilling: BillingRepo = {
  async premiumStatus() {
    const user = currentMockUser();
    if (!user) return { premium: null, passesLeft: 0, passes: [], canBuy: false };
    const premium = user.premiumPlan && user.premiumUntil ? { plan: user.premiumPlan, until: user.premiumUntil, autoRenew: Boolean(user.premiumAutoRenew), fromPass: Boolean(user.premiumFromPass) } : null;
    const mine = readTable('guestPasses').filter((p) => p.fromUserId === user.id);
    const usedThisMonth = mine.filter((p) => p.createdAt >= monthStart()).length;
    const plan = activePlan(premium);
    return {
      premium,
      passesLeft: plan && !premium?.fromPass ? Math.max(0, PLANS[plan].guestPasses - usedThisMonth) : 0,
      passes: mine
        .slice()
        .reverse()
        .map((p) => ({ code: p.code, createdAt: p.createdAt, redeemed: Boolean(p.redeemedBy) })),
      canBuy: Boolean(user.username) && !user.isMinor,
    };
  },
  async subscribe(plan) {
    const user = requireProfile();
    if (user.isMinor) fail('not_allowed', 'Memberships are for adults. Ask a parent or guardian.');
    if (!takeToken(`checkout:${user.id}`, 10, 600_000)) fail('rate_limited');
    return newIntent('premium', user.id, plan, PLANS[plan].price, `Brainstorming ${PLAN_NAME[plan]}, 1 month`);
  },
  async cancel() {
    const user = requireProfile();
    if (!user.premiumUntil) fail('not_found');
    updateUser(user.id, { premiumAutoRenew: false });
    sendMail(user.email, 'premium_cancelled', { plan: PLAN_NAME[user.premiumPlan ?? 'plus'], until: dateText(user.premiumUntil) });
    emitTopic('session');
  },
  async completeTestPayment(intentId) {
    const user = requireProfile();
    const intent = readTable('intents').find((x) => x.id === intentId && x.userId === user.id);
    if (!intent) fail('not_found');
    fulfil(intent);
  },
  async confirmPayment() {
    return true;
  },
  async wallpapers() {
    const user = currentMockUser();
    const plan = activePlan(user?.premiumPlan && user.premiumUntil ? { plan: user.premiumPlan, until: user.premiumUntil, autoRenew: false, fromPass: false } : null);
    if (!plan) fail('not_allowed');
    return WALLPAPERS;
  },
  async createGuestPass() {
    const user = requireProfile();
    const status = await mockBilling.premiumStatus();
    if (status.passesLeft < 1) fail('not_allowed', 'No guest passes left this month.');
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    mutateTable('guestPasses', (rows) => {
      rows.push({ code, fromUserId: user.id, createdAt: nowIso(), redeemedBy: null, redeemedAt: null });
    });
    emitTopic('session');
    return { code };
  },
  async redeemGuestPass(code) {
    const user = requireProfile();
    if (!takeToken(`pass:${user.id}`, 5, 600_000)) fail('rate_limited');
    const pass = readTable('guestPasses').find((p) => p.code === code.trim().toUpperCase());
    if (!pass || pass.redeemedBy) fail('not_found', 'This pass is not valid or was already used.');
    if (pass.fromUserId === user.id) fail('invalid', 'Share this pass with a friend: it cannot be used on your own account.');
    if (user.premiumPlan) fail('conflict', 'Guest passes are for people who have not had a membership yet.');
    const until = new Date(Date.now() + GUEST_PASS.days * DAY).toISOString();
    mutateTable('guestPasses', (rows) => {
      const p = rows.find((x) => x.code === pass.code);
      if (p) Object.assign(p, { redeemedBy: user.id, redeemedAt: nowIso() });
    });
    updateUser(user.id, { premiumPlan: GUEST_PASS.plan, premiumUntil: until, premiumAutoRenew: false, premiumFromPass: true });
    sendMail(user.email, 'guest_pass_redeemed', { until: dateText(until) });
    emitTopic('session');
  },
  async orderBoost(gameId, pkg) {
    const studio = requireStudio();
    const user = requireProfile();
    const game = readTable('games').find((g) => g.id === gameId && g.studioId === studio.id);
    if (!game) fail('not_found');
    if (!PUBLIC_STATUSES.includes(game.status)) fail('invalid', 'Only a live game can be boosted.');
    if (readTable('boosts').some((b) => b.gameId === gameId && (b.status === 'paid' || b.status === 'live') && (b.endsAt ?? '') > nowIso())) {
      fail('conflict', 'This game already has a Boost running.');
    }
    const id = newId();
    mutateTable('boosts', (rows) => {
      rows.push({ id, gameId, studioId: studio.id, package: pkg, amount: BOOSTS[pkg].price, status: 'pending_payment', shortUrls: [], reelUrls: [], startsAt: null, endsAt: null, heroUntil: null, notes: '', createdAt: nowIso() });
    });
    return newIntent('boost', user.id, id, BOOSTS[pkg].price, `Boost ${BOOST_NAME[pkg]}: ${game.title}`, pkg);
  },
  async myBoostCredits() {
    const studio = requireStudio();
    return readTable('boostCredits').filter((c) => c.studioId === studio.id && !c.usedAt).length;
  },
  async redeemBoostCredit(gameId) {
    const studio = requireStudio();
    const game = readTable('games').find((g) => g.id === gameId && g.studioId === studio.id);
    if (!game) fail('not_allowed');
    if (!PUBLIC_STATUSES.includes(game.status)) fail('invalid', 'Only a live game can be boosted.');
    if (readTable('boosts').some((b) => b.gameId === gameId && (b.status === 'paid' || b.status === 'live') && (b.endsAt ?? '') > nowIso())) {
      fail('conflict', 'This game already has a Boost running.');
    }
    const credit = readTable('boostCredits').find((c) => c.studioId === studio.id && !c.usedAt);
    if (!credit) fail('not_found', 'No free Boost credit left.');
    const id = newId();
    const start = Date.now();
    mutateTable('boosts', (rows) => {
      rows.push({ id, gameId, studioId: studio.id, package: 'spotlight', amount: 0, status: 'paid', shortUrls: [], reelUrls: [], startsAt: new Date(start).toISOString(), endsAt: new Date(start + BOOSTS.spotlight.sponsoredDays * 86_400_000).toISOString(), heroUntil: null, notes: 'Free: late review credit', createdAt: nowIso() });
    });
    mutateTable('boostCredits', (rows) => rows.map((c) => (c.id === credit.id ? { ...c, usedAt: nowIso(), usedBoostId: id } : c)));
    audit(currentMockUser()?.id ?? null, 'boost_credit_used', 'boost', id, { game: gameId });
    emitTopic('catalogue');
    emitTopic('revenue');
  },
  async myBoosts() {
    const studio = requireStudio();
    return readTable('boosts')
      .filter((b) => b.studioId === studio.id && b.status !== 'pending_payment')
      .reverse()
      .map(toOrder);
  },
  async boosts() {
    requireStaff();
    return readTable('boosts')
      .filter((b) => b.status !== 'pending_payment')
      .reverse()
      .map(toOrder);
  },
  async updateBoost(id, patch) {
    const staff = requireStaff();
    const before = readTable('boosts').find((b) => b.id === id);
    if (!before) fail('not_found');
    const clean = (list?: string[]) => list?.map((u) => u.trim()).filter((u) => /^https:\/\//.test(u));
    mutateTable('boosts', (rows) => {
      const b = rows.find((x) => x.id === id);
      if (!b) return;
      if (patch.status) b.status = patch.status;
      if (patch.shortUrls) b.shortUrls = clean(patch.shortUrls)!;
      if (patch.reelUrls) b.reelUrls = clean(patch.reelUrls)!;
      if (patch.notes != null) b.notes = patch.notes.slice(0, 1000);
    });
    const after = readTable('boosts').find((b) => b.id === id)!;
    const newLinks = [...after.shortUrls, ...after.reelUrls].filter((u) => ![...before.shortUrls, ...before.reelUrls].includes(u));
    if (newLinks.length) {
      const studio = readTable('studios').find((s) => s.id === after.studioId);
      const owner = readTable('users').find((u) => u.id === studio?.ownerId);
      const game = readTable('games').find((g) => g.id === after.gameId);
      notify(owner?.id, 'boost', `Your videos for ${game?.title ?? 'your game'} are live`, newLinks.join('\n'), '/dev/boost/');
      sendMail(owner?.email ?? studio?.contactEmail, 'boost_posted', { game: game?.title, links: newLinks.join('\n') });
    }
    audit(staff.id, 'update_boost', 'boost', id, patch);
    emitTopic('catalogue');
    emitTopic('revenue');
  },
  async payments() {
    requireStaff();
    return readTable('payments').slice().reverse();
  },
  async emails() {
    requireStaff();
    return readTable('emails').slice().reverse().slice(0, 300);
  },
};

