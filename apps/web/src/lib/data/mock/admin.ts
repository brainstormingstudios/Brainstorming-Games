import { isSparkWindowOver } from '@/lib/domain/spark';
import { summarise } from '@/lib/domain/kpis';
import { emitTopic } from '../bus';
import type { QaQueueItem, SparkRow } from '../devTypes';
import type { AdminRepo } from '../repo';
import { requireStaff } from './auth';
import { audit, fail, mutateTable, newId, notify, nowIso, readTable, writeSiteConfig } from './db';
import { kpisFor, mediaFor, ownerOf, publishVersion, toDevGame, toDevStudio, toDevVersion, updateGameRow, updateVersionRow } from './dev';

const today = () => new Date().toISOString().slice(0, 10);

/** Admin console logic for mock mode: mirrors qa_decide, spark_decide and friends in SQL. */
export const mockAdmin: AdminRepo = {
  async qaQueue() {
    requireStaff();
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s]));
    return readTable('versions')
      .filter((v) => v.qaStatus === 'in_review')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((v): QaQueueItem => {
        const g = games.get(v.gameId);
        const report = v.preQaReport as { status?: 'pass' | 'warn' | 'fail' } | null;
        return {
          versionId: v.id,
          gameId: v.gameId,
          title: g?.title ?? '',
          studioName: studios.get(g?.studioId ?? '')?.name ?? '',
          version: v.version,
          submittedAt: v.createdAt,
          preQaStatus: report?.status ?? null,
          isUpdate: Boolean(g?.releasedAt),
        };
      });
  },
  async qaItem(versionId) {
    requireStaff();
    const v = readTable('versions').find((x) => x.id === versionId);
    const g = v && readTable('games').find((x) => x.id === v.gameId);
    const s = g && readTable('studios').find((x) => x.id === g.studioId);
    if (!v || !g || !s) return null;
    return {
      game: toDevGame(g),
      studio: toDevStudio(s),
      version: toDevVersion(v, g.currentVersionId),
      media: mediaFor(g.id),
      previous: readTable('reviews')
        .filter((r) => r.gameId === g.id)
        .map((r) => ({ action: r.action, notes: r.notes, createdAt: r.createdAt, versionId: r.versionId })),
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
        notify(owner, 'qa', 'Approved: your Spark Launch has started', 'Your game is live with ads off while we measure how players respond.', link);
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
    audit(staff.id, `qa_${action}`, 'game_version', versionId, { gameId: g.id, notes, schoolSafe });
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
    if (g.status !== 'spark') fail('invalid', 'This game is not in a Spark Launch.');
    const usesSdk = readTable('versions').find((v) => v.id === g.currentVersionId)?.usesSdk ?? false;
    if (promote && !usesSdk) fail('invalid', 'Rise Launch needs the SDK.');
    const now = nowIso();
    mutateTable('launches', (rows) => {
      const open = rows.find((l) => l.gameId === gameId && l.tier === 'spark' && !l.endedAt);
      if (open) Object.assign(open, { endedAt: now, decision: promote ? 'promoted' : 'declined', reason, kpiSnapshot: kpis, decidedBy: staff.id });
      if (promote) rows.push({ id: newId(), gameId, tier: 'rise', startedAt: now, endedAt: null, decision: null, reason: null, kpiSnapshot: null, decidedBy: null });
    });
    if (promote) {
      updateGameRow(gameId, {
        status: 'rise',
        riseStartedAt: now,
        exclusiveUntil: g.wantsExclusive ? new Date(Date.now() + 60 * 86_400_000).toISOString() : null,
      });
    } else {
      updateGameRow(gameId, { status: 'paused' });
    }
    notify(ownerOf(gameId), 'launch', promote ? 'You are invited to Rise Launch' : 'Spark Launch ended', reason, `/dev/games/view/?id=${gameId}`);
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
    // Mock KPIs are computed live from events, so the roll-up has nothing to store.
    emitTopic('catalogue');
  },
};
