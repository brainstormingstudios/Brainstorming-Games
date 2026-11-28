import { pickWinner } from '@/lib/domain/abTest';
import { COSMETICS, QUESTS, type CosmeticDef, type QuestDef } from '@/lib/domain/progression';
import { emitTopic } from '../bus';
import { isDrawableCosmetic } from '@brainstorming/ui';
import { REPORT_KINDS, questCode, type AdminQuest, type Jam, type ReportKind, type ReportRecord } from '../growthTypes';
import { getAnonId } from '../local';
import type { GrowthRepo } from '../repo';
import { PUBLIC_STATUSES } from '../types';
import { currentUserId, requireProfile, requireStaff, updateUser } from './auth';
import { publicSummaries } from './catalogue';
import { audit, fail, mutateTable, newId, notify, nowIso, readTable, takeToken, type MockTables } from './db';
import { ownerOf, requireStudio } from './dev';
import { addImpressions, databaseStats, discoveryAll, discoveryFor, siteStats } from './discovery';
import { awardPoints } from './social';

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** The built-in quests with the admin's edits applied; switched-off quests are left out. */
export function effectiveQuests(includeInactive = false): (QuestDef & { active: boolean })[] {
  const edits = new Map(readTable('questOverrides').map((o) => [o.code, o]));
  return [...QUESTS, ...readTable('customQuests')]
    .filter((q) => !edits.get(q.code)?.deleted)
    .map((q) => {
      const e = edits.get(q.code);
      if (!e) return { ...q, active: true };
      const title = e.title ? { en: e.title, hi: e.title } : q.title;
      const description = e.description != null ? { en: e.description, hi: e.description } : q.description;
      return { ...q, title, description, target: e.target, reward: e.reward, active: e.active };
    })
    .filter((q) => includeInactive || q.active);
}

/** The built-in cosmetics with the admin's edits applied; switched-off items are left out. */
export function effectiveCosmetics(includeInactive = false): (CosmeticDef & { active: boolean })[] {
  const edits = new Map(readTable('cosmeticOverrides').map((o) => [o.id, o]));
  return [...COSMETICS, ...readTable('customCosmetics')]
    .filter((c) => !edits.get(`${c.slot}:${c.code}`)?.deleted)
    .map((c) => {
      const e = edits.get(`${c.slot}:${c.code}`);
      if (!e) return { ...c, active: true };
      return { ...c, name: e.name ? { en: e.name, hi: e.name } : c.name, cost: e.cost, minLevel: e.minLevel, active: e.active };
    })
    .filter((c) => includeInactive || c.active);
}

const toJam = (j: MockTables['jams'][number], entries: MockTables['jamEntries']): Jam => ({
  id: j.id,
  slug: j.slug,
  title: j.title,
  theme: j.theme,
  descriptionMd: j.descriptionMd,
  startsAt: j.startsAt,
  endsAt: j.endsAt,
  status: j.status,
  entries: entries.filter((e) => e.jamId === j.id).length,
  sponsorName: j.sponsorName ?? null,
  sponsorUrl: j.sponsorUrl ?? null,
  prizes: j.prizes ?? [],
});

/**
 * Ends every thumbnail test whose covers all reached 1,000 impressions: the best cover stays as
 * the only cover (mirror of pick_ab_winners). Returns how many tests were decided.
 */
export function pickAbWinners(): number {
  const open = readTable('variantStats').filter((s) => !s.decidedAt);
  let decided = 0;
  for (const gameId of new Set(open.map((s) => s.gameId))) {
    const winner = pickWinner(open.filter((s) => s.gameId === gameId));
    if (!winner) continue;
    const now = nowIso();
    mutateTable('variantStats', (rows) => {
      for (const r of rows) if (r.gameId === gameId) Object.assign(r, { decidedAt: now, winner: r.label === winner });
    });
    mutateTable('media', (rows) => {
      for (const m of rows) {
        if (m.gameId !== gameId || m.kind !== 'cover_landscape' || m.variantLabel == null || m.pending) continue;
        m.isActive = m.variantLabel === winner;
        if (m.isActive) m.variantLabel = null;
      }
    });
    mutateTable('games', (rows) => {
      const g = rows.find((x) => x.id === gameId);
      if (g) g.updatedAt = now;
    });
    notify(ownerOf(gameId), 'ab_test', 'Thumbnail test finished', `Cover ${winner} won and is now your only cover.`, `/dev/games/view/?id=${gameId}`);
    decided++;
  }
  if (decided) {
    emitTopic('catalogue');
    emitTopic('dev-games');
    emitTopic('notifications');
  }
  return decided;
}

function reportLabel(targetType: string, targetId: string): string {
  if (targetType === 'user') {
    const u = readTable('users').find((x) => x.id === targetId);
    return u?.username ?? targetId;
  }
  if (targetType === 'studio') return readTable('studios').find((x) => x.id === targetId)?.name ?? targetId;
  if (targetType === 'devlog') return readTable('devlogs').find((x) => x.id === targetId)?.title ?? targetId;
  if (targetType === 'game') return readTable('games').find((x) => x.id === targetId)?.title ?? targetId;
  return targetId;
}

export const mockGrowth: GrowthRepo = {
  async following(studioId) {
    const me = currentUserId();
    return Boolean(me && readTable('followers').some((f) => f.studioId === studioId && f.userId === me));
  },
  async setFollowing(studioId, on) {
    const user = requireProfile();
    mutateTable('followers', (rows) => {
      const rest = rows.filter((f) => !(f.studioId === studioId && f.userId === user.id));
      if (on) rest.push({ studioId, userId: user.id, createdAt: nowIso() });
      return rest;
    });
    emitTopic('studio');
  },
  async devlogFeed({ studioSlug, gameId, limit = 30 } = {}) {
    const studios = new Map(readTable('studios').filter((s) => !s.suspendedAt).map((s) => [s.id, s]));
    const games = new Map(readTable('games').map((g) => [g.id, g]));
    return readTable('devlogs')
      .filter((d) => !d.hiddenAt && studios.has(d.studioId))
      .filter((d) => (studioSlug ? studios.get(d.studioId)!.slug === studioSlug : true) && (gameId ? d.gameId === gameId : true))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
      .map((d) => {
        const s = studios.get(d.studioId)!;
        const g = d.gameId ? games.get(d.gameId) : null;
        const visible = g && PUBLIC_STATUSES.includes(g.status);
        return {
          id: d.id,
          studioSlug: s.slug,
          studioName: s.name,
          gameSlug: visible ? g.slug : null,
          gameTitle: visible ? g.title : null,
          title: d.title,
          bodyMd: d.bodyMd,
          publishedAt: d.publishedAt,
        };
      });
  },
  async recordVariantHits(hits) {
    if (hits.length === 0 || !takeToken(`variants:${getAnonId()}`, 30, 60_000)) return;
    const capped = hits.slice(0, 100).map((h) => ({
      gameId: h.gameId,
      variant: h.variant,
      impressions: Math.min(Math.max(0, Math.round(h.impressions)), 5),
      clicks: Math.min(Math.max(0, Math.round(h.clicks)), 2),
    }));
    // Every tile counts for discovery; covers in a thumbnail test are also counted per cover.
    const known = new Set(readTable('games').map((g) => g.id));
    addImpressions(capped.filter((h) => known.has(h.gameId)));
    const media = readTable('media');
    const tested = capped.filter((h) => h.variant && media.some((m) => m.gameId === h.gameId && m.kind === 'cover_landscape' && m.isActive && m.variantLabel === h.variant));
    if (tested.length === 0) return;
    mutateTable('variantStats', (rows) => {
      for (const h of tested) {
        let row = rows.find((r) => r.gameId === h.gameId && r.label === h.variant);
        if (!row) rows.push((row = { gameId: h.gameId, label: h.variant, impressions: 0, clicks: 0, winner: false, decidedAt: null }));
        if (row.decidedAt) continue;
        row.impressions += h.impressions;
        row.clicks += h.clicks;
      }
    });
    pickAbWinners();
  },
  async discovery(gameId) {
    const me = requireProfile();
    if (ownerOf(gameId) !== me.id && me.role === 'player') fail('not_allowed');
    return discoveryFor(gameId);
  },
  async discoveryAll() {
    requireStaff();
    return discoveryAll();
  },
  async siteStats() {
    requireStaff();
    return siteStats();
  },
  async databaseStats() {
    requireStaff();
    return databaseStats();
  },
  async variantStats(gameId) {
    const studio = requireStudio();
    if (!readTable('games').some((g) => g.id === gameId && g.studioId === studio.id)) fail('not_found');
    return readTable('variantStats')
      .filter((s) => s.gameId === gameId)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((s) => ({ label: s.label, impressions: s.impressions, clicks: s.clicks, winner: s.winner, decided: Boolean(s.decidedAt) }));
  },
  async playtestAnswered(gameId) {
    const me = currentUserId();
    return Boolean(me && readTable('playtests').some((p) => p.gameId === gameId && p.userId === me));
  },
  async submitPlaytest(gameId, answers) {
    const user = requireProfile();
    if (!user.playtestOptIn) fail('not_allowed');
    const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
    if (!ok(answers.fun) || !ok(answers.clarity)) fail('invalid');
    mutateTable('playtests', (rows) => {
      const rest = rows.filter((p) => !(p.gameId === gameId && p.userId === user.id));
      rest.push({ gameId, userId: user.id, fun: answers.fun, clarity: answers.clarity, playAgain: answers.playAgain, createdAt: nowIso() });
      return rest;
    });
    awardPoints(user.id, 15, 'playtest', `game:${gameId}`);
    emitTopic('dev-games');
    emitTopic('session', { local: true });
  },
  async playtestSummary(gameId) {
    const me = requireProfile();
    const owner = ownerOf(gameId);
    if (owner !== me.id && me.role === 'player') fail('not_allowed');
    const rows = readTable('playtests').filter((p) => p.gameId === gameId);
    const avg = (pick: (p: (typeof rows)[number]) => number) => (rows.length ? rows.reduce((n, p) => n + pick(p), 0) / rows.length : null);
    return { responses: rows.length, fun: avg((p) => p.fun), clarity: avg((p) => p.clarity), playAgain: avg((p) => (p.playAgain ? 1 : 0)) };
  },
  async jams() {
    const entries = readTable('jamEntries');
    return readTable('jams')
      .filter((j) => j.status !== 'draft')
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .map((j) => toJam(j, entries));
  },
  async jam(slug) {
    const j = readTable('jams').find((x) => x.slug === slug && x.status !== 'draft');
    if (!j) return null;
    const entries = readTable('jamEntries').filter((e) => e.jamId === j.id);
    const games = new Map(publicSummaries().map((g) => [g.id, g]));
    const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
    return {
      ...toJam(j, entries),
      entryList: entries
        .map((e) => ({ gameId: e.gameId, studioName: studios.get(e.studioId) ?? '', rank: e.rank, submittedAt: e.submittedAt, game: games.get(e.gameId) ?? null }))
        .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.submittedAt.localeCompare(b.submittedAt)),
    };
  },
  async enterJam(jamId, gameId) {
    const studio = requireStudio();
    if (!readTable('games').some((g) => g.id === gameId && g.studioId === studio.id)) fail('not_found');
    const j = readTable('jams').find((x) => x.id === jamId);
    const now = nowIso();
    if (!j || j.status !== 'published' || j.startsAt > now || j.endsAt < now) fail('not_allowed', 'This jam is not open for entries.');
    mutateTable('jamEntries', (rows) => {
      if (!rows.some((e) => e.jamId === jamId && e.gameId === gameId)) rows.push({ jamId, gameId, studioId: studio.id, submittedAt: now, rank: null });
    });
    emitTopic('jams');
  },
  async leaveJam(jamId, gameId) {
    const studio = requireStudio();
    mutateTable('jamEntries', (rows) => rows.filter((e) => !(e.jamId === jamId && e.gameId === gameId && e.studioId === studio.id)));
    emitTopic('jams');
  },
  async report({ kind, targetType, targetId, reason }) {
    const me = currentUserId();
    const key = me ? `user:${me}` : `anon:${getAnonId()}`;
    if (!REPORT_KINDS.includes(kind)) fail('invalid');
    if (!takeToken(`report:${key}`, 5, 600_000)) fail('rate_limited');
    mutateTable('reports', (rows) => {
      rows.push({ id: newId(), kind, targetType, targetId, reporterKey: key, reason: reason.trim().slice(0, 1000), status: 'open', createdAt: nowIso() });
    });
    emitTopic('admin');
  },

  async adminJams() {
    requireStaff();
    const entries = readTable('jamEntries');
    return readTable('jams')
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .map((j) => toJam(j, entries));
  },
  async saveJam(input) {
    const staff = requireStaff();
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG.test(slug)) fail('invalid', 'The address can use lowercase letters, numbers and hyphens (2 to 40 characters).');
    if (input.title.trim().length < 3) fail('invalid', 'Give the jam a title.');
    if (!(input.endsAt > input.startsAt)) fail('invalid', 'The jam must end after it starts.');
    if (readTable('jams').some((j) => j.slug === slug && j.id !== input.id)) fail('conflict', 'Another jam already uses this address.');
    const sponsorUrl = input.sponsorUrl?.trim() || null;
    if (sponsorUrl && !/^https:\/\/\S+$/.test(sponsorUrl)) fail('invalid', 'The sponsor link must start with https://.');
    const prizes = (input.prizes ?? []).filter((p) => p.prize.trim()).slice(0, 10).map((p, i) => ({ rank: i + 1, prize: p.prize.trim().slice(0, 120) }));
    const row = { slug, title: input.title.trim(), theme: input.theme.trim(), descriptionMd: input.descriptionMd, startsAt: input.startsAt, endsAt: input.endsAt, status: input.status, sponsorName: input.sponsorName?.trim() || null, sponsorUrl, prizes };
    const id = input.id ?? newId();
    mutateTable('jams', (rows) => {
      const existing = rows.find((j) => j.id === id);
      if (existing) Object.assign(existing, row);
      else rows.push({ id, ...row, createdAt: nowIso() });
    });
    audit(staff.id, 'save_jam', 'jam', id, { slug, status: input.status });
    emitTopic('jams');
  },
  async deleteJam(id) {
    const staff = requireStaff();
    mutateTable('jams', (rows) => rows.filter((j) => j.id !== id));
    mutateTable('jamEntries', (rows) => rows.filter((e) => e.jamId !== id));
    audit(staff.id, 'delete_jam', 'jam', id);
    emitTopic('jams');
  },
  async rankJamEntry(jamId, gameId, rank) {
    requireStaff();
    mutateTable('jamEntries', (rows) => {
      const e = rows.find((x) => x.jamId === jamId && x.gameId === gameId);
      if (e) e.rank = rank;
    });
    emitTopic('jams');
  },
  async reports() {
    requireStaff();
    return readTable('reports')
      .slice()
      .reverse()
      .map(
        (r): ReportRecord => ({
          id: r.id,
          kind: r.kind as ReportKind,
          targetType: r.targetType,
          targetId: r.targetId,
          targetLabel: reportLabel(r.targetType, r.targetId),
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
        }),
      );
  },
  async resolveReport(id, status) {
    const staff = requireStaff();
    mutateTable('reports', (rows) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = status;
    });
    audit(staff.id, 'resolve_report', 'report', id, { status });
    emitTopic('admin');
  },
  async findUsers(query) {
    requireStaff();
    const q = query.trim().toLowerCase();
    return readTable('users')
      .filter((u) => u.username && (!q || u.username.includes(q) || u.id === q))
      .slice(0, 20)
      .map((u) => ({ id: u.id, username: u.username!, displayName: u.displayName, role: u.role, banned: Boolean(u.bannedAt), isMinor: u.isMinor, createdAt: u.createdAt, brainPoints: u.brainPoints, premiumPlan: u.premiumUntil && u.premiumUntil > nowIso() ? (u.premiumPlan ?? null) : null, premiumUntil: u.premiumUntil ?? null }));
  },
  async setUser(userId, patch) {
    const staff = requireStaff();
    if (userId === staff.id) fail('not_allowed', 'You cannot moderate your own account.');
    if (patch.role && staff.role !== 'admin') fail('not_allowed', 'Only an admin can change roles.');
    updateUser(userId, {
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.banned != null ? { bannedAt: patch.banned ? nowIso() : null } : {}),
      ...(patch.resetUsername ? { username: `player_${userId.replace(/-/g, '').slice(0, 10)}`, displayName: '' } : {}),
    });
    audit(staff.id, 'set_user', 'user', userId, patch);
    emitTopic('admin');
    emitTopic('session');
  },
  async deleteStudio(studioId, reason) {
    const staff = requireStaff();
    if (staff.role !== 'admin') fail('not_allowed', 'Only an admin can delete studios.');
    if (reason.trim().length < 5) fail('invalid', 'Write why (at least a few words).');
    const s = readTable('studios').find((x) => x.id === studioId);
    if (!s) fail('not_found');
    if (s.isFirstParty) fail('invalid', 'The house studio cannot be deleted here.');
    const games = new Set(readTable('games').filter((g) => g.studioId === studioId).map((g) => g.id));
    mutateTable('versions', (rows) => rows.filter((v) => !games.has(v.gameId)));
    mutateTable('games', (rows) => rows.filter((g) => g.studioId !== studioId));
    mutateTable('studios', (rows) => rows.filter((x) => x.id !== studioId));
    audit(staff.id, 'delete_studio', 'studio', studioId, { name: s.name, reason });
    emitTopic('admin');
    emitTopic('catalogue');
  },
  async transferStudio(studioId, email) {
    const staff = requireStaff();
    if (staff.role !== 'admin') fail('not_allowed');
    const user = readTable('users').find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) fail('not_found', 'No account with that e-mail. Ask them to sign up first.');
    if (readTable('studios').some((x) => x.ownerId === user.id && x.id !== studioId)) fail('conflict', 'That account already has a studio.');
    mutateTable('studios', (rows) => {
      const s = rows.find((x) => x.id === studioId);
      if (s) s.ownerId = user.id;
    });
    audit(staff.id, 'transfer_studio', 'studio', studioId, { to: user.id });
    emitTopic('admin');
  },
  async deleteUser(userId, reason) {
    const staff = requireStaff();
    if (readTable('studios').some((x) => x.ownerId === userId)) fail('conflict', 'This account owns a studio. Hand the studio over or delete it first (Moderation > Studios).');
    if (staff.role !== 'admin') fail('not_allowed', 'Only an admin can delete accounts.');
    if (userId === staff.id) fail('not_allowed', 'You cannot delete your own account here.');
    if (reason.trim().length < 5) fail('invalid', 'Write why (at least a few words).');
    const user = readTable('users').find((u) => u.id === userId);
    if (!user) fail('not_found');
    for (const t of ['userFavourites', 'userHistory', 'cloudSaves', 'questEvents', 'userCosmetics', 'ledger', 'notifications', 'followers', 'playtests'] as const) {
      mutateTable(t, (rows) => (rows as { userId?: string }[]).filter((r) => r.userId !== userId) as never);
    }
    mutateTable('friendships', (rows) => rows.filter((f) => f.requester !== userId && f.addressee !== userId));
    mutateTable('users', (rows) => rows.filter((u) => u.id !== userId));
    audit(staff.id, 'delete_user', 'user', userId, { username: user.username, reason });
    emitTopic('admin');
  },
  async allGames(query) {
    requireStaff();
    const q = query.trim().toLowerCase();
    const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
    const versions = readTable('versions');
    return readTable('games')
      .filter((g) => !q || g.title.toLowerCase().includes(q) || g.slug.includes(q) || (studios.get(g.studioId) ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 200)
      .map((g) => {
        const latest = versions.filter((v) => v.gameId === g.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return {
          id: g.id,
          slug: g.slug,
          title: g.title,
          studioName: studios.get(g.studioId) ?? '',
          status: g.status,
          autoReviewStatus: (latest?.autoReview as { status?: 'pass' | 'warn' | 'fail' } | null)?.status ?? null,
          updatedAt: g.updatedAt,
        };
      });
  },
  async deleteGame(gameId, reason) {
    const staff = requireStaff();
    if (staff.role !== 'admin') fail('not_allowed', 'Only an admin can delete games.');
    if (reason.trim().length < 5) fail('invalid', 'Write why (at least a few words).');
    const g = readTable('games').find((x) => x.id === gameId);
    if (!g) fail('not_found');
    for (const t of ['versions', 'media', 'ratings', 'gameStats', 'impressions', 'variantStats', 'boosts', 'jamEntries', 'playtests', 'userFavourites', 'userHistory'] as const) {
      mutateTable(t, (rows) => (rows as { gameId?: string }[]).filter((r) => r.gameId !== gameId) as never);
    }
    mutateTable('games', (rows) => rows.filter((x) => x.id !== gameId));
    audit(staff.id, 'delete_game', 'game', gameId, { title: g.title, reason });
    emitTopic('catalogue');
    emitTopic('admin');
  },
  async findStudios(query) {
    requireStaff();
    const q = query.trim().toLowerCase();
    return readTable('studios')
      .filter((s) => !q || s.slug.includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((s) => ({ id: s.id, slug: s.slug, name: s.name, verified: s.verified, suspended: Boolean(s.suspendedAt), isFirstParty: s.isFirstParty }));
  },
  async setStudio(studioId, patch) {
    const staff = requireStaff();
    mutateTable('studios', (rows) => {
      const s = rows.find((x) => x.id === studioId);
      if (!s) return;
      if (patch.suspended != null) s.suspendedAt = patch.suspended ? nowIso() : null;
      if (patch.verified != null) s.verified = patch.verified;
    });
    audit(staff.id, 'set_studio', 'studio', studioId, patch);
    emitTopic('admin');
    emitTopic('studio');
    emitTopic('catalogue');
  },
  async adminDevlogs() {
    requireStaff();
    const studios = new Map(readTable('studios').map((s) => [s.id, s.name]));
    return readTable('devlogs')
      .slice()
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 100)
      .map((d) => ({ id: d.id, title: d.title, studioName: studios.get(d.studioId) ?? '', publishedAt: d.publishedAt, hidden: Boolean(d.hiddenAt) }));
  },
  async hideDevlog(id, hidden) {
    const staff = requireStaff();
    mutateTable('devlogs', (rows) => {
      const d = rows.find((x) => x.id === id);
      if (d) d.hiddenAt = hidden ? nowIso() : null;
    });
    audit(staff.id, hidden ? 'hide_devlog' : 'unhide_devlog', 'devlog', id);
    emitTopic('devlogs');
    emitTopic('admin');
  },
  async adjustPoints(userId, delta, reason) {
    const staff = requireStaff();
    if (!delta || reason.trim().length < 3) fail('invalid', 'Give a number and a reason.');
    awardPoints(userId, Math.round(delta), 'admin', null);
    audit(staff.id, 'adjust_points', 'user', userId, { delta, reason });
    emitTopic('admin');
  },
  async setPremium(userId, plan, days) {
    const staff = requireStaff();
    updateUser(userId, plan ? { premiumPlan: plan, premiumUntil: new Date(Date.now() + days * 86_400_000).toISOString(), premiumAutoRenew: false, premiumFromPass: false } : { premiumPlan: null, premiumUntil: null, premiumAutoRenew: false });
    audit(staff.id, 'set_premium', 'user', userId, { plan, days });
    emitTopic('admin');
  },
  async adSettings() {
    return readTable('adSettings')[0] ?? { placements: {}, creatives: [] };
  },
  async saveAdSettings(settings) {
    const staff = requireStaff();
    if (settings.creatives.some((c) => !/^https:\/\//.test(c.href) || !/^(https:\/\/|\/promo\/|data:)/.test(c.media))) fail('invalid', 'Each ad needs an https link and an uploaded picture or video.');
    mutateTable('adSettings', () => [settings]);
    audit(staff.id, 'save_ad_settings', 'site', 'ads', {});
    emitTopic('admin');
  },
  async uploadAdMedia(file) {
    requireStaff();
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('read'));
      r.readAsDataURL(file);
    });
  },
  async pages() {
    requireStaff();
    return readTable('sitePages');
  },
  async page(slug) {
    return readTable('sitePages').find((p) => p.slug === slug && p.published) ?? null;
  },
  async savePage(p) {
    const staff = requireStaff();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(p.slug) || p.title.trim().length < 2) fail('invalid', 'Give the page a title and a short address (letters, numbers, dashes).');
    mutateTable('sitePages', (rows) => [...rows.filter((r) => r.slug !== p.slug), { ...p, updatedAt: nowIso() }]);
    audit(staff.id, 'save_page', 'page', p.slug, {});
    emitTopic('admin');
  },
  async deletePage(slug) {
    const staff = requireStaff();
    mutateTable('sitePages', (rows) => rows.filter((r) => r.slug !== slug));
    audit(staff.id, 'delete_page', 'page', slug, {});
    emitTopic('admin');
  },
  async analyticsEmbedUrl() {
    requireStaff();
    return readTable('portalSettings')[0]?.analyticsEmbedUrl ?? null;
  },
  async saveAnalyticsEmbedUrl(url) {
    requireStaff();
    if (url && !/^https:\/\/lookerstudio\.google\.com\/embed\//.test(url)) fail('invalid', 'Paste the Looker Studio embed link (it starts with https://lookerstudio.google.com/embed/).');
    mutateTable('portalSettings', () => [{ analyticsEmbedUrl: url }]);
    emitTopic('admin');
  },
  async adminQuests() {
    requireStaff();
    return effectiveQuests(true).map((q) => ({ code: q.code, period: q.period, title: q.title.en, description: q.description.en, rule: q.rule as AdminQuest['rule'], target: q.target, reward: q.reward, active: q.active }));
  },
  async saveQuest(code, patch) {
    const staff = requireStaff();
    const current = effectiveQuests(true).find((q) => q.code === code);
    if (!current) fail('not_found');
    if (!(patch.target > 0) || !(patch.reward >= 1 && patch.reward <= 1000)) fail('invalid', 'Target must be above 0 and the reward between 1 and 1,000 points.');
    const title = patch.title?.trim() || current.title.en;
    const description = patch.description != null ? patch.description.trim() : current.description.en;
    mutateTable('questOverrides', (rows) => [...rows.filter((r) => r.code !== code), { code, target: Math.round(patch.target), reward: Math.round(patch.reward), active: patch.active, title, description }]);
    audit(staff.id, 'save_quest', 'quest', code, patch);
    emitTopic('quests');
  },
  async addQuest(q) {
    const staff = requireStaff();
    const title = q.title.trim();
    if (title.length < 3 || !(q.target > 0) || !(q.reward >= 1 && q.reward <= 1000)) fail('invalid', 'Give it a title, a target above 0 and a reward between 1 and 1,000 points.');
    const code = `${questCode(q.period, title)}_${Date.now().toString(36).slice(-4)}`;
    const rule = (q.rule.kind === 'play_distinct'
      ? { kind: 'play_distinct', ...(q.rule.category ? { category: q.rule.category } : {}) }
      : q.rule.kind === 'play_new'
        ? { kind: 'play_new', days: Math.max(1, Math.round(q.rule.days ?? 7)) }
        : { kind: q.rule.kind }) as QuestDef['rule'];
    mutateTable('customQuests', (rows) => [...rows, { code, period: q.period, title: { en: title, hi: title }, description: { en: q.description.trim(), hi: q.description.trim() }, rule, target: Math.round(q.target), reward: Math.round(q.reward) }]);
    audit(staff.id, 'add_quest', 'quest', code, {});
    emitTopic('quests');
  },
  async deleteQuest(code) {
    const staff = requireStaff();
    const current = effectiveQuests(true).find((q) => q.code === code);
    if (!current) fail('not_found');
    mutateTable('customQuests', (rows) => rows.filter((r) => r.code !== code));
    mutateTable('questOverrides', (rows) => [...rows.filter((r) => r.code !== code), { code, target: current.target, reward: current.reward, active: false, deleted: true }]);
    audit(staff.id, 'delete_quest', 'quest', code, {});
    emitTopic('quests');
  },
  async adminCosmetics() {
    requireStaff();
    return effectiveCosmetics(true).map((c) => ({ id: `${c.slot}:${c.code}`, slot: c.slot, code: c.code, name: c.name.en, cost: c.cost, minLevel: c.minLevel, active: c.active }));
  },
  async addCosmetic(item) {
    const staff = requireStaff();
    const code = item.code.trim();
    if (!isDrawableCosmetic(item.slot, code) || item.name.trim().length < 2 || !(item.cost >= 0) || !(item.minLevel >= 1)) {
      fail('invalid', 'Pick a design (or a colour code like #1E90FF), a name, a cost of 0 or more and a level from 1.');
    }
    const id = `${item.slot}:${code}`;
    if (effectiveCosmetics(true).some((c) => `${c.slot}:${c.code}` === id)) fail('conflict', 'That design is already in the Locker. Turn it on instead.');
    const name = { en: item.name.trim(), hi: item.name.trim() };
    if (COSMETICS.some((c) => `${c.slot}:${c.code}` === id)) {
      // A built-in item that was deleted comes back.
      mutateTable('cosmeticOverrides', (rows) => [...rows.filter((r) => r.id !== id), { id, cost: Math.round(item.cost), minLevel: Math.round(item.minLevel), active: true, name: name.en }]);
    } else {
      mutateTable('customCosmetics', (rows) => [...rows, { slot: item.slot, code, name, cost: Math.round(item.cost), minLevel: Math.round(item.minLevel) }]);
    }
    audit(staff.id, 'add_cosmetic', 'cosmetic', id, {});
    emitTopic('profile');
  },
  async deleteCosmetic(id) {
    const staff = requireStaff();
    const current = effectiveCosmetics(true).find((c) => `${c.slot}:${c.code}` === id);
    if (!current) fail('not_found');
    mutateTable('customCosmetics', (rows) => rows.filter((r) => `${r.slot}:${r.code}` !== id));
    mutateTable('cosmeticOverrides', (rows) => [...rows.filter((r) => r.id !== id), { id, cost: current.cost, minLevel: current.minLevel, active: false, deleted: true }]);
    audit(staff.id, 'delete_cosmetic', 'cosmetic', id, {});
    emitTopic('profile');
  },
  async saveCosmetic(id, patch) {
    const staff = requireStaff();
    const current = effectiveCosmetics(true).find((c) => `${c.slot}:${c.code}` === id);
    if (!current) fail('not_found');
    if (!(patch.cost >= 0) || !(patch.minLevel >= 1)) fail('invalid', 'Cost cannot be negative and the level starts at 1.');
    const name = patch.name?.trim() || current.name.en;
    if (!COSMETICS.some((c) => `${c.slot}:${c.code}` === id)) {
      mutateTable('customCosmetics', (rows) => rows.map((r) => (`${r.slot}:${r.code}` === id ? { ...r, name: { en: name, hi: name } } : r)));
    }
    mutateTable('cosmeticOverrides', (rows) => [...rows.filter((r) => r.id !== id), { id, cost: Math.round(patch.cost), minLevel: Math.round(patch.minLevel), active: patch.active, name }]);
    audit(staff.id, 'save_cosmetic', 'cosmetic', id, patch);
    emitTopic('profile');
  },
};
