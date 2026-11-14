'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Skeleton, chipClass, type BadgeTone } from '@brainstorming/ui';
import { DiscoveryPanel } from '@/components/analytics/Discovery';
import { addDays, BENCHMARKS, grade, kpisToCsv, summarise, type Grade } from '@/lib/domain/kpis';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

const TrendChart = dynamic(() => import('./Charts'), { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> });

const GRADE_TONE: Record<Grade, BadgeTone> = { great: 'success', ok: 'primary', low: 'warning', unknown: 'neutral' };
const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);

export function KpiPage() {
  const t = useTranslations('dev.kpi');
  const tc = useTranslations('categories');
  const tr = useTranslations('game.reasons');
  const id = useSearchParams().get('id') ?? '';
  const [range, setRange] = useState(30);
  const today = new Date().toISOString().slice(0, 10);
  const from = addDays(today, -(range - 1));
  const game = useRepoQuery((repo) => repo.dev.game(id), [id]);
  const kpis = useRepoQuery((repo) => repo.dev.kpis(id, from, today), [id, from], { topics: ['catalogue'] });
  const days = useMemo(() => kpis.data?.days ?? [], [kpis.data]);
  const s = useMemo(() => summarise(days), [days]);
  const category = game.data?.game.category ?? '';

  const cards: { key: string; label: string; value: string; metric?: keyof typeof BENCHMARKS; raw?: number | null; pctl?: number }[] = [
    { key: 'plays', label: t('plays'), value: String(s.plays), pctl: kpis.data?.percentiles?.plays },
    { key: 'conversion', label: t('conversion'), value: pct(s.conversion), metric: 'conversion', raw: s.conversion, pctl: kpis.data?.percentiles?.conversion },
    { key: 'session', label: t('session'), value: s.avgSessionSec == null ? '–' : t('minutes', { count: Math.round((s.avgSessionSec / 60) * 10) / 10 }), metric: 'avgSessionSec', raw: s.avgSessionSec, pctl: kpis.data?.percentiles?.session },
    { key: 'd1', label: t('d1'), value: pct(s.d1), metric: 'd1', raw: s.d1, pctl: kpis.data?.percentiles?.d1 },
    { key: 'd7', label: t('d7'), value: pct(s.d7) },
    { key: 'load', label: t('loadTime'), value: s.loadMsP50 == null ? '–' : `${(s.loadMsP50 / 1000).toFixed(1)} s` },
  ];
  const benchmarkText = (m: keyof typeof BENCHMARKS) =>
    m === 'avgSessionSec' ? t('minutes', { count: BENCHMARKS[m].great / 60 }) : `${Math.round(BENCHMARKS[m].great * 100)}%+`;

  const exportCsv = () => {
    const blob = new Blob([kpisToCsv(days)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${game.data?.game.slug ?? 'game'}-kpis-${from}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const chart = days.map((d) => ({
    label: d.day.slice(5),
    plays: d.plays,
    conversion: d.conversion1min == null ? null : Math.round(d.conversion1min * 100),
    session: d.avgSessionSec == null ? null : Math.round(d.avgSessionSec / 6) / 10,
    likes: d.likes,
    dislikes: d.dislikes,
    p50: d.loadMsP50 == null ? null : d.loadMsP50 / 1000,
    p90: d.loadMsP90 == null ? null : d.loadMsP90 / 1000,
  }));

  return (
    <div className="flex flex-col gap-5" data-testid="kpi-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('title', { title: game.data?.game.title ?? '' })}</h1>
        <div role="group" aria-label={t('range')} className="flex flex-wrap gap-2">
          {[7, 30, 90].map((r) => (
            <button key={r} type="button" aria-pressed={range === r} className={chipClass(range === r)} onClick={() => setRange(r)}>
              {t(r === 7 ? 'last7' : r === 30 ? 'last30' : 'last90')}
            </button>
          ))}
          <Button variant="outline" size="sm" icon={<Download aria-hidden="true" className="size-4" />} onClick={exportCsv}>
            {t('export')}
          </Button>
        </div>
      </div>
      {id ? <DiscoveryPanel gameId={id} /> : null}
      {kpis.loading && !kpis.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {cards.map((c) => {
              const g = c.metric ? grade(c.metric, c.raw ?? null) : null;
              return (
                <Card key={c.key} className="flex flex-col gap-1 p-4" data-kpi={c.key}>
                  <dt className="text-xs font-bold tracking-wide text-fg-muted uppercase">{c.label}</dt>
                  <dd className="font-display text-2xl font-bold">{c.value}</dd>
                  {g ? (
                    <dd>
                      <Badge tone={GRADE_TONE[g]}>{t(`grade.${g}`)}</Badge>
                    </dd>
                  ) : null}
                  {c.metric ? <dd className="text-xs text-fg-muted">{t('benchmark', { value: benchmarkText(c.metric) })}</dd> : null}
                  {c.pctl != null && kpis.data && kpis.data.peers > 1 ? (
                    <dd className="text-xs text-fg-muted">{t('percentile', { pct: Math.round(c.pctl * 100), category: category ? tc(`${category}.name`) : '' })}</dd>
                  ) : null}
                </Card>
              );
            })}
          </dl>
          {s.plays === 0 ? <p className="text-sm text-fg-muted">{t('noData')}</p> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('plays')}</h2>
              <TrendChart data={chart} series={[{ key: 'plays', name: t('plays') }]} kind="bar" label={t('plays')} />
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('conversion')}</h2>
              <TrendChart data={chart} series={[{ key: 'conversion', name: t('conversion') }]} kind="line" format={(v) => `${v}%`} label={t('conversion')} />
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('ratings')}</h2>
              <TrendChart
                data={chart}
                series={[
                  { key: 'likes', name: '👍', colour: '#22c55e' },
                  { key: 'dislikes', name: '👎', colour: '#ef4444' },
                ]}
                kind="bar"
                label={t('ratings')}
              />
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('loadDistribution')}</h2>
              <TrendChart
                data={chart}
                series={[
                  { key: 'p50', name: 'p50' },
                  { key: 'p90', name: 'p90', colour: '#f59e0b' },
                ]}
                kind="line"
                format={(v) => `${v.toFixed(1)} s`}
                label={t('loadDistribution')}
              />
            </Card>
          </div>
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t('dislikeReasons')}</h2>
            {Object.keys(s.dislikeReasons).length === 0 ? (
              <p className="text-sm text-fg-muted">{t('noData')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {Object.entries(s.dislikeReasons)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, n]) => (
                    <li key={reason} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 font-bold">{tr(reason as 'bugs')}</span>
                      <span className="h-2.5 rounded-full bg-danger" style={{ width: `${Math.max(4, (n / Math.max(...Object.values(s.dislikeReasons))) * 60)}%` }} />
                      <span className="text-fg-muted">{n}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
