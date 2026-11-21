'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chipClass, cn } from '@brainstorming/ui';
import { AdSlot } from '@/components/ads/AdSlot';
import { GameCover } from '@/components/catalogue/GameCover';
import { isPrebuilt } from '@/components/catalogue/GameTile';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { NotFoundView } from '@/components/shell/NotFoundView';
import { Link, useLocale } from '@/i18n/navigation';
import { getCategory, tagLabel } from '@/lib/catalogue/categories';
import { relatedGames, type RelatedGames } from '@/lib/catalogue/listings';
import type { GameDetail, GameStats, GameSummary } from '@/lib/data/types';
import { Markdown } from '@/lib/domain/markdown';
import { track } from '@/lib/events/client';
import { formatBytes, formatCount, formatDate, gameHref } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { usePrefs } from '@/lib/prefs';
import { GameFrame, type GameFrameHandle } from './GameFrame';
import { GameToolbar } from './GameToolbar';

// Everything below the game frame that only shows live, per-player data is fetched after the
// page itself, so the frame and the Play button are not held up by it.
const GameLeaderboard = dynamic(() => import('@/components/player/Account').then((m) => m.GameLeaderboard), { ssr: false });
const PartyBar = dynamic(() => import('@/components/player/Social').then((m) => m.PartyBar), { ssr: false });
const DevlogFeed = dynamic(() => import('@/components/growth/Public').then((m) => m.DevlogFeed), { ssr: false });
const PlaytestCard = dynamic(() => import('@/components/growth/Public').then((m) => m.PlaytestCard), { ssr: false });

function MiniList({ title, games }: { title: string; games: GameSummary[] }) {
  if (games.length === 0) return null;
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-2.5 text-lg font-semibold">{title}</h2>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-2">
        {games.map((g) => (
          <li key={g.id}>
            <Link href={gameHref(g.slug)} hard={!isPrebuilt(g)} className="group block rounded-card">
              <span className="block aspect-video overflow-hidden rounded-control border border-border transition-shadow group-hover:shadow-glow">
                <GameCover game={g} sizes="160px" />
              </span>
              <span className="mt-1 block truncate text-sm font-bold">{g.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContentSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-7">
      <h2 id={id} className="mb-2 text-xl font-semibold sm:text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export interface GameViewProps {
  game: GameDetail;
  related: RelatedGames;
}

export function GameView({ game, related }: GameViewProps) {
  const t = useTranslations('game');
  const tn = useTranslations('nav');
  const tc = useTranslations('categories');
  const locale = useLocale();
  const { theatre, lowData } = usePrefs();
  const frame = useRef<GameFrameHandle>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [stats, setStats] = useState<GameStats>(game.stats);
  useEffect(() => setStats(game.stats), [game.stats]);

  useEffect(() => {
    track('page_view', { gameId: game.id, versionId: game.versionId, payload: { path: `/game/${game.slug}` } });
  }, [game.id, game.slug, game.versionId]);

  const category = getCategory(game.category);
  const info: { label: string; value: ReactNode }[] = [
    {
      label: t('info.developer'),
      value: (
        <Link href={`/studio/${game.studio.slug}`} hard className="inline-flex items-center gap-1 font-bold text-link underline underline-offset-4">
          {game.studio.name}
          {game.studio.verified ? (
            <BadgeCheck aria-label={t('verifiedStudio')} className="size-4 text-glow" />
          ) : null}
        </Link>
      ),
    },
    {
      label: t('info.rating'),
      value: stats.rating10 == null ? t('info.notRated') : t('info.ratingValue', { rating: stats.rating10.toFixed(1) }),
    },
    { label: t('info.votes'), value: formatCount(stats.votes, locale) },
    { label: t('info.plays'), value: formatCount(stats.plays, locale) },
    { label: t('info.released'), value: formatDate(game.releasedAt, locale) || '–' },
    { label: t('info.updated'), value: formatDate(game.updatedAt, locale) },
    { label: t('info.platforms'), value: game.platforms.map((p) => t(`platforms.${p}`)).join(', ') },
    { label: t('info.orientation'), value: t(`orientations.${game.orientation}`) },
    { label: t('info.size'), value: formatBytes(game.sizeBytes) },
    ...(game.engine ? [{ label: t('info.engine'), value: game.engine }] : []),
  ];

  return (
    <div className="relative" data-testid="game-page" data-game-id={game.id}>
      {/* Full-bleed blurred backdrop from the cover. Skipped in low-data mode. */}
      {game.cover && !lowData ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden">
          <div
            className="absolute -inset-10 scale-110 bg-cover bg-center opacity-35 blur-3xl"
            style={{ backgroundImage: `url(${game.cover.placeholder ?? game.cover.url})` }}
          />
          <div className="absolute inset-0 bg-linear-to-b from-transparent to-bg" />
        </div>
      ) : null}

      <div className="page">
        <Suspense fallback={null}>
          <PartyBar />
        </Suspense>
        <nav aria-label={t('breadcrumbs')} className="mb-3 text-sm font-semibold text-fg-muted">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-fg hover:underline">
                {tn('home')}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-4" />
            </li>
            {category ? (
              <>
                <li>
                  <Link href={`/c/${category.slug}`} className="hover:text-fg hover:underline">
                    {tc(`${category.slug}.name`)}
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="size-4" />
                </li>
              </>
            ) : null}
            <li aria-current="page" className="text-fg">
              {game.title}
            </li>
          </ol>
        </nav>

        <div className={cn('grid gap-6', theatre ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_300px]')}>
          <div className="min-w-0">
            <GameFrame ref={frame} game={game} onFullscreenChange={setFullscreen} />
            <GameToolbar
              game={{ ...game, stats }}
              fullscreen={fullscreen}
              onToggleFullscreen={() => frame.current?.toggleFullscreen()}
              getContext={() => frame.current?.context() ?? null}
              onStats={setStats}
              requestClip={(seconds) => frame.current?.clip(seconds) ?? Promise.reject(new Error('no-sdk'))}
              canClip={() => frame.current?.canClip() ?? false}
            />
            <PlaytestCard game={game} />

            <h1 className="mt-5 text-3xl font-bold sm:text-4xl">{game.title}</h1>
            {game.shortDescription ? <p className="mt-1.5 text-fg-muted">{game.shortDescription}</p> : null}

            <dl
              aria-label={t('info.label')}
              data-testid="info-strip"
              className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-border bg-surface p-4 text-sm sm:grid-cols-3 lg:grid-cols-5"
            >
              {info.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-xs font-bold tracking-wide text-fg-muted uppercase">{row.label}</dt>
                  <dd className="mt-0.5 truncate font-bold">{row.value}</dd>
                </div>
              ))}
            </dl>

            {game.tags.length > 0 ? (
              <ul aria-label={t('tags')} className="mt-4 flex flex-wrap gap-2">
                {game.tags.map((tag) => (
                  <li key={tag}>
                    <Link href={`/t/${tag}`} hard className={chipClass(false)}>
                      {tagLabel(tag)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="prose-bg max-w-3xl">
              {game.descriptionMd ? (
                <ContentSection id="about" title={t('sections.description', { title: game.title })}>
                  <Markdown source={game.descriptionMd} />
                </ContentSection>
              ) : null}
              {game.howToPlayMd ? (
                <ContentSection id="how-to-play" title={t('sections.howToPlay')}>
                  <Markdown source={game.howToPlayMd} />
                </ContentSection>
              ) : null}
              {game.controls.length > 0 ? (
                <ContentSection id="controls" title={t('sections.controls')}>
                  <div className="overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{t('controlsTable.action')}</th>
                          <th scope="col">{t('controlsTable.keyboard')}</th>
                          <th scope="col">{t('controlsTable.touch')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {game.controls.map((row, i) => (
                          <tr key={i}>
                            <th scope="row">{row.action}</th>
                            <td>{row.keyboard || '–'}</td>
                            <td>{row.touch || '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ContentSection>
              ) : null}
              <AdSlot placement="game-content" className="mt-7" />
              {game.featuresMd ? (
                <ContentSection id="features" title={t('sections.features')}>
                  <Markdown source={game.featuresMd} />
                </ContentSection>
              ) : null}
              {game.tipsMd ? (
                <ContentSection id="tips" title={t('sections.tips')}>
                  <Markdown source={game.tipsMd} />
                </ContentSection>
              ) : null}
              {game.faq.length > 0 ? (
                <ContentSection id="faq" title={t('sections.faq')}>
                  <div className="flex flex-col gap-2">
                    {game.faq.map((item, i) => (
                      <details key={i} className="rounded-control border border-border bg-surface px-4 py-2.5">
                        <summary className="font-bold">{item.q}</summary>
                        <p className="mt-1.5 text-fg-muted">{item.a}</p>
                      </details>
                    ))}
                  </div>
                </ContentSection>
              ) : null}
              <GameLeaderboard gameId={game.id} category={game.category} />
            </div>
            <div className="max-w-3xl">
              <DevlogFeed gameId={game.id} heading={t('sections.devlog')} limit={5} />
            </div>
          </div>

          <aside className={cn('min-w-0', theatre && 'xl:grid xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-6')}>
            <AdSlot placement="game-side" className="mb-6" />
            <div>
              <MiniList title={t('playNext')} games={related.playNext} />
              <MiniList title={t('similar')} games={related.similar} />
              <MiniList title={t('fromStudio', { studio: game.studio.name })} games={related.fromStudio} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const EMPTY_RELATED: RelatedGames = { playNext: [], similar: [], fromStudio: [] };

export interface GameLiveProps {
  slug: string;
  /** The game as pre-rendered, or null when this page is resolved in the browser. */
  initial: GameDetail | null;
  related: RelatedGames | null;
}

/** The game page with live data: fresh counters for pre-rendered games, a full fetch otherwise. */
export function GameLive({ slug, initial, related }: GameLiveProps) {
  const t = useTranslations('game');
  const game = useRepoQuery((repo) => repo.catalogue.get(slug), [slug], {
    initial: initial ?? undefined,
    topics: ['catalogue'],
  });
  const others = useRepoQuery((repo) => repo.catalogue.list({ sort: 'popular', limit: 200 }), [slug], {
    enabled: related == null,
    topics: ['catalogue'],
  });
  const current = game.data ?? initial;
  const liveRelated = useMemo(
    () => (current && others.data ? relatedGames(current, others.data.items) : null),
    [current, others.data],
  );

  if (!current) {
    if (game.loading) return <PageSkeleton />;
    return <NotFoundView title={t('notFoundTitle')} body={t('notFoundBody')} />;
  }
  return <GameView game={current} related={related ?? liveRelated ?? EMPTY_RELATED} />;
}
