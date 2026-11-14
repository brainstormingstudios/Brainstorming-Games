'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, Skeleton } from '@brainstorming/ui';
import type { DiscoveryReport } from '@/lib/data/growthTypes';
import { RANK, explorationLeft, rankBreakdown, type RankParts } from '@/lib/domain/ranking';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

const TrendChart = dynamic(() => import('@/components/dev/Charts'), { ssr: false, loading: () => <Skeleton className="h-[200px] w-full" /> });

const pct = (v: number | null, digits = 0) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`);
const count = (n: number) => Math.round(n).toLocaleString('en-IN');

/** The most each part can add to the score, in points. */
const MAX: Record<keyof RankParts, number> = {
  clickRate: RANK.weights.clickRate * 100,
  conversion: RANK.weights.conversion * 100,
  playtime: RANK.weights.playtime * 100,
  retention: RANK.weights.retention * 100,
  rating: RANK.weights.rating * 100,
  exploration: RANK.explorationBonus * 100,
  freshness: RANK.freshnessBonus * 100,
};
const PARTS = Object.keys(MAX) as (keyof RankParts)[];

/** The score as a ring: quick to read in a table or at the top of a page. */
export function RankRing({ score, size = 76 }: { score: number; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} data-testid="rank-ring">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span className="absolute font-display font-extrabold" style={{ fontSize: size * 0.3 }}>
        {Math.round(score)}
      </span>
    </span>
  );
}

/** Impressions → clicks → plays → plays of a minute or more. Each bar is a share of the first. */
function Funnel({ report }: { report: DiscoveryReport }) {
  const t = useTranslations('dev.discovery');
  const i = report.inputs;
  const engaged = i.conversion == null ? 0 : i.plays * i.conversion;
  const steps = [
    { key: 'impressions', value: i.impressions, rate: null as number | null },
    { key: 'clicks', value: i.clicks, rate: i.impressions > 0 ? i.clicks / i.impressions : null },
    { key: 'plays', value: i.plays, rate: i.clicks > 0 ? Math.min(1, i.plays / i.clicks) : null },
    { key: 'engaged', value: engaged, rate: i.conversion },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="flex flex-col gap-2" data-testid="funnel">
      {steps.map((s) => (
        <li key={s.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="font-bold">{t(`funnel.${s.key}`)}</span>
          <span className="h-7 overflow-hidden rounded-md bg-surface-3">
            <span
              className="block h-full rounded-md bg-primary"
              style={{ width: `${Math.max(s.value > 0 ? 2 : 0, (s.value / top) * 100)}%`, transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          </span>
          <span className="w-28 text-right tabular-nums">
            <span className="font-bold">{count(s.value)}</span>
            {s.rate != null ? <span className="ml-1.5 text-fg-muted">{pct(s.rate, 1)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Where the points of the score come from, part by part. */
function Breakdown({ report }: { report: DiscoveryReport }) {
  const t = useTranslations('dev.discovery');
  const points = rankBreakdown(report.inputs);
  return (
    <ul className="flex flex-col gap-2" data-testid="rank-breakdown">
      {PARTS.map((part) => (
        <li key={part} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="font-bold">{t(`parts.${part}`)}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-glow" style={{ width: `${(points[part] / MAX[part]) * 100}%`, transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }} />
          </span>
          <span className="w-20 text-right tabular-nums text-fg-muted">
            <span className="font-bold text-fg">{points[part].toFixed(1)}</span> / {MAX[part]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * How the discovery algorithm sees one game: its Brain Rank, the funnel from impression to a
 * real play, and where the score comes from. Shown to the game's developer and to staff.
 */
export function DiscoveryPanel({ gameId }: { gameId: string }) {
  const t = useTranslations('dev.discovery');
  const report = useRepoQuery((repo) => repo.growth.discovery(gameId), [gameId], { topics: ['catalogue', 'dev-games'] });
  if (report.loading && !report.data) return <Skeleton className="h-72 w-full" />;
  const d = report.data;
  if (!d) return null;
  const left = explorationLeft(d.inputs.impressions);
  const chart = d.byDay.map((p) => ({ label: p.day.slice(5), impressions: p.impressions, clicks: p.clicks }));
  return (
    <section aria-labelledby="discovery-title" className="flex flex-col gap-4" data-testid="discovery-panel">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <RankRing score={d.score} />
        <div className="min-w-0 flex-1">
          <h2 id="discovery-title" className="font-display text-xl font-bold">
            {t('title')}
          </h2>
          <p className="max-w-2xl text-sm text-fg-muted">{t('intro')}</p>
          <p className="mt-1 text-sm font-bold" data-testid="exploration-note">
            {left > 0 ? t('exploring', { count: left }) : t('explored')}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-fg-muted">{t('ctr')}</dt>
          <dd className="text-right font-bold tabular-nums">{pct(d.inputs.impressions > 0 ? d.inputs.clicks / d.inputs.impressions : null, 1)}</dd>
          <dt className="text-fg-muted">{t('session')}</dt>
          <dd className="text-right font-bold tabular-nums">{d.inputs.avgSessionSec == null ? '–' : `${(d.inputs.avgSessionSec / 60).toFixed(1)} min`}</dd>
          <dt className="text-fg-muted">{t('d1')}</dt>
          <dd className="text-right font-bold tabular-nums">{pct(d.inputs.d1)}</dd>
        </dl>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">{t('funnelTitle')}</h3>
          <Funnel report={d} />
          <p className="mt-3 text-xs text-fg-muted">{t('window')}</p>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">{t('breakdownTitle')}</h3>
          <Breakdown report={d} />
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">{t('chartTitle')}</h3>
        <TrendChart
          data={chart}
          series={[
            { key: 'impressions', name: t('funnel.impressions') },
            { key: 'clicks', name: t('funnel.clicks') },
          ]}
          kind="area"
          height={200}
          label={t('chartTitle')}
        />
      </Card>
    </section>
  );
}
