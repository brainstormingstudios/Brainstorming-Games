'use client';

import { useTranslations } from 'next-intl';
import { Award, TrendingUp } from 'lucide-react';
import { Badge, Card, EmptyState, Skeleton, Switch, buttonClass, cn } from '@brainstorming/ui';
import { GameTile } from '@/components/catalogue/GameTile';
import { Link } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import { DISCOVERY_POINTS, RISING_MIN_ANSWERS } from '@/lib/domain/discover';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';

/** The weekly Rising chart: what Early Access testers loved most lately. */
export function RisingChart({ limit = 10 }: { limit?: number }) {
  const t = useTranslations('discover');
  const rows = useRepoQuery(async (repo) => {
    const rising = await repo.discover.rising(limit);
    const games = await repo.catalogue.byIds(rising.map((r) => r.gameId));
    const byId = new Map(games.map((g) => [g.id, g]));
    return rising.filter((r) => byId.has(r.gameId)).map((r) => ({ ...r, game: byId.get(r.gameId)! }));
  }, [limit], { topics: ['catalogue', 'dev-games'] });
  if (rows.loading && !rows.data) return <Skeleton className="h-40 w-full" />;
  if (!rows.data || rows.data.length === 0) return <p className="text-sm text-fg-muted">{t('risingEmpty', { min: RISING_MIN_ANSWERS })}</p>;
  return (
    <ol className="flex flex-col gap-2" data-testid="rising-chart">
      {rows.data.map((r, i) => (
        <li key={r.gameId}>
          <Link href={`/game/${r.game.slug}`} className="flex items-center gap-3 rounded-control border border-border bg-surface p-2 hover:bg-surface-2" data-testid="rising-row">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full font-display font-bold', i < 3 ? 'bg-primary text-primary-fg' : 'bg-surface-3')}>{i + 1}</span>
            {r.game.cover ? <img src={r.game.cover.url} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" loading="lazy" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{r.game.title}</span>
              <span className="text-xs text-fg-muted">{t('risingAnswers', { count: r.answers })}</span>
            </span>
            <span className="hidden w-32 shrink-0 sm:block">
              <span className="block h-2 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(r.score * 100)}%` }} />
              </span>
            </span>
            <span className="w-12 shrink-0 text-right font-display font-bold tabular-nums">{Math.round(r.score * 100)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** Early Access: Basic Launch games to test, the Rising chart, and your "Discovered it" badges. */
export function DiscoverPage() {
  const t = useTranslations('discover');
  const { user } = useSession();
  const early = useRepoQuery((repo) => repo.catalogue.list({ sort: 'new', limit: 200 }).then((p) => p.items.filter((g) => g.status === 'spark')), [], { topics: ['catalogue'] });
  const mine = useRepoQuery((repo) => repo.discover.myDiscoveries(), [user?.id], { topics: ['dev-games', 'session'] });
  const inPanel = Boolean(user?.playtestOptIn);

  return (
    <div className="page flex flex-col gap-8" data-testid="discover-page">
      <section className="flex flex-col gap-2">
        <Badge tone="glow" className="self-start">
          {t('kicker')}
        </Badge>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="max-w-2xl text-lg text-fg-muted">{t('intro', { points: DISCOVERY_POINTS })}</p>
      </section>

      <Card className="flex flex-col gap-3 p-4" data-testid="early-access-panel">
        {user?.username ? (
          <Switch
            label={t('panelLabel')}
            description={t('panelHint')}
            checked={inPanel}
            onChange={(e) => {
              const on = e.target.checked;
              void getRepo().then((repo) => repo.auth.updateProfile({ playtestOptIn: on }));
            }}
            data-testid="early-access-toggle"
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{t('panelSignIn')}</p>
            <button type="button" className={buttonClass({})} onClick={() => void requestLogin()}>
              {t('signIn')}
            </button>
          </div>
        )}
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="early-games">
        <h2 id="early-games" className="text-2xl font-bold">
          {t('nowTitle')}
        </h2>
        <p className="text-sm text-fg-muted">{t('nowIntro')}</p>
        {early.loading && !early.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (early.data ?? []).length === 0 ? (
          <EmptyState title={t('nowEmpty')} size="sm" />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="early-access-games">
            {(early.data ?? []).map((g) => (
              <li key={g.id}>
                <GameTile game={g} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="rising">
        <h2 id="rising" className="flex items-center gap-2 text-2xl font-bold">
          <TrendingUp aria-hidden="true" className="size-6 text-primary" />
          {t('risingTitle')}
        </h2>
        <p className="text-sm text-fg-muted">{t('risingIntro')}</p>
        <RisingChart />
      </section>

      {user?.username ? (
        <section className="flex flex-col gap-3" aria-labelledby="discoveries">
          <h2 id="discoveries" className="flex items-center gap-2 text-2xl font-bold">
            <Award aria-hidden="true" className="size-6 text-primary" />
            {t('mineTitle')}
          </h2>
          {(mine.data ?? []).length === 0 ? (
            <p className="text-sm text-fg-muted">{t('mineEmpty')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2" data-testid="my-discoveries">
              {(mine.data ?? []).map((d) => (
                <li key={d.gameId}>
                  <Link href={`/game/${d.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-primary px-3 py-1 text-sm font-bold hover:bg-surface-2">
                    <Award aria-hidden="true" className="size-4 text-primary" />
                    {t('badge', { title: d.title })}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
