'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Copy, ExternalLink, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ProgressBar, Skeleton, buttonClass, useToast } from '@brainstorming/ui';
import { localizePath } from '@/i18n/config';
import { Link, useLocale } from '@/i18n/navigation';
import { getRepo, RepoError } from '@/lib/data';
import { summarise } from '@/lib/domain/kpis';
import { SPARK_MAX_DAYS, SPARK_MIN_PLAYS, sparkDays, sparkProgress } from '@/lib/domain/spark';
import { getPreviewToken } from '@/lib/dev/previewTokens';
import { formatBytes, formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { BuildUpload } from './BuildUpload';
import { GrowthPanel } from './GrowthPanel';
import { PreQaReportView } from './PreQaReportView';
import { GameStatusBadge, QaBadge } from './StatusBadge';

export function GameManage() {
  const t = useTranslations('dev.game');
  const td = useTranslations('dev.dashboard');
  const tc = useTranslations('common');
  const toast = useToast();
  const locale = useLocale();
  const id = useSearchParams().get('id') ?? '';
  const detail = useRepoQuery((repo) => repo.dev.game(id), [id], { topics: ['dev-games', 'catalogue'] });
  const [busy, setBusy] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const d = detail.data;

  // While the hosted pre-QA bot runs, poll for its report.
  const running = d?.versions.some((v) => v.qaStatus === 'pre_qa_running');
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => detail.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [running, detail]);

  const sparkKpis = useRepoQuery(
    (repo) =>
      d?.game.status === 'spark' && d.game.sparkStartedAt
        ? repo.dev.kpis(d.game.id, d.game.sparkStartedAt.slice(0, 10), new Date().toISOString().slice(0, 10))
        : Promise.resolve(null),
    [d?.game.id, d?.game.status],
    { topics: ['catalogue'] },
  );

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast(done, { tone: 'success' });
    } catch (err) {
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (detail.loading && !d) return <Skeleton className="h-96 w-full" />;
  if (!d) return <EmptyState title={tc('errorTitle')} />;
  const { game, versions, launches, reviews } = d;
  const latest = versions[0];
  const canSubmit = latest && ['pre_qa_passed', 'pre_qa_warn'].includes(latest.qaStatus) && ['draft', 'changes_requested', 'paused', 'spark', 'rise', 'featured'].includes(game.status);
  const plays = sparkKpis.data ? summarise(sparkKpis.data.days).plays : game.plays;
  const lastDecision = launches.find((l) => l.decision);

  return (
    <div className="flex flex-col gap-5" data-testid="game-manage">
      <Link href="/dev" className="inline-flex items-center gap-1 text-sm font-bold text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{game.title}</h1>
        <GameStatusBadge status={game.status} />
        <span className="ml-auto flex flex-wrap gap-2">
          <Link href={`/dev/games/edit?id=${game.id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>
            {td('edit')}
          </Link>
          {game.releasedAt ? (
            <Link href={`/game/${game.slug}`} hard className={buttonClass({ variant: 'outline', size: 'sm' })}>
              <ExternalLink aria-hidden="true" className="size-4" />
              {t('openPage')}
            </Link>
          ) : null}
        </span>
      </div>

      {game.status === 'spark' && game.sparkStartedAt ? (
        <Card className="p-4" data-testid="spark-status">
          <p className="flex items-center gap-2 font-display text-lg font-semibold">
            <Rocket aria-hidden="true" className="size-5 text-glow" />
            {t('sparkActive', { day: Math.max(1, Math.ceil(sparkDays(game.sparkStartedAt))), plays })}
          </p>
          <ProgressBar className="mt-2" value={sparkProgress(game.sparkStartedAt, plays) * 100} label={t('launch')} />
          <p className="mt-2 text-sm text-fg-muted">{t('sparkEnds')}</p>
          <p className="sr-only">{`${SPARK_MAX_DAYS} ${SPARK_MIN_PLAYS}`}</p>
        </Card>
      ) : null}

      {lastDecision ? (
        <Card className="p-4" data-testid="spark-decision">
          <h2 className="font-display text-lg font-semibold">{lastDecision.decision === 'promoted' ? t('riseInvite') : t('declined')}</h2>
          <p className="mt-1 text-sm">{lastDecision.reason}</p>
        </Card>
      ) : null}

      {reviews[0] && reviews[0].action !== 'approve' ? (
        <Card className="border-warning/60 p-4" data-testid="review-notes">
          <h2 className="font-display text-lg font-semibold">{t('reviewNotes')}</h2>
          <p className="mt-1 text-sm whitespace-pre-wrap">{reviews[0].notes}</p>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{t('submit')}</h2>
            <p className="text-sm text-fg-muted">{t('submitHint')}</p>
          </div>
          {canSubmit ? (
            <Link href={`/dev/games/edit?id=${game.id}&step=build`} className={buttonClass({ size: 'lg' })} data-testid="submit-review">
              {t('submit')}
            </Link>
          ) : (
            <Button size="lg" disabled data-testid="submit-review">
              {t('submit')}
            </Button>
          )}
        </div>
      </Card>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="versions" className="text-xl font-semibold">
            {t('versions')}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setShowUpload((v) => !v)} data-testid="upload-version">
            {t('uploadVersion')}
          </Button>
        </div>
        {showUpload || versions.length === 0 ? (
          <Card className="p-4">
            <BuildUpload
              gameId={game.id}
              suggestedVersion={String((Number.parseInt(latest?.version ?? '0', 10) || 0) + 1)}
              isLive={Boolean(game.releasedAt)}
              onUploaded={() => {
                setShowUpload(false);
                detail.refresh();
              }}
            />
          </Card>
        ) : null}
        {versions.map((v) => {
          const previewHref = localizePath(`/dev/preview?v=${v.id}`, locale);
          return (
            <Card key={v.id} className="flex flex-col gap-3 p-4" data-testid="version-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-semibold">v{v.version}</span>
                <QaBadge status={v.qaStatus} />
                {v.isCurrent ? <Badge tone="success">{t('current')}</Badge> : null}
                {v.usesSdk ? <Badge tone="glow">SDK</Badge> : null}
                <span className="text-sm text-fg-muted">
                  {formatBytes(v.totalBytes)} · {formatDate(v.createdAt, locale)}
                </span>
              </div>
              {v.qaStatus === 'pre_qa_running' ? <p role="status" className="text-sm">{t('preQaRunning')}</p> : null}
              {v.preQaReport ? (
                <details open={!v.isCurrent && v.qaStatus !== 'approved'}>
                  <summary className="cursor-pointer text-sm font-bold">{t('report')}</summary>
                  <div className="mt-2">
                    <PreQaReportView report={v.preQaReport} />
                  </div>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {['uploaded', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed'].includes(v.qaStatus) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === `qa-${v.id}`}
                    onClick={() =>
                      void act(`qa-${v.id}`, async () => {
                        const report = await (await getRepo()).dev.runPreQa(v.id);
                        if (!report) toast(t('preQaQueued'));
                      })
                    }
                    data-testid="run-pre-qa"
                  >
                    {v.preQaReport ? t('rerunPreQa') : t('runPreQa')}
                  </Button>
                ) : null}
                <PreviewLinkButton href={previewHref} versionId={v.id} />
                {v.qaStatus === 'approved' && !v.isCurrent ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === `rb-${v.id}`}
                    onClick={() => void act(`rb-${v.id}`, async () => (await getRepo()).dev.rollback(game.id, v.id), t('rolledBack'))}
                  >
                    {t('rollback')}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>

      {game.releasedAt ? <GrowthPanel gameId={game.id} /> : null}

      <div className="flex flex-wrap gap-2">
        {['spark', 'rise', 'featured'].includes(game.status) ? (
          <Button variant="outline" onClick={() => void act('pause', async () => (await getRepo()).dev.setStatus(game.id, 'paused'), t('paused'))}>
            {t('pause')}
          </Button>
        ) : null}
        {game.status === 'draft' ? (
          <Button
            variant="danger"
            onClick={() =>
              void act('delete', async () => {
                await (await getRepo()).dev.deleteGame(game.id);
                window.location.assign(localizePath('/dev', locale));
              }, t('deleted'))
            }
          >
            {t('deleteDraft')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The private preview link needs the version's token, which only the upload result knows. */
function PreviewLinkButton({ href, versionId }: { href: string; versionId: string }) {
  const t = useTranslations('dev.game');
  const toast = useToast();
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    const token = getPreviewToken(versionId);
    setFull(token ? `${window.location.origin}${href}&t=${token}` : null);
  }, [href, versionId]);
  if (!full) return null;
  return (
    <>
      <a href={full} target="_blank" rel="noopener" className={buttonClass({ size: 'sm', variant: 'outline' })} data-testid="preview-link">
        <ExternalLink aria-hidden="true" className="size-4" />
        {t('previewLink')}
      </a>
      <Button
        size="sm"
        variant="ghost"
        icon={<Copy aria-hidden="true" className="size-4" />}
        onClick={() => void navigator.clipboard.writeText(full).then(() => toast(t('previewCopied'), { tone: 'success' }))}
      >
        {t('copyPreview')}
      </Button>
    </>
  );
}
