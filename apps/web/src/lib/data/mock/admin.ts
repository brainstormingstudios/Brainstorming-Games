import { isSparkWindowOver } from '@/lib/domain/spark';
import { grantReviewCredit } from './billing';
import { reviewLate } from '@/lib/domain/review';
import { creditDiscoverers } from './discover';
import { summarise } from '@/lib/domain/kpis';
import { emitTopic } from '../bus';
import type { AutoRejectedItem, PendingChangeItem, QaQueueItem, SparkRow } from '../devTypes';
import type { AdminRepo } from '../repo';
import { requireStaff } from './auth';
import { audit, fail, mutateTable, newId, notify, nowIso, readTable, writeSiteConfig } from './db';
import { pickAbWinners } from './growth';
import { sendMail } from './mail';
import { kpisFor, mediaFor, ownerOf, pendingChangesFor, runMockPreQa, studioEmail, publishVersion, toDevGame, toDevStudio, toDevVersion, updateGameRow, updateVersionRow } from './dev';

const today = () => new Date().toISOString().slice(0, 10);

/** Admin console logic for mock mode: mirrors qa_decide, spark_decide and friends in SQL. */
export const mockAdmin: AdminRepo = {
  async qaQueue() {
    requireStaff();
    // The daily job's part in mock mode: reviews already over 72 hours earn their credit now.
    for (const v of readTable('versions')) if (v.qaStatus === 'in_review' && v.submittedAt && reviewLate(v.submittedAt)) grantReviewCredit(v.id);
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s]));
    return readTable('versions')
      .filter((v) => v.qaStatus === 'in_review')
      .sort((a, b) => (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt))
      .map((v): QaQueueItem => {
        const g = games.get(v.gameId);
        const report = v.preQaReport as { status?: 'pass' | 'warn' | 'fail' } | null;
        return {
          versionId: v.id,
          gameId: v.gameId,
          title: g?.title ?? '',
          studioName: studios.get(g?.studioId ?? '')?.name ?? '',
          version: v.version,
          submittedAt: v.submittedAt ?? v.createdAt,
          preQaStatus: report?.status ?? null,
          autoReviewStatus: (v.autoReview as { status?: 'pass' | 'warn' | 'fail' } | null)?.status ?? null,
          isUpdate: Boolean(g?.releasedAt),
          studioVerified: Boolean(studios.get(g?.studioId ?? '')?.verified),
        };
      })
      .sort((a, b) => Number(b.studioVerified) - Number(a.studioVerified));
  },
  async autoRejected() {
    requireStaff();
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s]));
    const versions = new Map(readTable('versions').map((v) => [v.id, v]));
    return readTable('reviews')
      .filter((r) => r.action === 'reject' && r.checklist?.automatic === true)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((r): AutoRejectedItem => {
        const g = games.get(r.gameId);
        return {
          versionId: r.versionId,
          gameId: r.gameId,
          title: g?.title ?? '',
          studioName: studios.get(g?.studioId ?? '')?.name ?? '',
          version: versions.get(r.versionId)?.version ?? '',
          reason: r.notes,
          rejectedAt: r.createdAt,
        };
      });
  },
  async rerunPreQa(versionId) {
    requireStaff();
    return runMockPreQa(versionId);
  },
  async qaItem(versionId) {
    requireStaff();
    const v = readTable('versions').find((x) => x.id === versionId);
    const g = v && readTable('games').find((x) => x.id === v.gameId);
    const s = g && readTable('studios').find((x) => x.id === g.studioId);
    if (!v || !g || !s) return null;
    const studioGames = readTable('games').filter((x) => x.studioId === s.id && x.id !== g.id);
    const studioGameIds = new Set([g.id, ...studioGames.map((x) => x.id)]);
    const studioReviews = readTable('reviews').filter((r) => studioGameIds.has(r.gameId));
    const d = v.declaration as { ownsRights?: boolean; noCopies?: boolean; credits?: string } | null | undefined;
    return {
      game: toDevGame(g),
      studio: toDevStudio(s),
      version: toDevVersion(v, g.currentVersionId),
      media: mediaFor(g.id).filter((m) => !m.pending),
      previous: readTable('reviews')
        .filter((r) => r.gameId === g.id)
        .map((r) => ({ action: r.action, notes: r.notes, createdAt: r.createdAt, versionId: r.versionId })),
      declaration: d ? { ownsRights: Boolean(d.ownsRights), noCopies: Boolean(d.noCopies), credits: String(d.credits ?? '') } : null,
      studioRecord: {
        games: studioGames.map((x) => ({ title: x.title, status: x.status })),
        approvals: studioReviews.filter((r) => r.action === 'approve').length,
        rejections: studioReviews.filter((r) => r.action === 'reject').length,
        changesRequested: studioReviews.filter((r) => r.action === 'changes').length,
      },
    };
  },
  async qaDecide({ versionId, action, notes, checklist, schoolSafe }) {
    const staff = requireStaff();
    if (action !== 'approve' && notes.trim().length < 10) fail('invalid', 'Write at least a sentence for the developer.');
    const v = readTable('versions').find((x) => x.id === versionId);
    const g = v && readTable('games').find((x) => x.id === v.gameId);
    if (!v || !g) fail('not_found');
    mutateTable('reviews', (rows) => {
      rows.push({ id: newId(), versionId, gameId: g.id, reviewerId: staff.id, action, checklist: checklist as Record<string, boolean>, notes, createdAt: nowIso() });
    });
    if (v.submittedAt && reviewLate(v.submittedAt)) grantReviewCredit(versionId);
    updateVersionRow(versionId, { reviewedAt: nowIso() });
    const owner = ownerOf(g.id);
    const link = `/dev/games/view/?id=${g.id}`;
    if (action === 'approve') {
      const first = !g.releasedAt || ['in_review', 'draft', 'changes_requested', 'paused'].includes(g.status);
      publishVersion(versionId);
      updateVersionRow(versionId, { qaNotes: notes.trim() || null });
      updateGameRow(g.id, { schoolSafe });
      if (first) {
        const now = nowIso();
        updateGameRow(g.id, { status: 'spark', sparkStartedAt: now, releasedAt: g.releasedAt ?? now });
        mutateTable('launches', (rows) => {
          rows.push({ id: newId(), gameId: g.id, tier: 'spark', startedAt: now, endedAt: null, decision: null, reason: null, kpiSnapshot: null, decidedBy: null });
        });
        notify(owner, 'qa', 'Approved: your Basic Launch has started', 'Your game is live with ads off while we measure how players respond.', link);
      } else {
        notify(owner, 'qa', 'Update approved', 'Your new version is live.', link);
      }
    } else if (action === 'changes') {
      updateVersionRow(versionId, { qaStatus: 'changes_requested', qaNotes: notes });
      if (g.status === 'in_review') updateGameRow(g.id, { status: 'changes_requested' });
      notify(owner, 'qa', 'Changes requested', notes, link);
    } else {
      updateVersionRow(versionId, { qaStatus: 'rejected', qaNotes: notes });
      if (g.status === 'in_review') updateGameRow(g.id, { status: 'draft' });
      notify(owner, 'qa', 'Submission rejected', notes, link);
    }
    const to = studioEmail(g.studioId);
    if (action === 'approve') sendMail(to, 'review_approved', { game: g.title, gameId: g.id, notes: notes.trim(), update: Boolean(g.releasedAt) && g.status !== 'in_review' });
    else sendMail(to, action === 'changes' ? 'review_changes' : 'review_rejected', { game: g.title, gameId: g.id, notes });
    audit(staff.id, `qa_${action}`, 'game_version', versionId, { gameId: g.id, notes, schoolSafe });
    emitTopic('qa');
    emitTopic('dev-games');
    emitTopic('catalogue');
    emitTopic('notifications');
  },
  async securityAlerts(openOnly = true) {
    requireStaff();
    return readTable('securityAlerts')
      .filter((a) => !openOnly || !a.resolvedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 300);
  },
  async resolveAlert(id) {
    const staff = requireStaff();
    mutateTable('securityAlerts', (rows) => rows.map((a) => (a.id === id && !a.resolvedAt ? { ...a, resolvedAt: nowIso() } : a)));
    audit(staff.id, 'alert_resolve', 'security_alert', id);
    emitTopic('admin');
  },
  async fraudOverview(days) {
    requireStaff();
    const since = new Date(Date.now() - Math.max(1, Math.min(days, 31)) * 86_400_000).toISOString();
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
    const by = new Map<string, { plays: number; players: Set<string>; real: Set<string>; ads: number }>();
    for (const e of readTable('events')) {
      if (!e.gameId || e.ts < since) continue;
      const row = by.get(e.gameId) ?? { plays: 0, players: new Set<string>(), real: new Set<string>(), ads: 0 };
      if (e.type === 'play_click') {
        row.plays++;
        row.players.add(e.anonId);
      } else if ((e.type === 'gameplay_stop' || e.type === 'session_end') && Number(e.payload.t) >= 20 && e.sessionId) row.real.add(e.sessionId);
      else if (e.type === 'ad_started') row.ads++;
      by.set(e.gameId, row);
    }
    return [...by]
      .filter(([id]) => games.has(id))
      .map(([id, r]) => {
        const g = games.get(id)!;
        return {
          gameId: id,
          title: g.title,
          studio: studios.get(g.studioId) ?? '',
          plays: r.plays,
          players: r.players.size,
          realSessions: r.real.size,
          adViews: r.ads,
          playsPerPlayer: Math.round((r.plays / Math.max(1, r.players.size)) * 10) / 10,
          cappedCallers: 0,
        };
      })
      .sort((a, b) => b.playsPerPlayer - a.playsPerPlayer || b.plays - a.plays);
  },
  async pendingChanges() {
    requireStaff();
    const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
    const edits = readTable('pendingEdits');
    const media = readTable('media');
    return readTable('games')
      .filter((g) => edits.some((e) => e.gameId === g.id) || media.some((m) => m.gameId === g.id && m.pending))
      .map((g): PendingChangeItem => {
        const changes = pendingChangesFor(g.id);
        const held = media.filter((m) => m.gameId === g.id && m.pending);
        const since = [edits.find((e) => e.gameId === g.id)?.submittedAt, ...held.map((m) => m.createdAt)].filter(Boolean).sort()[0]!;
        const live = toDevGame(g);
        return {
          gameId: g.id,
          title: g.title,
          slug: g.slug,
          studioName: studios.get(g.studioId) ?? '',
          submittedAt: since,
          changes,
          live: Object.fromEntries(Object.keys(changes).map((k) => [k, live[k as keyof typeof live]])),
          media: held.map((m) => ({
            id: m.id,
            kind: m.kind,
            url: m.url,
            variantLabel: m.variantLabel,
            liveUrl: media.find((l) => l.gameId === g.id && l.kind === m.kind && !l.pending && l.isActive && l.variantLabel === m.variantLabel)?.url ?? null,
          })),
        };
      })
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  },
  async decideChange(gameId, approve, note) {
    const staff = requireStaff();
    if (!approve && note.trim().length < 10) fail('invalid', 'Write at least a sentence for the developer.');
    const g = readTable('games').find((x) => x.id === gameId);
    if (!g) fail('not_found');
    const changes = pendingChangesFor(gameId);
    if (approve) {
      updateGameRow(gameId, changes as Parameters<typeof updateGameRow>[1]);
      mutateTable('media', (rows) => {
        const held = rows.filter((m) => m.gameId === gameId && m.pending);
        const replaced = (m: (typeof rows)[number]) =>
          m.gameId === gameId && !m.pending && held.some((h) => h.kind === m.kind && h.variantLabel === m.variantLabel);
        const rest = rows.filter((m) => !replaced(m));
        for (const m of rest) if (m.gameId === gameId && m.pending) Object.assign(m, { pending: false, isActive: true });
        return rest;
      });
      notify(ownerOf(gameId), 'qa', 'Changes approved', 'Your updated page is live.', `/dev/games/view/?id=${gameId}`);
    } else {
      mutateTable('media', (rows) => rows.filter((m) => !(m.gameId === gameId && m.pending)));
      notify(ownerOf(gameId), 'qa', 'Changes declined', note, `/dev/games/view/?id=${gameId}`);
    }
    mutateTable('pendingEdits', (rows) => rows.filter((e) => e.gameId !== gameId));
    audit(staff.id, approve ? 'change_approve' : 'change_decline', 'game', gameId, { changes, note });
    emitTopic('qa');
    emitTopic('dev-games');
    emitTopic('catalogue');
    emitTopic('notifications');
  },
  async sparkGames() {
    requireStaff();
    const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
    const versions = new Map(readTable('versions').map((v) => [v.id, v]));
    return readTable('games')
      .filter((g) => g.status === 'spark')
      .map((g): SparkRow => {
        const from = (g.sparkStartedAt ?? g.createdAt).slice(0, 10);
        const kpis = kpisFor(g.id, from, today());
        const plays = summarise(kpis.days).plays;
        return {
          game: toDevGame(g),
          studioName: studios.get(g.studioId) ?? '',
          usesSdk: versions.get(g.currentVersionId ?? '')?.usesSdk ?? false,
          kpis,
          windowOver: isSparkWindowOver(g.sparkStartedAt ?? g.createdAt, plays),
        };
      });
  },
  async sparkDecide(gameId, promote, reason, kpis) {
    const staff = requireStaff();
    if (reason.trim().length < 20) fail('invalid', 'Write the reason the developer will read (at least a sentence).');
    const g = readTable('games').find((x) => x.id === gameId);
    if (!g) fail('not_found');
    if (g.status !== 'spark') fail('invalid', 'This game is not in a Basic Launch.');
    const usesSdk = readTable('versions').find((v) => v.id === g.currentVersionId)?.usesSdk ?? false;
    if (promote && !usesSdk) fail('invalid', 'Full Launch needs the SDK.');
    const now = nowIso();
    mutateTable('launches', (rows) => {
      const open = rows.find((l) => l.gameId === gameId && l.tier === 'spark' && !l.endedAt);
      if (open) Object.assign(open, { endedAt: now, decision: promote ? 'promoted' : 'declined', reason, kpiSnapshot: kpis, decidedBy: staff.id });
      if (promote) rows.push({ id: newId(), gameId, tier: 'rise', startedAt: now, endedAt: null, decision: null, reason: null, kpiSnapshot: null, decidedBy: null });
    });
    if (promote) {
      creditDiscoverers(gameId);
      updateGameRow(gameId, {
        status: 'rise',
        riseStartedAt: now,
        exclusiveUntil: g.wantsExclusive ? new Date(Date.now() + 90 * 86_400_000).toISOString() : null,
      });
    } else {
      updateGameRow(gameId, { status: 'paused' });
    }
    notify(ownerOf(gameId), 'launch', promote ? 'You are invited to Full Launch' : 'Basic Launch ended', reason, `/dev/games/view/?id=${gameId}`);
    sendMail(studioEmail(g.studioId), promote ? 'rise_invite' : 'spark_ended', { game: g.title, gameId, reason });
    audit(staff.id, promote ? 'spark_promote' : 'spark_decline', 'game', gameId, { reason, kpis });
    emitTopic('qa');
    emitTopic('dev-games');
    emitTopic('catalogue');
  },
  async setGameStatus(gameId, status, reason) {
    const staff = requireStaff();
    if (!['rise', 'featured', 'paused', 'removed', 'spark'].includes(status)) fail('invalid');
    updateGameRow(gameId, { status });
    audit(staff.id, 'set_game_status', 'game', gameId, { status, reason });
    emitTopic('catalogue');
    emitTopic('dev-games');
  },
  async saveSiteConfig(config) {
    const staff = requireStaff();
    writeSiteConfig(config);
    audit(staff.id, 'set_site_config', 'site_config', 'home', config as unknown as Record<string, unknown>);
    emitTopic('catalogue');
  },
  async audit(limit = 200) {
    requireStaff();
    const users = new Map(readTable('users').map((u) => [u.id, u.username ?? u.email]));
    return readTable('audit')
      .slice(-limit)
      .reverse()
      .map((a) => ({ id: a.id, actor: users.get(a.actorId ?? '') ?? 'system', action: a.action, targetType: a.targetType, targetId: a.targetId, detail: a.detail, createdAt: a.createdAt }));
  },
  async runDailyJobs() {
    requireStaff();
    // Mock KPIs are computed live from events; the job only has thumbnail tests to close.
    pickAbWinners();
    emitTopic('catalogue');
  },
};
