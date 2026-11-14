'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Badge, Card, EmptyState, Skeleton, buttonClass } from '@brainstorming/ui';
import { GameCover } from '@/components/catalogue/GameCover';
import { Link, useLocale } from '@/i18n/navigation';
import { addDays } from '@/lib/domain/kpis';
import { formatMoney } from '@/lib/domain/revenue';
import { formatCount, formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useDev } from './DevShell';
import { GameStatusBadge } from './StatusBadge';

const TrendChart = dynamic(() => import('./Charts'), { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> });

export function Dashboard() {
  const t = useTranslations('dev.dashboard');
  const locale = useLocale();
  const { studio } = useDev();
  const games = useRepoQuery((repo) => repo.dev.myGames(), [], { topics: ['dev-games', 'catalogue'] });
  const feedback = useRepoQuery((repo) => repo.dev.feedback(), [], { topics: ['dev-games'] });
  const statements = useRepoQuery((repo) => repo.revenue.myStatements(), [], { topics: ['revenue'] });
  const today = new Date().toISOString().slice(0, 10);
  const from = addDays(today, -29);
  const live = (games.data ?? []).filter((g) => ['spark', 'rise', 'featured'].includes(g.status));
  const kpis = useRepoQuery(
    (repo) => Promise.all(live.map((g) => repo.dev.kpis(g.id, from, today))),
    [live.map((g) => g.id).join(',')],
    { topics: ['catalogue'] },
  );
  const media = useRepoQuery(
    (repo) => Promise.all((games.data ?? []).map((g) => repo.dev.game(g.id))),
    [(games.data ?? []).map((g) => `${g.id}:${g.updatedAt}`).join(',')],
  );
  const covers = new Map((media.data ?? []).filter(Boolean).map((d) => [d!.game.id, d!.media.find((m) => m.kind === 'cover_landscape' && m.isActive) ?? null]));

  const series = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of kpis.data ?? []) for (const d of r.days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.plays);
    return Array.from({ length: 30 }, (_, i) => {
      const day = addDays(from, i);
      return { label: day.slice(5), plays: byDay.get(day) ?? 0 };
    });
  }, [kpis.data, from]);
  const plays7d = series.slice(-7).reduce((n, p) => n + p.plays, 0);

  return (
    <div data-testid="dev-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('welcome', { studio: studio.name })}</h1>
          <Badge tone="glow" className="mt-2">
            {t('level', { level: t(`levels.${studio.level}`) })}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dev/docs/quick-start" className={buttonClass({ variant: 'outline', size: 'lg' })}>
            {t('sdkDocs')}
          </Link>
          <Link href="/dev/docs/sdk-rules" className={buttonClass({ variant: 'outline', size: 'lg' })} data-testid="dash-sdk-rules">
            {t('sdkRules')}
          </Link>
          <Link href="/dev/games/new" className={buttonClass({ size: 'lg' })} data-testid="new-game">
            <Plus aria-hidden="true" className="size-5" />
            {t('newGame')}
          </Link>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t('plays7d'), value: formatCount(plays7d, locale) },
          { label: t('gamesLive'), value: String(live.length) },
          { label: t('inReview'), value: String((games.data ?? []).filter((g) => g.status === 'in_review').length) },
          { label: t('openFeedback'), value: String((feedback.data ?? []).filter((f) => f.status === 'open').length) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <dt className="text-xs font-bold tracking-wide text-fg-muted uppercase">{s.label}</dt>
            <dd className="mt-1 font-display text-3xl font-bold">{s.value}</dd>
          </Card>
        ))}
      </dl>

      {live.length > 0 || (statements.data ?? []).length > 0 ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-3 text-lg font-semibold">{t('playsChart')}</h2>
            <TrendChart data={series} series={[{ key: 'plays', name: t('plays7d') }]} label={t('playsChart')} />
          </Card>
          {(statements.data ?? []).length > 0 ? (
            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">{t('revenueChart')}</h2>
              <TrendChart
                data={(statements.data ?? []).slice(0, 12).reverse().map((s) => ({ label: s.month, earned: s.earned / 100 }))}
                series={[{ key: 'earned', name: t('revenueChart') }]}
                kind="bar"
                format={(v) => formatMoney(Math.round(v * 100), statements.data![0]!.currency)}
                label={t('revenueChart')}
              />
            </Card>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="dev-games" className="mt-8">
        <h2 id="dev-games" className="mb-3 text-xl font-semibold">
          {t('games')}
        </h2>
        {games.loading && !games.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (games.data ?? []).length === 0 ? (
          <EmptyState
            title={t('noGamesTitle')}
            description={t('noGamesBody')}
            action={
              <Link href="/dev/games/new" className={buttonClass({})}>
                {t('newGame')}
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {(games.data ?? []).map((g) => (
              <li key={g.id} data-testid="dev-game-row">
                <Card className="flex flex-wrap items-center gap-4 p-3">
                  <span className="block aspect-video w-28 shrink-0 overflow-hidden rounded-control">
                    <GameCover game={{ slug: g.slug, title: g.title, cover: covers.get(g.id) ?? null }} sizes="112px" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-lg font-semibold">{g.title}</span>
                      <GameStatusBadge status={g.status} />
                    </span>
                    <span className="block text-sm text-fg-muted">
                      {formatCount(g.plays, locale)} plays · {formatDate(g.updatedAt, locale)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Link href={`/dev/games/view?id=${g.id}`} className={buttonClass({ variant: 'secondary', size: 'sm' })} data-testid="manage-game">
                      {t('view')}
                    </Link>
                    <Link href={`/dev/games/edit?id=${g.id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>
                      {t('edit')}
                    </Link>
                    {g.releasedAt ? (
                      <Link href={`/dev/games/kpi?id=${g.id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>
                        {t('kpis')}
                      </Link>
                    ) : null}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
