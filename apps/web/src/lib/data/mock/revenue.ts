import { formatMoney } from '@/lib/domain/revenue';
import { studioEmail } from './dev';
import { sendMail } from './mail';
import { maskPayoutProfile, validatePayoutProfile } from '@/lib/domain/payoutProfile';
import { holdUntil, promoteHold, REAUTH_MINUTES } from '@/lib/domain/payoutHold';
import type { GameImpressions } from '@/lib/domain/revenue';
import { emitTopic } from '../bus';
import type { RevenueRepo } from '../repo';
import { requireRecentSignIn, requireStaff } from './auth';
import { raiseAlert } from './security';
import { audit, fail, mutateTable, newId, notify, nowIso, readTable } from './db';
import { requireStudio } from './dev';

/** Same defaults as site_config.ad_country_weights in 0001_core.sql. */
const COUNTRY_WEIGHTS: Record<string, number> = { default: 0.2, US: 1, GB: 0.8, CA: 0.8, AU: 0.8, DE: 0.7, FR: 0.6, JP: 0.6, IN: 0.12 };

function previousMonth(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export const mockRevenue: RevenueRepo = {
  async inputs(month) {
    requireStaff();
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s]));
    const byGame = new Map<string, GameImpressions>();
    // Only approved creators earn; their links are credited from the day they are approved.
    const creatorsByHandle = new Map(readTable('creators').filter((c) => c.status === 'approved').map((c) => [c.handle, c]));
    for (const e of readTable('events')) {
      if (e.type !== 'ad_started' || !e.gameId || !e.ts.startsWith(month)) continue;
      const g = games.get(e.gameId);
      if (!g) continue;
      let row = byGame.get(g.id);
      if (!row) {
        const s = studios.get(g.studioId);
        row = {
          gameId: g.id,
          title: g.title,
          studioId: g.studioId,
          studioName: s?.name ?? '',
          studioCountry: s?.country ?? null,
          impressionsByCountry: {},
          refImpressions: 0,
          exclusiveUntil: g.exclusiveUntil,
          riseStartedAt: g.riseStartedAt,
          creatorImpressions: {},
        };
        byGame.set(g.id, row);
      }
      const c = e.country ?? 'ZZ';
      row.impressionsByCountry[c] = (row.impressionsByCountry[c] ?? 0) + 1;
      if (e.refStudio && studios.get(g.studioId)?.slug === e.refStudio) row.refImpressions += 1;
      else if (e.refCreator) {
        const creator = creatorsByHandle.get(e.refCreator);
        if (creator) row.creatorImpressions![creator.id] = (row.creatorImpressions![creator.id] ?? 0) + 1;
      }
    }
    const prev = previousMonth(month);
    const carry: Record<string, number> = {};
    for (const r of readTable('revenueMonths')) if (r.month === prev && r.status === 'rolled_over') carry[r.studioId] = r.payoutDue;
    const creatorCarry: Record<string, number> = {};
    for (const r of readTable('creatorMonths')) if (r.month === prev && r.status === 'rolled_over') creatorCarry[r.creatorId] = r.payoutDue;
    return { games: [...byGame.values()], weights: COUNTRY_WEIGHTS, carry, creatorCarry };
  },
  async finalise(run, rows, fxInr) {
    const staff = requireStaff();
    if (readTable('revenueMonths').some((r) => r.month === run.month && r.status === 'paid')) fail('conflict', 'This month already has payouts recorded.');
    mutateTable('revenueImports', (list) => {
      list.push({ month: run.month, currency: run.currency, fxInr, rows, at: nowIso() });
    });
    mutateTable('revenueMonths', (list) => [
      ...list.filter((r) => r.month !== run.month),
      ...run.statements.map((s) => ({
        studioId: s.studioId,
        studioName: s.studioName,
        month: s.month,
        currency: s.currency,
        gross: s.gross,
        net: s.net,
        earned: s.earned,
        sharePct: s.sharePct,
        carryIn: s.carryIn,
        payoutDue: s.payoutDue,
        status: s.belowThreshold ? ('rolled_over' as const) : ('finalised' as const),
        games: s.games,
      })),
    ]);
    const creators = new Map(readTable('creators').map((c) => [c.id, c]));
    mutateTable('creatorMonths', (list) => [
      ...list.filter((r) => r.month !== run.month),
      ...(run.creatorStatements ?? []).map((c) => ({
        creatorId: c.creatorId,
        handle: creators.get(c.creatorId)?.handle ?? '',
        month: c.month,
        currency: c.currency,
        earned: c.earned,
        carryIn: c.carryIn,
        payoutDue: c.payoutDue,
        status: c.belowThreshold ? ('rolled_over' as const) : ('finalised' as const),
        games: c.games,
      })),
    ]);
    for (const c of run.creatorStatements ?? []) notify(creators.get(c.creatorId)?.userId, 'revenue', `Your ${run.month} creator statement is ready`, '', '/creators/dashboard/');
    const owners = new Map(readTable('studios').map((s) => [s.id, s.ownerId]));
    for (const s of run.statements) {
      notify(owners.get(s.studioId), 'revenue', `Your ${run.month} statement is ready`, '', '/dev/payouts/');
      sendMail(studioEmail(s.studioId), 'statement_ready', { month: run.month, earned: formatMoney(s.earned, run.currency), due: formatMoney(s.payoutDue, run.currency) });
    }
    audit(staff.id, 'revenue_run', 'revenue_month', run.month, { statements: run.statements.length, net: run.totals.net });
    emitTopic('revenue');
    emitTopic('notifications');
  },
  async months() {
    requireStaff();
    return [...readTable('revenueMonths')].sort((a, b) => b.month.localeCompare(a.month) || b.payoutDue - a.payoutDue);
  },
  async recordPayout(studioId, months, method, reference) {
    const staff = requireStaff();
    const due = readTable('revenueMonths').filter((r) => r.studioId === studioId && months.includes(r.month) && r.status === 'finalised');
    const amount = due.reduce((n, r) => n + r.payoutDue, 0);
    if (amount <= 0) fail('invalid', 'Nothing finalised to pay for those months.');
    if (reference.trim().length < 3) fail('invalid', 'Enter the transfer reference.');
    const currency = due[0]!.currency;
    mutateTable('payouts', (list) => {
      list.push({ id: newId(), studioId, studioName: due[0]!.studioName, amount, currency, method, reference: reference.trim(), months, paidAt: nowIso() });
    });
    mutateTable('revenueMonths', (list) =>
      list.map((r) => (r.studioId === studioId && months.includes(r.month) && r.status === 'finalised' ? { ...r, status: 'paid' as const } : r)),
    );
    const owner = readTable('studios').find((s) => s.id === studioId)?.ownerId;
    notify(owner, 'payout', 'Payout sent', `${(amount / 100).toFixed(2)} ${currency}`, '/dev/payouts/');
    sendMail(studioEmail(studioId), 'payout_sent', { amount: formatMoney(amount, currency), reference: reference.trim() });
    audit(staff.id, 'payout', 'studio', studioId, { months, amount, method });
    emitTopic('revenue');
  },
  async payouts() {
    requireStaff();
    return [...readTable('payouts')].reverse();
  },
  async myStatements() {
    const s = requireStudio();
    return readTable('revenueMonths').filter((r) => r.studioId === s.id).sort((a, b) => b.month.localeCompare(a.month));
  },
  async myPayouts() {
    const s = requireStudio();
    return readTable('payouts').filter((p) => p.studioId === s.id).reverse();
  },
  async payoutProfile() {
    const s = requireStudio();
    const p = readTable('payoutProfiles').find((x) => x.studioId === s.id);
    if (!p) return null;
    const now = promoteHold(p);
    if (now !== p) mutateTable('payoutProfiles', (list) => list.map((x) => (x.studioId === s.id ? now : x)));
    return { method: now.method, currency: now.currency, summary: now.summary, updatedAt: now.updatedAt, pending: now.pending ?? null };
  },
  async savePayoutProfile(input) {
    // A change needs a recent sign-in and waits 48 hours (mirror of the payout-profile function).
    const user = requireRecentSignIn(REAUTH_MINUTES);
    const s = requireStudio();
    const error = validatePayoutProfile(input);
    if (error) fail('invalid', error);
    // Mock mode keeps only the masked summary. Production encrypts the full details in the
    // payout-profile Edge Function (AES-GCM) and only finance staff can decrypt them.
    const pending = { method: input.method, currency: input.currency, summary: maskPayoutProfile(input), effectiveAt: holdUntil() };
    mutateTable('payoutProfiles', (list) => {
      const old = list.find((p) => p.studioId === s.id);
      const row = old ? { ...old, pending } : { studioId: s.id, method: null, currency: null, summary: null, updatedAt: nowIso(), pending };
      return [...list.filter((p) => p.studioId !== s.id), row];
    });
    sendMail(user.email, 'payout_details_changed', { summary: pending.summary, effectiveAt: pending.effectiveAt.slice(0, 16).replace('T', ' ') + ' UTC', scope: 'studio' });
    raiseAlert('payout_change', 'info', 'Payout details changed (on hold for 48 hours)', { studioId: s.id, summary: pending.summary });
    emitTopic('revenue');
  },
  async cancelPayoutChange() {
    const s = requireStudio();
    mutateTable('payoutProfiles', (list) => list.map((p) => (p.studioId === s.id ? { ...p, pending: null } : p)));
    raiseAlert('payout_change_cancelled', 'warn', 'A payout-details change was cancelled by its owner', { studioId: s.id });
    emitTopic('revenue');
  },
};
