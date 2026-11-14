'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, ChevronDown, Circle, Info, PanelRightClose, PanelRightOpen, QrCode, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Card, EmptyState, IconButton, Skeleton, Switch, Tabs, buttonClass, cn } from '@brainstorming/ui';
import { GameFrame } from '@/components/game/GameFrame';
import { Link } from '@/i18n/navigation';
import { PLAY_ORIGIN } from '@/lib/config';
import type { PreviewInfo } from '@/lib/data/devTypes';
import type { GameSummary } from '@/lib/data/types';
import type { PreQaCheck } from '@/lib/domain/preqa';
import { formatBytes } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import type { HostLogEntry } from '@/lib/sdk-host/bridge';
import { SDK_ITEMS, sdkSeen } from './SdkChecklist';

type RowStatus = 'pass' | 'warn' | 'fail' | 'pending' | 'info';
const SPARK_MAX_BYTES = 50 * 1048576;

function StatusIcon({ status }: { status: RowStatus }) {
  const common = 'size-4 shrink-0';
  if (status === 'pass') return <Check aria-hidden="true" className={cn(common, 'text-success')} />;
  if (status === 'fail') return <X aria-hidden="true" className={cn(common, 'text-danger')} />;
  if (status === 'warn') return <AlertTriangle aria-hidden="true" className={cn(common, 'text-warning')} />;
  if (status === 'info') return <Info aria-hidden="true" className={cn(common, 'text-glow')} />;
  return <Circle aria-hidden="true" className={cn(common, 'text-fg-muted')} />;
}

function Row({ status, label, detail, href, children, testId }: { status: RowStatus; label: ReactNode; detail?: ReactNode; href?: string; children?: ReactNode; testId?: string }) {
  const t = useTranslations('dev.preview');
  return (
    <li className="flex gap-2 py-1 text-sm" data-testid={testId} data-status={status}>
      <span className="pt-0.5">
        <StatusIcon status={status} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('font-bold', status === 'pending' && 'text-fg-muted')}>
          {label}
          {href ? (
            <Link href={href} className="ml-1 text-xs font-bold text-primary hover:underline">
              {t('readMore')}
            </Link>
          ) : null}
        </span>
        {detail ? <span className="text-xs text-fg-muted">{detail}</span> : null}
        {children}
      </span>
      <span className="sr-only">{t(`rowStatus.${status}`)}</span>
    </li>
  );
}

/** A collapsible group in the requirements tab. */
function Section({ title, hint, summary, defaultOpen, children, testId }: { title: string; hint?: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section className="rounded-control border border-border bg-surface-3" data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className="flex-1 font-bold">{title}</span>
        {summary}
        <span className={cn('flex size-7 items-center justify-center rounded-full transition-transform', open ? 'rotate-180 bg-primary text-primary-fg' : 'bg-surface-2')}>
          <ChevronDown aria-hidden="true" className="size-4" />
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-3 pt-2 pb-3">
          {hint ? <p className="mb-1 text-xs text-fg-muted">{hint}</p> : null}
          <ul>{children}</ul>
        </div>
      ) : null}
    </section>
  );
}

function PhoneQr() {
  const t = useTranslations('dev.preview');
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || src) return;
    void import('qrcode')
      .then((qr) => qr.toDataURL(window.location.href, { margin: 1, width: 200, color: { dark: '#0b0c0e', light: '#ffffff' } }))
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [open, src]);
  return (
    <div className="mt-1 flex flex-col gap-2">
      <button type="button" className="inline-flex items-center gap-1 self-start text-xs font-bold text-primary hover:underline" onClick={() => setOpen((o) => !o)} data-testid="preview-qr-toggle">
        <QrCode aria-hidden="true" className="size-3.5" />
        {open ? t('hideQr') : t('showQr')}
      </button>
      {open ? (
        <div className="flex flex-col gap-1">
          {src ? <img src={src} width={160} height={160} alt={t('qrAlt')} className="rounded-control bg-white p-1" data-testid="preview-qr" /> : <Skeleton className="size-40" />}
          <span className="text-xs text-fg-muted">{t('qrHint')}</span>
        </div>
      ) : null}
    </div>
  );
}

const check = (report: PreviewInfo['preQaReport'], id: string): PreQaCheck | undefined => report?.checks.find((c) => c.id === id);
const fromCheck = (c: PreQaCheck | undefined): RowStatus => (c ? (c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'warn') : 'pending');

function Requirements({ p, log }: { p: PreviewInfo; log: HostLogEntry[] }) {
  const t = useTranslations('dev.preview');
  const tq = useTranslations('dev.qa');
  const report = p.preQaReport;
  const seen = sdkSeen(log);
  const sdkLive = seen.has('init') || p.usesSdk;
  // With the SDK the limit applies to what loads before gameplay; without it, to the whole build.
  const initial = report?.desktop?.initialBytes ?? null;
  const measured = sdkLive && initial != null ? initial : p.totalBytes;
  const sizeStatus: RowStatus = measured > SPARK_MAX_BYTES ? 'fail' : 'pass';
  const loads = check(report, 'loads');
  const ads = check(report, 'external-ads');
  const paths = check(report, 'absolute-paths');
  const required = SDK_ITEMS.filter((i) => i.required);
  const optional = SDK_ITEMS.filter((i) => !i.required);
  const requiredDone = required.filter((i) => seen.has(i.id)).length;
  const basic: RowStatus[] = [sizeStatus, fromCheck(loads), fromCheck(ads), fromCheck(paths)];
  const basicFails = basic.filter((s) => s === 'fail').length;
  const sent = !['uploaded', 'pre_qa_running', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed'].includes(p.qaStatus);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="preview-requirements">
      <p className="text-sm text-fg-muted">
        {t('reqIntro')}{' '}
        <Link href="/dev/docs/launch-tiers" className="font-bold text-primary hover:underline">
          {t('reqIntroLink')}
        </Link>
      </p>

      <Section
        title={t('basicTitle')}
        hint={t('basicHint')}
        defaultOpen
        testId="req-basic"
        summary={<Badge tone={basicFails ? 'danger' : report ? 'success' : 'neutral'}>{basicFails ? t('problems', { count: basicFails }) : report ? t('allGood') : t('notChecked')}</Badge>}
      >
        <Row
          status={sizeStatus}
          label={t('reqSize')}
          detail={t('reqSizeDetail', { size: formatBytes(measured), kind: sdkLive && initial != null ? t('beforeGameplay') : t('wholeBuild') })}
          href="/dev/docs/requirements"
          testId="req-size"
        />
        <Row status={fromCheck(loads)} label={t('reqGameplay')} detail={loads?.detail ?? t('waitingPreQa')} href="/dev/docs/requirements" />
        <Row status={fromCheck(ads)} label={t('reqNoAds')} detail={ads?.detail ?? t('waitingPreQa')} href="/dev/docs/ad-rules" />
        <Row status="info" label={t('reqNoLogin')} detail={t('reqNoLoginDetail')} href="/dev/docs/sdk-rules" />
        <Row status={fromCheck(paths)} label={t('reqPaths')} detail={paths?.detail ?? t('waitingPreQa')} />
        <Row status={report?.mobile ? 'pass' : 'pending'} label={t('reqPhones')} detail={report?.mobile ? t('reqPhonesDetail') : t('waitingPreQa')}>
          <PhoneQr />
        </Row>
      </Section>

      <Section
        title={t('fullTitle')}
        hint={t('fullHint')}
        testId="req-full"
        summary={<Badge tone={requiredDone === required.length ? 'success' : 'warning'}>{t('progress', { done: requiredDone, total: required.length })}</Badge>}
      >
        {required.map((i) => (
          <Row key={i.id} status={seen.has(i.id) ? 'pass' : 'pending'} label={<code className="font-mono text-xs">{t(`sdk.${i.id}.call` as 'sdk.init.call')}</code>} detail={t(`sdk.${i.id}.label` as 'sdk.init.label')} testId="sdk-check" />
        ))}
      </Section>

      <Section title={t('extrasTitle')} hint={t('extrasHint')} testId="req-extras" summary={<Badge>{t('used', { count: optional.filter((i) => seen.has(i.id)).length })}</Badge>}>
        {optional.map((i) => (
          <Row key={i.id} status={seen.has(i.id) ? 'pass' : 'pending'} label={<code className="font-mono text-xs">{t(`sdk.${i.id}.call` as 'sdk.init.call')}</code>} detail={t(`sdk.${i.id}.label` as 'sdk.init.label')} />
        ))}
      </Section>

      <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
        {!sdkLive ? <p className="font-bold text-warning light:text-navy-950">{t('noSdk')}</p> : <p className="font-bold text-success light:text-navy-950">{t('sdkOk')}</p>}
        <p>
          <span className="text-fg-muted">{t('totalSize')}</span> <span className="font-bold" data-testid="preview-total-size">{formatBytes(p.totalBytes)}</span>
        </p>
        <p data-testid="preview-qa-state">{sent ? t('sentState', { state: tq(p.qaStatus as 'approved') }) : t('notSent')}</p>
        <Link href={`/dev/games/edit?id=${p.gameId}&step=build`} className={cn(buttonClass({ size: 'lg' }), 'mt-1 w-full justify-center')} data-testid="preview-continue">
          {t('continue')}
        </Link>
        <Link href="/dev/docs/sdk-rules" className="text-center text-xs font-bold text-primary hover:underline" data-testid="sdk-rules-link">
          {t('rules')}
        </Link>
      </div>
    </div>
  );
}

function LogTab({ log }: { log: HostLogEntry[] }) {
  const t = useTranslations('dev.preview');
  if (log.length === 0) return <p className="text-sm text-fg-muted">{t('noEvents')}</p>;
  return (
    <ol className="max-h-[60vh] overflow-auto font-mono text-xs" aria-live="polite" data-testid="sdk-log">
      {log.map((e, i) => (
        <li key={i} className="border-b border-border py-1">
          <span className="text-fg-muted">{new Date(e.at).toLocaleTimeString()} </span>
          <span className={e.direction === 'in' ? 'text-glow' : 'text-success'}>{e.direction === 'in' ? 'â†’' : 'â†'} </span>
          <span className="font-bold">{e.method}</span> <span className="break-all text-fg-muted">{e.detail.slice(0, 160)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Pre-QA findings that are not a pass, plus SDK calls that were refused or failed in this run. */
function warningsOf(p: PreviewInfo, log: HostLogEntry[]) {
  const fromReport = (p.preQaReport?.checks ?? []).filter((c) => c.status !== 'pass').map((c) => ({ key: `qa-${c.id}`, status: c.status === 'fail' ? ('fail' as const) : ('warn' as const), label: c.label, detail: c.fix ? `${c.detail} ${c.fix}` : c.detail }));
  const fromLog = log
    .filter((e) => e.direction === 'out' && /^"?(error|rejected)/.test(e.detail))
    .slice(-20)
    .map((e, i) => ({ key: `log-${i}-${e.at}`, status: 'warn' as const, label: e.method, detail: e.detail.slice(0, 200) }));
  return [...fromReport, ...fromLog];
}

function WarningsTab({ items }: { items: ReturnType<typeof warningsOf> }) {
  const t = useTranslations('dev.preview');
  if (items.length === 0) return <p className="text-sm text-fg-muted">{t('noWarnings')}</p>;
  return (
    <ul data-testid="preview-warnings">
      {items.map((w) => (
        <Row key={w.key} status={w.status} label={w.label} detail={w.detail} />
      ))}
    </ul>
  );
}

/**
 * Private preview of one build, before review: the game on the left with test settings under
 * it, and a side panel with the launch requirements, the live SDK log and warnings. Anyone with
 * the link can open it; nothing here counts towards KPIs or revenue.
 */
export function PreviewPage() {
  const t = useTranslations('dev.preview');
  const params = useSearchParams();
  const versionId = params.get('v') ?? '';
  const token = params.get('t') ?? '';
  const info = useRepoQuery((repo) => repo.dev.preview(versionId, token), [versionId, token], { topics: ['dev-games'] });
  const [log, setLog] = useState<HostLogEntry[]>([]);
  const [run, setRun] = useState(0);
  const [limitMidgame, setLimitMidgame] = useState(true);
  const [testAds, setTestAds] = useState(true);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState('requirements');
  const p = info.data;
  const warnings = useMemo(() => (p ? warningsOf(p, log) : []), [p, log]);

  if (info.loading && info.data === undefined) return <Skeleton className="aspect-video w-full" />;
  if (!p) return <EmptyState title={t('invalid')} art="sad" />;

  const relaunch = () => {
    setLog([]);
    setRun((r) => r + 1);
  };

  const game: GameSummary = {
    id: p.gameId,
    slug: p.slug,
    title: p.title,
    shortDescription: '',
    category: '',
    tags: [],
    orientation: p.orientation,
    platforms: [],
    isMultiplayer: false,
    sizeBytes: p.totalBytes,
    initialLoadBytes: null,
    status: 'draft',
    schoolSafe: false,
    releasedAt: null,
    updatedAt: '',
    sparkStartedAt: null,
    studio: { id: '', slug: '', name: '', country: null, isFirstParty: false, verified: false },
    cover: null,
    coverPortrait: null,
    coverSquare: null,
    preview: null,
    previewPortrait: null,
    coverVariants: [],
    stats: { plays: 0, plays7d: 0, rating10: null, votes: 0, likes: 0, dislikes: 0 },
    versionId: p.versionId,
    version: p.version,
    playPath: p.playPath,
    usesSdk: p.usesSdk,
  };

  return (
    <div className="flex flex-col gap-3" data-testid="preview-page">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{t('title', { title: p.title })}</h1>
        <Badge tone="glow">v{p.version}</Badge>
      </div>

      <div className={cn('grid gap-3', panel ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : 'xl:grid-cols-[minmax(0,1fr)_auto]')}>
        <div className="flex min-w-0 flex-col gap-3">
          <GameFrame
            key={run}
            game={game}
            src={`${PLAY_ORIGIN}/${p.playPath}`}
            preview
            autoStart
            previewOptions={{ limitMidgame, testAds }}
            onSdkLog={(entry) => setLog((l) => [...l.slice(-199), entry])}
          />
          <Card className="grid gap-3 p-3 md:grid-cols-[1fr_auto]" data-testid="preview-qa-bar">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-bold text-danger">{t('warning')}</p>
              <Link href="/dev/feedback" className={cn(buttonClass({ variant: 'outline', size: 'sm' }), 'self-start')}>
                {t('report')}
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{t('testSettings')}</span>
                <Button size="sm" icon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={relaunch} data-testid="preview-relaunch">
                  {t('relaunch')}
                </Button>
              </div>
              <Switch
                label={t('limitMidgame')}
                checked={limitMidgame}
                onChange={(e) => {
                  setLimitMidgame(e.target.checked);
                  relaunch();
                }}
                data-testid="preview-limit-midgame"
              />
              <Switch
                label={t('testAds')}
                checked={testAds}
                onChange={(e) => {
                  setTestAds(e.target.checked);
                  relaunch();
                }}
                data-testid="preview-test-ads"
              />
            </div>
          </Card>
        </div>

        {panel ? (
          <Card className="flex min-h-[32rem] flex-col gap-2 p-3" data-testid="preview-panel">
            <div className="flex items-start gap-1">
              <IconButton size="sm" label={t('hidePanel')} onClick={() => setPanel(false)}>
                <PanelRightClose aria-hidden="true" className="size-4" />
              </IconButton>
              <div className="min-w-0 flex-1">
                <Tabs
                  label={t('panel')}
                  value={tab}
                  onChange={setTab}
                  items={[
                    { id: 'requirements', label: t('tabRequirements'), content: <Requirements p={p} log={log} /> },
                    { id: 'log', label: t('tabLog', { count: log.length }), content: <LogTab log={log} /> },
                    { id: 'warnings', label: t('tabWarnings', { count: warnings.length }), content: <WarningsTab items={warnings} /> },
                  ]}
                />
              </div>
            </div>
          </Card>
        ) : (
          <div>
            <IconButton label={t('showPanel')} onClick={() => setPanel(true)} data-testid="preview-show-panel">
              <PanelRightOpen aria-hidden="true" className="size-5" />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
