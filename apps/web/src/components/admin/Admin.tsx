'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Skeleton,
  Switch,
  TextAreaField,
  buttonClass,
  useToast,
  type BadgeTone,
} from '@brainstorming/ui';
import { PreQaReportView } from '@/components/dev/PreQaReportView';
import { OwnerCodeGate } from './OwnerCode';
import { GameStatusBadge } from '@/components/dev/StatusBadge';
import { GameFrame } from '@/components/game/GameFrame';
import { localizePath } from '@/i18n/config';
import { Link, useLocale } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { IS_MOCK, PLAY_ORIGIN } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import { QA_CHECKLIST, type QaChecklistItem } from '@/lib/data/devTypes';
import type { GameSummary } from '@/lib/data/types';
import { Markdown } from '@/lib/domain/markdown';
import { sparkDays } from '@/lib/domain/spark';
import { grade, sparkVerdict, summarise } from '@/lib/domain/kpis';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { isStaff, useSession } from '@/lib/hooks/useSession';

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  const ta = useTranslations('auth');
  const { user, ready } = useSession();
  let body: ReactNode = children;
  if (!ready) body = <Skeleton className="h-64 w-full" />;
  else if (!user)
    body = (
      <EmptyState
        title={ta('loginRequiredTitle')}
        description={ta('loginRequiredBody')}
        action={<Button onClick={() => void requestLogin()}>{ta('logIn')}</Button>}
      />
    );
  else if (!isStaff(user))
    body = (
      <EmptyState
        title={t('notAllowedTitle')}
        description={
          <>
            {t('notAllowedBody')} <span data-testid="not-allowed-email">{t('notAllowedWho', { email: user.email })}</span>
            <span className="mt-2 block">{IS_MOCK ? t('notAllowedHowMock') : t('notAllowedHowLive')}</span>
          </>
        }
        art="sad"
      />
    );
  else body = <OwnerCodeGate userId={user.id}>{children}</OwnerCodeGate>;
  return <div className="page">{body}</div>;
}

export function useAct() {
  const tc = useTranslations('common');
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, { tone: 'success' });
      return true;
    } catch (err) {
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
      return false;
    }
  };
}

export function AdminOverview() {
  const t = useTranslations('admin.overview');
  const act = useAct();
  const queue = useRepoQuery((repo) => repo.admin.qaQueue(), [], { topics: ['qa'] });
  const spark = useRepoQuery((repo) => repo.admin.sparkGames(), [], { topics: ['qa', 'catalogue'] });
  const stats = [
    { label: t('inQueue'), value: queue.data?.length ?? 0, href: '/admin/qa' },
    { label: t('spark'), value: spark.data?.length ?? 0, href: '/admin/spark' },
    { label: t('sparkDue'), value: (spark.data ?? []).filter((s) => s.windowOver).length, href: '/admin/spark' },
  ];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="block">
            <Card interactive className="p-4">
              <p className="text-xs font-bold tracking-wide text-fg-muted uppercase">{s.label}</p>
              <p className="font-display text-3xl font-bold">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Button variant="outline" className="self-start" onClick={() => void act(async () => (await getRepo()).admin.runDailyJobs(), t('jobsDone'))}>
        {t('runJobs')}
      </Button>
    </div>
  );
}

const PRE_QA_TONE: Record<string, BadgeTone> = { pass: 'success', warn: 'warning', fail: 'danger' };

export function QaQueue() {
  const t = useTranslations('admin.qa');
  const locale = useLocale();
  const { data, loading } = useRepoQuery((repo) => repo.admin.qaQueue(), [], { topics: ['qa'] });
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-4" data-testid="qa-queue">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      {(data ?? []).length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-left">
              <tr>
                {['game', 'studio', 'version', 'submitted', 'preQa'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-display">
                    {t(h as 'game')}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t('review')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((item) => (
                <tr key={item.versionId} className="border-t border-border" data-testid="qa-row">
                  <td className="px-3 py-2 font-bold">
                    {item.title} <Badge className="ml-1">{item.isUpdate ? t('update') : t('newGame')}</Badge>
                  </td>
                  <td className="px-3 py-2">{item.studioName}</td>
                  <td className="px-3 py-2">v{item.version}</td>
                  <td className="px-3 py-2">{formatDate(item.submittedAt, locale)}</td>
                  <td className="px-3 py-2">{item.preQaStatus ? <Badge tone={PRE_QA_TONE[item.preQaStatus]}>{item.preQaStatus}</Badge> : '–'}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/qa/review?v=${item.versionId}`} className={buttonClass({ size: 'sm' })} data-testid="qa-review-link">
                      {t('review')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TEMPLATES = ['absolute', 'slow', 'covers', 'ads', 'content'] as const;

export function QaReview() {
  const t = useTranslations('admin.review');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const act = useAct();
  const versionId = useSearchParams().get('v') ?? '';
  const { data, loading } = useRepoQuery((repo) => repo.admin.qaItem(versionId), [versionId]);
  const [checklist, setChecklist] = useState<Partial<Record<QaChecklistItem, boolean>>>({});
  const [notes, setNotes] = useState('');
  const [schoolSafe, setSchoolSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setSchoolSafe(data?.game.schoolSafe ?? false), [data?.game.schoolSafe]);

  if (loading && !data) return <Skeleton className="h-96 w-full" />;
  if (!data) return <EmptyState title={tc('errorTitle')} />;
  const { game, version, media, studio, previous } = data;
  const cover = media.find((m) => m.kind === 'cover_landscape' && m.isActive && !m.variantLabel);
  const frameGame: GameSummary = {
    id: game.id, slug: game.slug, title: game.title, shortDescription: game.shortDescription, category: game.category,
    tags: game.tags, orientation: game.orientation, platforms: game.platforms, isMultiplayer: game.isMultiplayer,
    sizeBytes: version.totalBytes, initialLoadBytes: null, status: 'draft', schoolSafe: game.schoolSafe, releasedAt: null,
    updatedAt: game.updatedAt, sparkStartedAt: null, studio: { id: studio.id, slug: studio.slug, name: studio.name, country: studio.country, isFirstParty: studio.isFirstParty, verified: studio.verified },
    cover: cover ?? null, coverPortrait: null, coverSquare: null, preview: null, previewPortrait: null, coverVariants: [],
    stats: { plays: 0, plays7d: 0, rating10: null, votes: 0, likes: 0, dislikes: 0 },
    versionId: version.id, version: version.version, playPath: `${version.storagePrefix}/${version.entryFile}`, usesSdk: version.usesSdk,
  };

  const decide = async (action: 'approve' | 'changes' | 'reject') => {
    setBusy(true);
    const ok = await act(
      async () => (await getRepo()).admin.qaDecide({ versionId, action, notes, checklist, schoolSafe }),
      t('done'),
    );
    setBusy(false);
    if (ok) router.push(localizePath('/admin/qa', locale));
  };

  return (
    <div className="flex flex-col gap-5" data-testid="qa-review">
      <Link href="/admin/qa" className="inline-flex items-center gap-1 text-sm font-bold text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('back')}
      </Link>
      <h1 className="text-3xl font-bold">{t('title', { title: game.title, version: version.version })}</h1>
      <p className="text-sm text-fg-muted">
        {studio.name} · <GameStatusBadge status={game.status} />
      </p>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          {playing ? (
            <GameFrame game={frameGame} src={`${PLAY_ORIGIN}/${frameGame.playPath}`} preview autoStart />
          ) : (
            <Button size="lg" className="self-start" onClick={() => setPlaying(true)} data-testid="qa-play">
              {t('play')}
            </Button>
          )}
          {version.preQaReport ? (
            <Card className="p-4">
              <PreQaReportView report={version.preQaReport} />
            </Card>
          ) : null}
          <Card className="p-4">
            <h2 className="mb-2 text-xl font-semibold">{t('media')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.filter((m) => m.isActive).map((m) =>
                m.kind.startsWith('preview') ? (
                  <video key={m.id} src={m.url} muted controls className="w-full rounded-control" />
                ) : (
                  <img key={m.id} src={m.url} alt={m.kind} className="w-full rounded-control border border-border" />
                ),
              )}
            </div>
          </Card>
          <Card className="prose-bg p-4">
            <h2>{t('content')}</h2>
            <p>
              <strong>{game.shortDescription}</strong>
            </p>
            <Markdown source={game.descriptionMd} />
            <Markdown source={game.howToPlayMd} />
            {game.faq.map((f, i) => (
              <p key={i}>
                <strong>{f.q}</strong> {f.a}
              </p>
            ))}
          </Card>
        </div>
        <Card className="flex h-fit flex-col gap-4 p-4 xl:sticky xl:top-20">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-display text-lg font-semibold">{t('checklist')}</legend>
            {QA_CHECKLIST.map((item) => (
              <Checkbox
                key={item}
                label={t(`items.${item}`)}
                checked={Boolean(checklist[item])}
                onChange={(e) => setChecklist((c) => ({ ...c, [item]: e.target.checked }))}
              />
            ))}
          </fieldset>
          <Switch label={t('schoolSafe')} checked={schoolSafe} onChange={(e) => setSchoolSafe(e.target.checked)} />
          <TextAreaField label={t('notes')} hint={t('notesHint')} rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="qa-notes" />
          <div>
            <p className="mb-1 text-xs font-bold tracking-wide text-fg-muted uppercase">{t('templates')}</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((k) => (
                <button key={k} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs font-bold hover:bg-surface-2" onClick={() => setNotes((n) => (n ? `${n}\n\n` : '') + t(`tpl.${k}`))}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button loading={busy} onClick={() => void decide('approve')} data-testid="qa-approve">
              {game.releasedAt ? t('approveUpdate') : t('approve')}
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => void decide('changes')} data-testid="qa-changes">
              {t('changes')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void decide('reject')}>
              {t('reject')}
            </Button>
          </div>
          {previous.length ? (
            <div>
              <h2 className="font-semibold">{t('history')}</h2>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {previous.map((p, i) => (
                  <li key={i}>
                    <Badge>{p.action}</Badge> {formatDate(p.createdAt, locale)} {p.notes}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export function SparkDecisions() {
  const t = useTranslations('admin.spark');
  const tk = useTranslations('dev.kpi');
  const act = useAct();
  const { data, loading } = useRepoQuery((repo) => repo.admin.sparkGames(), [], { topics: ['qa', 'catalogue'] });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const rows = useMemo(
    () =>
      (data ?? []).map((row) => {
        const s = summarise(row.kpis.days);
        return { row, s, verdict: sparkVerdict(s, row.usesSdk) };
      }),
    [data],
  );
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  const pctl = (v: number | undefined) => (v == null ? '' : ` · ${t('percentile', { pct: Math.round(v * 100) })}`);
  return (
    <div className="flex flex-col gap-4" data-testid="spark-decisions">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      {rows.length === 0 ? <EmptyState title={t('empty')} size="sm" /> : null}
      {rows.map(({ row, s, verdict }) => {
        const reason = reasons[row.game.id] ?? verdict.reason;
        const kpis = { plays: s.plays, conversion: s.conversion, avgSessionSec: s.avgSessionSec, d1: s.d1, d7: s.d7, percentiles: row.kpis.percentiles };
        return (
          <Card key={row.game.id} className="flex flex-col gap-3 p-4" data-testid="spark-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-xl font-semibold">{row.game.title}</span>
              <span className="text-sm text-fg-muted">{row.studioName}</span>
              <Badge tone={row.windowOver ? 'warning' : 'neutral'}>{row.windowOver ? t('windowOver') : t('running')}</Badge>
              <Badge>{t('day', { day: Math.max(1, Math.ceil(sparkDays(row.game.sparkStartedAt ?? row.game.createdAt))) })}</Badge>
              <Badge tone={row.usesSdk ? 'glow' : 'danger'}>{row.usesSdk ? t('sdk') : t('noSdk')}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <div>
                <dt className="text-fg-muted">{tk('plays')}</dt>
                <dd className="font-bold">{s.plays}{pctl(row.kpis.percentiles?.plays)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{tk('conversion')}</dt>
                <dd className="font-bold">
                  {s.conversion == null ? '–' : `${Math.round(s.conversion * 100)}%`} ({tk(`grade.${grade('conversion', s.conversion)}`)}){pctl(row.kpis.percentiles?.conversion)}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">{tk('session')}</dt>
                <dd className="font-bold">{s.avgSessionSec == null ? '–' : `${Math.round(s.avgSessionSec / 60)} min`}{pctl(row.kpis.percentiles?.session)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{tk('d1')}</dt>
                <dd className="font-bold">{s.d1 == null ? '–' : `${Math.round(s.d1 * 100)}%`}{pctl(row.kpis.percentiles?.d1)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{tk('d7')}</dt>
                <dd className="font-bold">{s.d7 == null ? '–' : `${Math.round(s.d7 * 100)}%`}</dd>
              </div>
            </dl>
            <p className="text-sm font-bold">{t('suggest', { action: verdict.recommend === 'promote' ? t('promote') : t('decline') })}</p>
            <TextAreaField label={t('reason')} rows={3} value={reason} onChange={(e) => setReasons((r) => ({ ...r, [row.game.id]: e.target.value }))} data-testid="spark-reason" />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!row.usesSdk}
                onClick={() => void act(async () => (await getRepo()).admin.sparkDecide(row.game.id, true, reason, kpis), t('decided'))}
                data-testid="spark-promote"
              >
                {t('promote')}
              </Button>
              <Button variant="secondary" onClick={() => void act(async () => (await getRepo()).admin.sparkDecide(row.game.id, false, reason, kpis), t('decided'))} data-testid="spark-decline">
                {t('decline')}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function AuditLog() {
  const t = useTranslations('admin.audit');
  const locale = useLocale();
  const { data, loading } = useRepoQuery((repo) => repo.admin.audit(300), [], { topics: ['qa', 'admin', 'catalogue'] });
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      {(data ?? []).length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-left">
              <tr>
                {(['when', 'who', 'action', 'target'] as const).map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-display">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((a) => (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(a.createdAt, locale)} {new Date(a.createdAt).toLocaleTimeString()}</td>
                  <td className="px-3 py-2">{a.actor}</td>
                  <td className="px-3 py-2 font-bold">{a.action}</td>
                  <td className="px-3 py-2">
                    {a.targetType}:{a.targetId.slice(0, 8)}
                    <details>
                      <summary className="text-xs text-fg-muted">detail</summary>
                      <pre className="max-w-md overflow-auto text-xs">{JSON.stringify(a.detail, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
