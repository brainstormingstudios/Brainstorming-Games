'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, IconButton, SelectField, Skeleton, Switch, Tabs, TextAreaField, TextField } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import type { AdminCosmetic, AdminQuest, Jam, JamInput, JamStatus } from '@/lib/data/growthTypes';
import { DEFAULT_RAIL_ORDER, type GameStatus, type GameSummary, type RailId, type SiteConfig } from '@/lib/data/types';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

const move = <T,>(list: T[], index: number, by: -1 | 1): T[] => {
  const next = [...list];
  const to = index + by;
  if (to < 0 || to >= next.length) return list;
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
};

function GamePicker({ label, ids, games, onChange, testId }: { label: string; ids: string[]; games: GameSummary[]; onChange: (ids: string[]) => void; testId: string }) {
  const t = useTranslations('admin.featured');
  const byId = new Map(games.map((g) => [g.id, g]));
  const free = games.filter((g) => !ids.includes(g.id));
  const [pick, setPick] = useState('');
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid={testId}>
      <h2 className="font-display text-lg font-semibold">{label}</h2>
      {ids.length === 0 ? <p className="text-sm text-fg-muted">{t('none')}</p> : null}
      <ol className="flex flex-col gap-1">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-1 rounded-control bg-surface-3 px-2 py-1 text-sm">
            <span className="min-w-0 flex-1 truncate font-bold">{byId.get(id)?.title ?? t('unknownGame')}</span>
            <IconButton size="sm" label={t('up')} disabled={i === 0} onClick={() => onChange(move(ids, i, -1))}>
              <ArrowUp aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton size="sm" label={t('down')} disabled={i === ids.length - 1} onClick={() => onChange(move(ids, i, 1))}>
              <ArrowDown aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton size="sm" label={t('remove')} onClick={() => onChange(ids.filter((x) => x !== id))}>
              <Trash2 aria-hidden="true" className="size-4" />
            </IconButton>
          </li>
        ))}
      </ol>
      {free.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label={t('addGame')}
            className="min-w-52 flex-1"
            value={pick || free[0]!.id}
            onChange={(e) => setPick(e.target.value)}
            options={free.map((g) => ({ value: g.id, label: g.title }))}
          />
          <Button
            variant="secondary"
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              onChange([...ids, pick && free.some((g) => g.id === pick) ? pick : free[0]!.id]);
              setPick('');
            }}
            data-testid={`${testId}-add`}
          >
            {t('add')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** What the homepage leads with: the hero, the featured rail, and the order of the other rails. */
export function FeaturedEditor() {
  const t = useTranslations('admin.featured');
  const th = useTranslations('home');
  const act = useAct();
  const saved = useRepoQuery((repo) => repo.catalogue.siteConfig(), [], { topics: ['catalogue'] });
  const games = useRepoQuery((repo) => repo.catalogue.list({ sort: 'popular', limit: 200 }).then((p) => p.items), [], { topics: ['catalogue'] });
  const [config, setConfig] = useState<SiteConfig | null>(null);
  useEffect(() => {
    if (saved.data && !config) {
      // Rails added after the config was last saved go to the end.
      const order = [...saved.data.railOrder, ...DEFAULT_RAIL_ORDER.filter((r) => !saved.data!.railOrder.includes(r))];
      setConfig({ ...saved.data, railOrder: order });
    }
  }, [saved.data, config]);
  if (!config) return <Skeleton className="h-64 w-full" />;
  const toggleRail = (rail: RailId, shown: boolean) =>
    setConfig({ ...config, hiddenRails: shown ? config.hiddenRails.filter((r) => r !== rail) : [...config.hiddenRails, rail] });
  return (
    <div className="flex flex-col gap-4" data-testid="featured-editor">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <GamePicker label={t('hero')} ids={config.heroGameIds} games={games.data ?? []} onChange={(heroGameIds) => setConfig({ ...config, heroGameIds })} testId="hero-picker" />
        <GamePicker label={t('featured')} ids={config.featuredGameIds} games={games.data ?? []} onChange={(featuredGameIds) => setConfig({ ...config, featuredGameIds })} testId="featured-picker" />
      </div>
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-display text-lg font-semibold">{t('rails')}</h2>
        <ol className="flex flex-col gap-1">
          {config.railOrder.map((rail, i) => (
            <li key={rail} className="flex items-center gap-2 rounded-control bg-surface-3 px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate font-bold">{th(`rails.${rail}` as 'rails.trending')}</span>
              <Switch compact label={t('shown')} checked={!config.hiddenRails.includes(rail)} onChange={(e) => toggleRail(rail, e.target.checked)} />
              <IconButton size="sm" label={t('up')} disabled={i === 0} onClick={() => setConfig({ ...config, railOrder: move(config.railOrder, i, -1) })}>
                <ArrowUp aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton size="sm" label={t('down')} disabled={i === config.railOrder.length - 1} onClick={() => setConfig({ ...config, railOrder: move(config.railOrder, i, 1) })}>
                <ArrowDown aria-hidden="true" className="size-4" />
              </IconButton>
            </li>
          ))}
        </ol>
      </Card>
      <Button className="self-start" onClick={() => void act(async () => (await getRepo()).admin.saveSiteConfig(config), t('saved'))} data-testid="featured-save">
        {t('save')}
      </Button>
    </div>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : '');

const newJam = (): JamInput => {
  const start = new Date();
  return { slug: '', title: '', theme: '', descriptionMd: '', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 14 * 86_400_000).toISOString(), status: 'draft' };
};

function JamRanks({ jam }: { jam: Jam }) {
  const t = useTranslations('admin.jams');
  const act = useAct();
  const detail = useRepoQuery((repo) => repo.growth.jam(jam.slug), [jam.slug], { topics: ['jams'] });
  const entries = detail.data?.entryList ?? [];
  if (jam.status === 'draft') return <p className="text-sm text-fg-muted">{t('ranksDraft')}</p>;
  if (entries.length === 0) return <p className="text-sm text-fg-muted">{t('noEntries')}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((e) => (
        <li key={e.gameId} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-bold">{e.game?.title ?? t('notPublic')}</span> <span className="text-fg-muted">{e.studioName}</span>
          </span>
          <SelectField
            label={t('rank')}
            hideLabel
            className="w-28"
            value={e.rank == null ? '' : String(e.rank)}
            onChange={(ev) => {
              // Read the value before any await: React resets a controlled field once the handler returns.
              const rank = ev.target.value ? Number(ev.target.value) : null;
              void act(async () => (await getRepo()).growth.rankJamEntry(jam.id, e.gameId, rank));
            }}
            options={[{ value: '', label: t('unranked') }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `#${n}` }))]}
          />
        </li>
      ))}
    </ul>
  );
}

export function JamsAdmin() {
  const t = useTranslations('admin.jams');
  const tc = useTranslations('common');
  const locale = useLocale();
  const act = useAct();
  const jams = useRepoQuery((repo) => repo.growth.adminJams(), [], { topics: ['jams'] });
  const [editing, setEditing] = useState<JamInput | null>(null);
  const save = async () => {
    if (!editing) return;
    if (await act(async () => (await getRepo()).growth.saveJam(editing), t('saved'))) setEditing(null);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="jams-admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing(newJam())} data-testid="jam-new">
          {t('new')}
        </Button>
      </div>
      {editing ? (
        <Card className="grid gap-3 p-4 sm:grid-cols-2" data-testid="jam-form">
          <TextField label={t('fieldTitle')} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} data-testid="jam-title" />
          <TextField label={t('fieldSlug')} hint={t('slugHint')} value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })} data-testid="jam-slug" />
          <TextField label={t('fieldTheme')} value={editing.theme} onChange={(e) => setEditing({ ...editing, theme: e.target.value })} data-testid="jam-theme" />
          <SelectField
            label={t('fieldStatus')}
            value={editing.status}
            onChange={(e) => setEditing({ ...editing, status: e.target.value as JamStatus })}
            options={(['draft', 'published', 'closed'] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
            data-testid="jam-status"
          />
          <TextField label={t('fieldStarts')} type="datetime-local" value={toLocalInput(editing.startsAt)} onChange={(e) => setEditing({ ...editing, startsAt: fromLocalInput(e.target.value) })} />
          <TextField label={t('fieldEnds')} type="datetime-local" value={toLocalInput(editing.endsAt)} onChange={(e) => setEditing({ ...editing, endsAt: fromLocalInput(e.target.value) })} />
          <TextAreaField className="sm:col-span-2" label={t('fieldDescription')} rows={5} value={editing.descriptionMd} onChange={(e) => setEditing({ ...editing, descriptionMd: e.target.value })} />
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={() => void save()} data-testid="jam-save">
              {t('save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {tc('cancel')}
            </Button>
          </div>
        </Card>
      ) : null}
      {jams.loading && !jams.data ? <Skeleton className="h-40 w-full" /> : null}
      {(jams.data ?? []).length === 0 && !editing && !jams.loading ? <EmptyState title={t('empty')} size="sm" /> : null}
      {(jams.data ?? []).map((jam) => (
        <Card key={jam.id} className="flex flex-col gap-3 p-4" data-testid="jam-row">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xl font-semibold">{jam.title}</span>
            <Badge tone={jam.status === 'published' ? 'success' : jam.status === 'draft' ? 'warning' : 'neutral'}>{t(`status.${jam.status}`)}</Badge>
            <span className="text-sm text-fg-muted">
              {formatDate(jam.startsAt, locale)} – {formatDate(jam.endsAt, locale)} · {t('entryCount', { count: jam.entries })}
            </span>
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setEditing({ ...jam })}>
                {t('edit')}
              </Button>
              <IconButton size="sm" label={t('delete')} onClick={() => void act(async () => (await getRepo()).growth.deleteJam(jam.id), t('deleted'))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            </span>
          </div>
          <JamRanks jam={jam} />
        </Card>
      ))}
    </div>
  );
}

/** Delete with a confirm step and a required reason, which is kept in the audit log. */
function DeleteWithReason({ what, onDelete, testId }: { what: string; onDelete: (reason: string) => Promise<unknown>; testId: string }) {
  const t = useTranslations('admin.moderation');
  const tc = useTranslations('common');
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      <Button size="sm" variant="danger" icon={<Trash2 aria-hidden="true" className="size-4" />} onClick={() => setOpen(true)} data-testid={testId}>
        {t('delete')}
      </Button>
      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={t('deleteTitle', { what })}
          description={t('deleteBody')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={reason.trim().length < 3}
                onClick={() =>
                  void act(() => onDelete(reason.trim()), t('deleted')).then((ok) => {
                    if (ok) setOpen(false);
                  })
                }
                data-testid={`${testId}-confirm`}
              >
                {t('deleteConfirm')}
              </Button>
            </>
          }
        >
          <TextAreaField label={t('deleteReason')} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testId}-reason`} />
        </Dialog>
      ) : null}
    </>
  );
}

const GAME_STATUSES: GameStatus[] = ['draft', 'in_review', 'changes_requested', 'spark', 'rise', 'featured', 'paused', 'removed'];

/** Every game on the site: search, change its status, or delete it. */
function GamesModeration() {
  const t = useTranslations('admin.moderation');
  const locale = useLocale();
  const act = useAct();
  const [query, setQuery] = useState('');
  const games = useRepoQuery((repo) => repo.growth.allGames(query), [query], { topics: ['admin', 'catalogue', 'dev-games'] });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t('gamesIntro')}</p>
      <TextField label={t('searchGames')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="game-search" />
      {games.loading && !games.data ? <Skeleton className="h-40 w-full" /> : null}
      {(games.data ?? []).length === 0 && !games.loading ? <EmptyState title={t('noGames')} size="sm" /> : null}
      <ul className="flex flex-col gap-2">
        {(games.data ?? []).map((g) => (
          <li key={g.id}>
            <Card className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="mod-game-row">
              <span className="min-w-0">
                <span className="block font-bold">{g.title}</span>
                <span className="text-fg-muted">
                  {g.studioName} · /{g.slug} · {formatDate(g.updatedAt, locale)}
                </span>
              </span>
              {g.autoReviewStatus ? (
                <Badge tone={g.autoReviewStatus === 'pass' ? 'success' : g.autoReviewStatus === 'warn' ? 'warning' : 'danger'}>{t(`auto.${g.autoReviewStatus}`)}</Badge>
              ) : null}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <SelectField
                  label={t('status')}
                  hideLabel
                  className="w-44"
                  value={g.status}
                  onChange={(e) => {
                    const status = e.target.value as GameStatus;
                    void act(async () => (await getRepo()).admin.setGameStatus(g.id, status, t('statusByModerator')), t('statusSaved'));
                  }}
                  options={GAME_STATUSES.map((st) => ({ value: st, label: t(`gameStatus.${st}`) }))}
                  data-testid="mod-game-status"
                />
                <DeleteWithReason what={g.title} testId="mod-game-delete" onDelete={async (reason) => (await getRepo()).growth.deleteGame(g.id, reason)} />
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reports() {
  const t = useTranslations('admin.moderation');
  const locale = useLocale();
  const act = useAct();
  const reports = useRepoQuery((repo) => repo.growth.reports(), [], { topics: ['admin'] });
  const rows = [...(reports.data ?? [])].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
  if (reports.loading && !reports.data) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return <EmptyState title={t('noReports')} size="sm" />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id}>
          <Card className="flex flex-col gap-2 p-3 text-sm" data-testid="report-row">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={r.status === 'open' ? 'warning' : r.status === 'actioned' ? 'success' : 'neutral'}>{t(`reportStatus.${r.status}`)}</Badge>
              <Badge>{r.kind}</Badge>
              <span className="font-bold">{r.targetLabel}</span>
              <span className="text-fg-muted">{formatDate(r.createdAt, locale)}</span>
            </div>
            <p className="whitespace-pre-wrap">{r.reason || t('noReason')}</p>
            {r.status === 'open' ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void act(async () => (await getRepo()).growth.resolveReport(r.id, 'actioned'), t('resolved'))} data-testid="report-action">
                  {t('markActioned')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void act(async () => (await getRepo()).growth.resolveReport(r.id, 'dismissed'), t('resolved'))}>
                  {t('dismiss')}
                </Button>
              </div>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Users() {
  const t = useTranslations('admin.moderation');
  const act = useAct();
  const [query, setQuery] = useState('');
  const users = useRepoQuery((repo) => repo.growth.findUsers(query), [query], { topics: ['admin'] });
  return (
    <div className="flex flex-col gap-3">
      <TextField label={t('searchUsers')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="user-search" />
      {(users.data ?? []).length === 0 && !users.loading ? <EmptyState title={t('noUsers')} size="sm" /> : null}
      <ul className="flex flex-col gap-2">
        {(users.data ?? []).map((u) => (
          <li key={u.id}>
            <Card className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="user-row">
              <span className="font-bold">{u.username}</span>
              {u.displayName ? <span className="text-fg-muted">{u.displayName}</span> : null}
              {u.role !== 'player' ? <Badge tone="glow">{u.role}</Badge> : null}
              {u.isMinor ? <Badge>{t('minor')}</Badge> : null}
              {u.banned ? <Badge tone="danger">{t('banned')}</Badge> : null}
              <span className="ml-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void act(async () => (await getRepo()).growth.setUser(u.id, { role: u.role === 'admin' ? 'player' : 'admin' }), t('roleSaved'))}
                  data-testid="user-role"
                >
                  {u.role === 'admin' ? t('removeAdmin') : t('makeAdmin')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void act(async () => (await getRepo()).growth.setUser(u.id, { resetUsername: true }), t('nameReset'))}>
                  {t('resetName')}
                </Button>
                <Button
                  size="sm"
                  variant={u.banned ? 'secondary' : 'danger'}
                  onClick={() => void act(async () => (await getRepo()).growth.setUser(u.id, { banned: !u.banned }), u.banned ? t('unbanned') : t('bannedDone'))}
                  data-testid="user-ban"
                >
                  {u.banned ? t('unban') : t('ban')}
                </Button>
                <DeleteWithReason what={u.username} testId="user-delete" onDelete={async (reason) => (await getRepo()).growth.deleteUser(u.id, reason)} />
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Studios() {
  const t = useTranslations('admin.moderation');
  const act = useAct();
  const [query, setQuery] = useState('');
  const studios = useRepoQuery((repo) => repo.growth.findStudios(query), [query], { topics: ['admin'] });
  return (
    <div className="flex flex-col gap-3">
      <TextField label={t('searchStudios')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {(studios.data ?? []).length === 0 && !studios.loading ? <EmptyState title={t('noStudios')} size="sm" /> : null}
      <ul className="flex flex-col gap-2">
        {(studios.data ?? []).map((s) => (
          <li key={s.id}>
            <Card className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="studio-row">
              <span className="font-bold">{s.name}</span>
              <span className="text-fg-muted">/{s.slug}</span>
              {s.verified ? <Badge tone="glow">{t('verified')}</Badge> : null}
              {s.suspended ? <Badge tone="danger">{t('suspended')}</Badge> : null}
              <span className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void act(async () => (await getRepo()).growth.setStudio(s.id, { verified: !s.verified }), t('studioSaved'))}>
                  {s.verified ? t('unverify') : t('verify')}
                </Button>
                <Button
                  size="sm"
                  variant={s.suspended ? 'secondary' : 'danger'}
                  onClick={() => void act(async () => (await getRepo()).growth.setStudio(s.id, { suspended: !s.suspended }), t('studioSaved'))}
                >
                  {s.suspended ? t('unsuspend') : t('suspend')}
                </Button>
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Devlogs() {
  const t = useTranslations('admin.moderation');
  const locale = useLocale();
  const act = useAct();
  const logs = useRepoQuery((repo) => repo.growth.adminDevlogs(), [], { topics: ['admin', 'devlogs'] });
  if (logs.loading && !logs.data) return <Skeleton className="h-40 w-full" />;
  if ((logs.data ?? []).length === 0) return <EmptyState title={t('noDevlogs')} size="sm" />;
  return (
    <ul className="flex flex-col gap-2">
      {(logs.data ?? []).map((d) => (
        <li key={d.id}>
          <Card className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="devlog-row">
            <span className="font-bold">{d.title}</span>
            <span className="text-fg-muted">
              {d.studioName} · {formatDate(d.publishedAt, locale)}
            </span>
            {d.hidden ? <Badge tone="danger">{t('hidden')}</Badge> : null}
            <Button
              size="sm"
              variant={d.hidden ? 'secondary' : 'danger'}
              className="ml-auto"
              onClick={() => void act(async () => (await getRepo()).growth.hideDevlog(d.id, !d.hidden), d.hidden ? t('shownDone') : t('hiddenDone'))}
              data-testid="devlog-hide"
            >
              {d.hidden ? t('unhide') : t('hide')}
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Reports from players, plus the tools to act on them: games, accounts, studios and devlogs. */
export function Moderation() {
  const t = useTranslations('admin.moderation');
  const [tab, setTab] = useState('reports');
  return (
    <div className="flex flex-col gap-4" data-testid="moderation">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <Tabs
        label={t('title')}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'reports', label: t('tabReports'), content: <Reports /> },
          { id: 'games', label: t('tabGames'), content: <GamesModeration /> },
          { id: 'users', label: t('tabUsers'), content: <Users /> },
          { id: 'studios', label: t('tabStudios'), content: <Studios /> },
          { id: 'devlogs', label: t('tabDevlogs'), content: <Devlogs /> },
        ]}
      />
    </div>
  );
}

function QuestRow({ quest }: { quest: AdminQuest }) {
  const t = useTranslations('admin.progression');
  const act = useAct();
  const [target, setTarget] = useState(String(quest.target));
  const [reward, setReward] = useState(String(quest.reward));
  const [active, setActive] = useState(quest.active);
  const dirty = Number(target) !== quest.target || Number(reward) !== quest.reward || active !== quest.active;
  return (
    <li>
      <Card className="flex flex-wrap items-end gap-3 p-3 text-sm" data-testid="quest-row">
        <span className="min-w-40 flex-1">
          <span className="block font-bold">{quest.title}</span>
          <span className="text-fg-muted">
            {quest.code} · {t(quest.period)}
          </span>
        </span>
        <TextField label={t('target')} type="number" min={1} className="w-24" value={target} onChange={(e) => setTarget(e.target.value)} />
        <TextField label={t('reward')} type="number" min={1} max={1000} className="w-24" value={reward} onChange={(e) => setReward(e.target.value)} data-testid="quest-reward" />
        <Switch compact label={t('active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => void act(async () => (await getRepo()).growth.saveQuest(quest.code, { target: Number(target), reward: Number(reward), active }), t('saved'))}
          data-testid="quest-save"
        >
          {t('save')}
        </Button>
      </Card>
    </li>
  );
}

function CosmeticRow({ item }: { item: AdminCosmetic }) {
  const t = useTranslations('admin.progression');
  const act = useAct();
  const [cost, setCost] = useState(String(item.cost));
  const [minLevel, setMinLevel] = useState(String(item.minLevel));
  const [active, setActive] = useState(item.active);
  const dirty = Number(cost) !== item.cost || Number(minLevel) !== item.minLevel || active !== item.active;
  return (
    <li>
      <Card className="flex flex-wrap items-end gap-3 p-3 text-sm" data-testid="cosmetic-row">
        <span className="min-w-40 flex-1">
          <span className="block font-bold">{item.name}</span>
          <span className="text-fg-muted">
            {item.slot} · {item.code}
          </span>
        </span>
        <TextField label={t('cost')} type="number" min={0} className="w-24" value={cost} onChange={(e) => setCost(e.target.value)} />
        <TextField label={t('minLevel')} type="number" min={1} className="w-24" value={minLevel} onChange={(e) => setMinLevel(e.target.value)} />
        <Switch compact label={t('active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => void act(async () => (await getRepo()).growth.saveCosmetic(item.id, { cost: Number(cost), minLevel: Number(minLevel), active }), t('saved'))}
        >
          {t('save')}
        </Button>
      </Card>
    </li>
  );
}

/** Tune Brain Quests (target, reward, on or off) and locker items (price, level, on or off). */
export function ProgressionEditor() {
  const t = useTranslations('admin.progression');
  const [tab, setTab] = useState('quests');
  const quests = useRepoQuery((repo) => repo.growth.adminQuests(), [], { topics: ['quests'] });
  const cosmetics = useRepoQuery((repo) => repo.growth.adminCosmetics(), [], { topics: ['profile'] });
  return (
    <div className="flex flex-col gap-4" data-testid="progression-editor">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <Tabs
        label={t('title')}
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'quests',
            label: t('tabQuests'),
            content: quests.data ? (
              <ul className="flex flex-col gap-2">
                {quests.data.map((q) => (
                  <QuestRow key={`${q.code}:${q.target}:${q.reward}:${q.active}`} quest={q} />
                ))}
              </ul>
            ) : (
              <Skeleton className="h-40 w-full" />
            ),
          },
          {
            id: 'cosmetics',
            label: t('tabCosmetics'),
            content: cosmetics.data ? (
              <ul className="flex flex-col gap-2">
                {cosmetics.data.map((c) => (
                  <CosmeticRow key={`${c.id}:${c.cost}:${c.minLevel}:${c.active}`} item={c} />
                ))}
              </ul>
            ) : (
              <Skeleton className="h-40 w-full" />
            ),
          },
        ]}
      />
    </div>
  );
}
