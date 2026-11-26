'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton, TextField, buttonClass } from '@brainstorming/ui';
import { RankRing } from '@/components/analytics/Discovery';
import { KpiPage } from '@/components/dev/KpiPage';
import { GameStatusBadge } from '@/components/dev/StatusBadge';
import { Link } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import { formatBytes } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

const TrendChart = dynamic(() => import('@/components/dev/Charts'), { ssr: false, loading: () => <Skeleton className="h-[240px] w-full" /> });
const count = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct = (v: number | null, digits = 0) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`);

/** The state of the whole site at a glance, with the queues that need a decision. */
export function SiteOverview() {
  const t = useTranslations('admin.site');
  const act = useAct();
  const stats = useRepoQuery((repo) => repo.growth.siteStats(), [], { topics: ['catalogue', 'qa', 'admin'] });
  const spark = useRepoQuery((repo) => repo.admin.sparkGames(), [], { topics: ['qa', 'catalogue'] });
  const s = stats.data;
  if (!s) return <Skeleton className="h-96 w-full" />;
  const live = (s.gamesByStatus.spark ?? 0) + (s.gamesByStatus.rise ?? 0) + (s.gamesByStatus.featured ?? 0);
  const sparkDue = (spark.data ?? []).filter((x) => x.windowOver).length;
  const queues = [
    { key: 'inReview', value: s.inReview, href: '/admin/qa' },
    { key: 'sparkDue', value: sparkDue, href: '/admin/spark' },
    { key: 'openReports', value: s.openReports, href: '/admin/moderation' },
  ];
  const chart = s.byDay.map((d) => ({ label: d.day.slice(5), plays: d.plays, players: d.players, impressions: d.impressions }));
  return (
    <div className="flex flex-col gap-5" data-testid="site-overview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button variant="outline" onClick={() => void act(async () => (await getRepo()).admin.runDailyJobs(), t('jobsDone'))}>
          {t('runJobs')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {queues.map((q) => (
          <Link key={q.key} href={q.href} className="block" data-testid={`queue-${q.key}`}>
            <Card interactive className={q.value > 0 ? 'border-primary/70 p-4' : 'p-4'}>
              <p className="text-xs font-extrabold tracking-wide text-fg-muted uppercase">{t(`queues.${q.key}`)}</p>
              <p className="font-display text-4xl font-extrabold">{q.value}</p>
              <p className="text-sm text-fg-muted">{q.value > 0 ? t('needsYou') : t('allClear')}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Every number opens the page where it can be acted on. */}
      <div className="stat-grid">
        {(
          [
            ['players7d', count(s.players7d), '/admin/games'],
            ['plays7d', count(s.plays7d), '/admin/games'],
            ['playsToday', count(s.playsToday), '/admin/games'],
            ['impressions7d', count(s.impressions7d), '/admin/games'],
            ['gamesLive', count(live), '/admin/games'],
            ['studios', count(s.studios), '/admin/moderation?tab=studios'],
            ['accounts', count(s.accounts), '/admin/moderation?tab=users'],
          ] as const
        ).map(([key, value, href]) => (
          <Link key={key} href={href} className="stat block transition-colors hover:border-primary/70" data-stat={key}>
            <span className="block text-xs font-extrabold tracking-wide text-fg-muted uppercase">{t(`stats.${key}`)}</span>
            <span className="block font-display text-2xl font-extrabold tabular-nums">{value}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t('playsChart')}</h2>
          <TrendChart
            data={chart}
            series={[
              { key: 'plays', name: t('stats.plays') },
              { key: 'players', name: t('stats.players') },
            ]}
            kind="area"
            height={240}
            label={t('playsChart')}
          />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t('impressionsChart')}</h2>
          <TrendChart data={chart} series={[{ key: 'impressions', name: t('stats.impressions') }]} kind="bar" height={240} label={t('impressionsChart')} />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('statusTitle')}</h2>
        <ul className="flex flex-wrap gap-2">
          {(['draft', 'in_review', 'changes_requested', 'spark', 'rise', 'featured', 'paused', 'removed'] as const).map((status) => (
            <li key={status} className="flex items-center gap-1.5 text-sm">
              <GameStatusBadge status={status} />
              <span className="font-bold tabular-nums">{s.gamesByStatus[status] ?? 0}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Every released game, ranked by the discovery algorithm, with the numbers behind the score. */
export function GamesTable() {
  const t = useTranslations('admin.games');
  const rows = useRepoQuery((repo) => repo.growth.discoveryAll(), [], { topics: ['catalogue'] });
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows.data ?? []).filter((r) => !q || r.title.toLowerCase().includes(q) || r.studioName.toLowerCase().includes(q));
  }, [rows.data, query]);
  return (
    <div className="flex flex-col gap-4" data-testid="games-table">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <TextField label={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
      {rows.loading && !rows.data ? (
        <Skeleton className="h-64 w-full" />
      ) : list.length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-left">
              <tr>
                {(['rank', 'game', 'status', 'impressions', 'ctr', 'plays', 'conversion', 'session', 'd1', 'likes'] as const).map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-display whitespace-nowrap">
                    {t(`cols.${h}`)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const i = r.inputs;
                const votes = i.likes + i.dislikes;
                return (
                  <tr key={r.gameId} className="border-t border-border" data-testid="game-analysis-row">
                    <td className="px-3 py-2">
                      <RankRing score={r.score} size={44} />
                    </td>
                    <th scope="row" className="px-3 py-2 text-left">
                      <span className="block font-bold">{r.title}</span>
                      <span className="text-xs font-normal text-fg-muted">{r.studioName}</span>
                    </th>
                    <td className="px-3 py-2">
                      <GameStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{count(i.impressions)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(i.impressions > 0 ? i.clicks / i.impressions : null, 1)}</td>
                    <td className="px-3 py-2 tabular-nums">{count(i.plays)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(i.conversion)}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{i.avgSessionSec == null ? '–' : `${(i.avgSessionSec / 60).toFixed(1)} min`}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(i.d1)}</td>
                    <td className="px-3 py-2 tabular-nums">{votes > 0 ? pct(i.likes / votes) : '–'}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/admin/games/view?id=${r.gameId}`} className={buttonClass({ size: 'sm', variant: 'secondary' })} data-testid="open-analysis">
                        {t('open')}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One game's full analysis, the same view its developer has. */
export function GameAnalysis() {
  const t = useTranslations('admin.games');
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/games" className="inline-flex items-center gap-1 text-sm font-bold text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('back')}
      </Link>
      <KpiPage />
    </div>
  );
}

/** How big the database is and where the space goes. */
export function DatabasePage() {
  const t = useTranslations('admin.database');
  const stats = useRepoQuery((repo) => repo.growth.databaseStats(), [], { topics: ['admin'] });
  const d = stats.data;
  if (!d) return <Skeleton className="h-96 w-full" />;
  const used = d.limitBytes ? d.totalBytes / d.limitBytes : null;
  const largest = Math.max(1, ...d.tables.map((x) => x.bytes));
  return (
    <div className="flex flex-col gap-5" data-testid="database-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="max-w-3xl text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button variant="outline" onClick={() => stats.refresh()}>
          {t('refresh')}
        </Button>
      </div>
      <dl className="stat-grid">
        <div className="stat">
          <dt>{t('engine')}</dt>
          <dd className="text-base!">{d.engine}</dd>
        </div>
        <div className="stat">
          <dt>{t('size')}</dt>
          <dd>
            {formatBytes(d.totalBytes)}
            {d.limitBytes ? <small>{t('ofLimit', { limit: formatBytes(d.limitBytes), pct: Math.round((used ?? 0) * 100) })}</small> : null}
          </dd>
        </div>
        <div className="stat">
          <dt>{t('tables')}</dt>
          <dd>{d.tables.length}</dd>
        </div>
        <div className="stat">
          <dt>{t('rows')}</dt>
          <dd>{count(d.tables.reduce((n, x) => n + x.rows, 0))}</dd>
        </div>
        {d.connections != null ? (
          <div className="stat">
            <dt>{t('connections')}</dt>
            <dd>{d.connections}</dd>
          </div>
        ) : null}
      </dl>
      {used != null && used > 0.8 ? (
        <p role="alert" className="rounded-control border border-warning/70 bg-surface-3 px-3.5 py-2.5 text-sm font-bold">
          {t('nearLimit')}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-3 text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-display">
                {t('table')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-display">
                {t('rows')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-display">
                {t('size')}
              </th>
              <th scope="col" className="w-1/3 px-3 py-2">
                <span className="sr-only">{t('share')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.tables.map((x) => (
              <tr key={x.name} className="border-t border-border" data-testid="db-table-row">
                <th scope="row" className="px-3 py-1.5 text-left font-mono text-[0.85rem] font-semibold">
                  {x.name}
                </th>
                <td className="px-3 py-1.5 text-right tabular-nums">{count(x.rows)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{formatBytes(x.bytes)}</td>
                <td className="px-3 py-1.5">
                  <span className="block h-2 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-glow" style={{ width: `${(x.bytes / largest) * 100}%` }} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card className="p-4 text-sm">
        <h2 className="mb-1 font-semibold">{t('pgadminTitle')}</h2>
        <p className="text-fg-muted">{t('pgadminBody')}</p>
        <Badge className="mt-2">docs/DATABASE.md</Badge>
      </Card>
    </div>
  );
}
