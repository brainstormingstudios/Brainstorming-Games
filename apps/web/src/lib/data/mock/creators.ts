import { formatMoney } from '@/lib/domain/revenue';
import { maskPayoutProfile, validatePayoutProfile } from '@/lib/domain/payoutProfile';
import { emitTopic } from '../bus';
import { CREATOR_HANDLE, type AdminCreatorRow, type Creator } from '../creatorTypes';
import { getAnonId } from '../local';
import type { CreatorRepo } from '../repo';
import { requireProfile, requireStaff } from './auth';
import { appendRows, audit, fail, mutateTable, newId, notify, nowIso, readTable } from './db';
import { sendMail } from './mail';

const RESERVED = new Set(['admin', 'brainstorming', 'support', 'staff', 'moderator', 'official', 'help']);

function myCreator(): Creator | null {
  const user = requireProfile();
  return readTable('creators').find((c) => c.userId === user.id) ?? null;
}

function requireApproved(): Creator {
  const c = myCreator();
  if (!c || c.status !== 'approved') fail('not_allowed', 'Your creator account is not approved yet.');
  return c;
}

const emailOf = (userId: string) => readTable('users').find((u) => u.id === userId)?.email ?? null;

export const mockCreators: CreatorRepo = {
  async mine() {
    return myCreator();
  },
  async handleAvailable(handle) {
    const h = handle.trim().toLowerCase();
    return CREATOR_HANDLE.test(h) && !RESERVED.has(h) && !readTable('creators').some((c) => c.handle === h);
  },
  async apply(input) {
    const user = requireProfile();
    if (user.isMinor) fail('not_allowed', 'The creator program is for players aged 18 and over.');
    if (!input.agreed) fail('invalid', 'Please accept the Creator Agreement.');
    const handle = input.handle.trim().toLowerCase();
    if (!CREATOR_HANDLE.test(handle) || RESERVED.has(handle)) fail('invalid', 'Handles are 3 to 24 letters, numbers or underscores.');
    const channels = input.channels.filter((c) => /^https:\/\/\S+$/.test(c.url.trim())).slice(0, 5);
    if (channels.length === 0) fail('invalid', 'Add at least one channel link (https://…).');
    if (input.about.trim().length < 20) fail('invalid', 'Tell us a little about your channel (at least 20 characters).');
    const existing = readTable('creators').find((c) => c.userId === user.id);
    if (existing && existing.status !== 'rejected') fail('conflict', 'You have already applied.');
    if (readTable('creators').some((c) => c.handle === handle && c.userId !== user.id)) fail('conflict', 'That handle is taken.');
    const row: Creator = {
      id: existing?.id ?? newId(),
      userId: user.id,
      handle,
      displayName: input.displayName.trim().slice(0, 40) || user.username,
      channels: channels.map((c) => ({ kind: c.kind, url: c.url.trim() })),
      about: input.about.trim().slice(0, 600),
      status: 'pending',
      reviewNote: null,
      createdAt: existing?.createdAt ?? nowIso(),
      approvedAt: null,
    };
    mutateTable('creators', (list) => [...list.filter((c) => c.userId !== user.id), row]);
    audit(user.id, 'creator_apply', 'creator', row.id, { handle });
    emitTopic('creators');
    return row;
  },
  async recordVisit(handle) {
    if (!CREATOR_HANDLE.test(handle)) return;
    appendRows('creatorVisits', [{ handle, anonId: getAnonId(), at: nowIso() }]);
  },
  async stats(days) {
    const c = requireApproved();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s]));
    const visitors = new Set(readTable('creatorVisits').filter((v) => v.handle === c.handle && v.at >= since).map((v) => v.anonId));
    const perGame = new Map<string, { visitors: Set<string>; plays: number; adImpressions: number }>();
    let plays = 0;
    let adImpressions = 0;
    for (const e of readTable('events')) {
      if (e.refCreator !== c.handle || e.ts < since || !e.gameId) continue;
      visitors.add(e.anonId);
      const g = games.get(e.gameId);
      if (!g) continue;
      const row = perGame.get(g.id) ?? { visitors: new Set<string>(), plays: 0, adImpressions: 0 };
      row.visitors.add(e.anonId);
      if (e.type === 'play_click') {
        row.plays += 1;
        plays += 1;
      }
      // The studio's own referral players are the studio's, not the creator's.
      if (e.type === 'ad_started' && !(e.refStudio && studios.get(g.studioId)?.slug === e.refStudio)) {
        row.adImpressions += 1;
        adImpressions += 1;
      }
      perGame.set(g.id, row);
    }
    return {
      days,
      visitors: visitors.size,
      plays,
      adImpressions,
      games: [...perGame.entries()]
        .map(([id, r]) => ({ gameId: id, slug: games.get(id)!.slug, title: games.get(id)!.title, visitors: r.visitors.size, plays: r.plays, adImpressions: r.adImpressions }))
        .sort((a, b) => b.plays - a.plays),
    };
  },
  async myStatements() {
    const c = myCreator();
    if (!c) return [];
    return readTable('creatorMonths').filter((m) => m.creatorId === c.id).sort((a, b) => b.month.localeCompare(a.month));
  },
  async myPayouts() {
    const c = myCreator();
    if (!c) return [];
    return readTable('creatorPayouts').filter((p) => p.creatorId === c.id).reverse();
  },
  async payoutProfile() {
    const c = myCreator();
    if (!c) return null;
    const p = readTable('creatorPayoutProfiles').find((x) => x.creatorId === c.id);
    return p ? { method: p.method, currency: p.currency, summary: p.summary, updatedAt: p.updatedAt } : null;
  },
  async savePayoutProfile(input) {
    const c = requireApproved();
    const error = validatePayoutProfile(input);
    if (error) fail('invalid', error);
    mutateTable('creatorPayoutProfiles', (list) => [
      ...list.filter((p) => p.creatorId !== c.id),
      { creatorId: c.id, method: input.method, currency: input.currency, summary: maskPayoutProfile(input), updatedAt: nowIso() },
    ]);
    emitTopic('creators');
  },

  // Staff
  async list(status) {
    requireStaff();
    const users = new Map(readTable('users').map((u) => [u.id, u]));
    return readTable('creators')
      .filter((c) => status === 'all' || c.status === status)
      .map<AdminCreatorRow>((c) => ({ ...c, username: users.get(c.userId)?.username ?? null, email: users.get(c.userId)?.email ?? null }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async decide(creatorId, decision, note) {
    const staff = requireStaff();
    const c = readTable('creators').find((x) => x.id === creatorId);
    if (!c) fail('not_found');
    if (decision !== 'approve' && note.trim().length < 3) fail('invalid', 'Write a short reason.');
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended';
    mutateTable('creators', (list) =>
      list.map((x) => (x.id === creatorId ? { ...x, status, reviewNote: note.trim() || null, approvedAt: status === 'approved' ? nowIso() : x.approvedAt } : x)),
    );
    const title = status === 'approved' ? 'You are a Brainstorming creator' : status === 'rejected' ? 'Your creator application' : 'Your creator account is suspended';
    notify(c.userId, 'creator', title, note.trim(), '/creators/dashboard/');
    const email = emailOf(c.userId);
    if (email) sendMail(email, status === 'approved' ? 'creator_approved' : 'creator_declined', { handle: c.handle, note: note.trim() });
    audit(staff.id, `creator_${decision}`, 'creator', creatorId, { note });
    emitTopic('creators');
    emitTopic('notifications');
  },
  async months() {
    requireStaff();
    return [...readTable('creatorMonths')].sort((a, b) => b.month.localeCompare(a.month) || b.payoutDue - a.payoutDue);
  },
  async recordPayout(creatorId, months, method, reference) {
    const staff = requireStaff();
    const due = readTable('creatorMonths').filter((r) => r.creatorId === creatorId && months.includes(r.month) && r.status === 'finalised');
    const amount = due.reduce((n, r) => n + r.payoutDue, 0);
    if (amount <= 0) fail('invalid', 'Nothing finalised to pay for those months.');
    if (reference.trim().length < 3) fail('invalid', 'Enter the transfer reference.');
    const currency = due[0]!.currency;
    mutateTable('creatorPayouts', (list) => {
      list.push({ id: newId(), creatorId, handle: due[0]!.handle, amount, currency, method, reference: reference.trim(), months, paidAt: nowIso() });
    });
    mutateTable('creatorMonths', (list) =>
      list.map((r) => (r.creatorId === creatorId && months.includes(r.month) && r.status === 'finalised' ? { ...r, status: 'paid' as const } : r)),
    );
    const c = readTable('creators').find((x) => x.id === creatorId);
    notify(c?.userId, 'payout', 'Creator payout sent', formatMoney(amount, currency), '/creators/dashboard/');
    const email = c ? emailOf(c.userId) : null;
    if (email) sendMail(email, 'payout_sent', { amount: formatMoney(amount, currency), reference: reference.trim() });
    audit(staff.id, 'creator_payout', 'creator', creatorId, { months, amount, method });
    emitTopic('creators');
  },
  async payouts() {
    requireStaff();
    return [...readTable('creatorPayouts')].reverse();
  },
};
