'use client';

import { isHeroActive } from '@/lib/domain/premium';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Play, Rocket } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { IconButton, Mascot, buttonClass, cn } from '@brainstorming/ui';
import { AdSlot } from '@/components/ads/AdSlot';
import { CATEGORY_ICONS } from '@/components/shell/nav';
import { Link } from '@/i18n/navigation';
import { CATEGORIES } from '@/lib/catalogue/categories';
import { buildRails, isPublic, sortGames } from '@/lib/catalogue/listings';
import { HERO_MIN_GAMES } from '@/lib/config';
import type { GameSummary, SiteConfig } from '@/lib/data/types';
import { gameHref } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { usePrefs } from '@/lib/prefs';
import { GameCover } from './GameCover';
import { isPrebuilt } from './GameTile';
import { Rail } from './Rail';
import { useLiveGames } from './useLiveGames';

/** Shown until at least three games are live. */
function PublishBanner() {
  const t = useTranslations('home');
  return (
    <section
      data-testid="hero-publish"
      className="relative overflow-hidden rounded-card border border-border bg-linear-to-br from-navy-800 to-navy-600 px-5 py-7 text-white sm:px-9 sm:py-10"
    >
      <div className="relative z-10 max-w-2xl">
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-navy-950/60 px-3 py-1 text-xs font-extrabold tracking-wide text-cyan-300 uppercase">
          <Rocket aria-hidden="true" className="size-3.5" />
          {t('heroPublishKicker')}
        </p>
        <h2 className="text-2xl leading-tight font-bold sm:text-4xl">{t('heroPublishTitle')}</h2>
        <p className="mt-3 max-w-xl text-[0.95rem] text-white/90 sm:text-base">{t('heroPublishBody')}</p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link href="/developers" className={buttonClass({ size: 'lg' })} data-testid="hero-publish-cta">
            {t('heroPublishCta')}
          </Link>
          <Link
            href="/developers#launch-tiers"
            className={buttonClass({ size: 'lg', variant: 'outline', className: 'border-white/50 text-white hover:bg-white/10' })}
          >
            {t('heroPublishSecondary')}
          </Link>
        </div>
      </div>
      <Mascot
        size={220}
        priority
        className="absolute -right-6 -bottom-8 hidden opacity-95 sm:block lg:right-10 lg:bottom-2"
      />
    </section>
  );
}

/** Three featured games. The active slide's silent preview plays unless low-data mode is on. */
function HeroCarousel({ games }: { games: GameSummary[] }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const tg = useTranslations('game');
  const { lowData } = usePrefs();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = games.length;
  useEffect(() => {
    if (paused || count < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), 7000);
    return () => window.clearInterval(id);
  }, [paused, count]);
  const game = games[index % count]!;
  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('heroLabel')}
      data-testid="hero-carousel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative overflow-hidden rounded-card border border-border bg-surface"
    >
      <div
        role="group"
        aria-roledescription="slide"
        aria-label={t('heroSlide', { index: index + 1, total: count })}
        className="relative aspect-[16/10] max-h-[26rem] w-full sm:aspect-[21/9]"
      >
        <GameCover game={game} priority sizes="(min-width: 64rem) 70vw, 100vw" />
        {game.preview && !lowData ? (
          <video
            key={game.id}
            src={game.preview.url}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
            aria-hidden="true"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        <div className="absolute inset-0 bg-linear-to-t from-navy-950/95 via-navy-950/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-6">
          <div className="min-w-0 text-white">
            <h2 className="truncate text-2xl font-bold sm:text-4xl">{game.title}</h2>
            <p className="mt-1 line-clamp-2 max-w-xl text-sm text-white/90 sm:text-base">{game.shortDescription}</p>
          </div>
          <Link
            href={gameHref(game.slug)}
            hard={!isPrebuilt(game)}
            className={buttonClass({ size: 'lg' })}
            aria-label={tg('playLabel', { title: game.title })}
          >
            <Play aria-hidden="true" className="size-5 fill-current" />
            {tc('play')}
          </Link>
        </div>
      </div>
      {count > 1 ? (
        <div className="absolute top-3 right-3 flex gap-1">
          <IconButton size="sm" variant="secondary" label={tc('previous')} onClick={() => setIndex((i) => (i - 1 + count) % count)}>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton size="sm" variant="secondary" label={tc('next')} onClick={() => setIndex((i) => (i + 1) % count)}>
            <ChevronRight aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      ) : null}
    </section>
  );
}

function ContinuePlaying() {
  const t = useTranslations('home');
  const { data } = useRepoQuery(
    async (repo) => {
      const history = await repo.player.history();
      if (history.length === 0) return [];
      return repo.catalogue.byIds(history.slice(0, 12).map((h) => h.gameId));
    },
    [],
    { topics: ['history', 'catalogue'] },
  );
  if (!data || data.length === 0) return null;
  return <Rail title={t('continuePlaying')} games={data} href="/recent" testId="rail-continue" />;
}

export function CategoryGrid() {
  const t = useTranslations('home');
  const tc = useTranslations('categories');
  return (
    <section aria-labelledby="home-categories" className="mt-9">
      <h2 id="home-categories" className="mb-3 text-xl font-semibold sm:text-2xl">
        {t('categoriesTitle')}
      </h2>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICONS[c.slug]!;
          return (
            <li key={c.slug}>
              <Link
                href={`/c/${c.slug}`}
                className="glow-hover flex h-14 items-center gap-3 rounded-card border border-border bg-surface px-3.5 font-display font-semibold"
              >
                <Icon aria-hidden="true" className="size-5 shrink-0 text-glow" />
                <span className="truncate">{tc(`${c.slug}.name`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface HomeViewProps {
  /** Every game that appears in a pre-rendered rail or the hero. */
  initialGames: GameSummary[];
  config: SiteConfig;
  /** Seed for the Spark rotation (changes with each daily build). */
  seed: string;
}

export function HomeView({ initialGames, config: builtConfig, seed }: HomeViewProps) {
  const t = useTranslations('home');
  const { schoolSafe } = usePrefs();
  const { games: all } = useLiveGames(initialGames);
  // The admin's homepage edits apply straight away, not only after the next build.
  const liveConfig = useRepoQuery((repo) => repo.catalogue.siteConfig(), [], { initial: builtConfig, topics: ['catalogue'] });
  const config = liveConfig.data ?? builtConfig;
  const games = useMemo(
    () => all.filter((g) => isPublic(g) && (!schoolSafe || g.schoolSafe)),
    [all, schoolSafe],
  );
  const rails = useMemo(() => buildRails(games, config, { seed }), [games, config, seed]);
  const hero = useMemo(() => {
    if (games.length < HERO_MIN_GAMES) return [];
    const byId = new Map(games.map((g) => [g.id, g]));
    const picked = config.heroGameIds.map((id) => byId.get(id)).filter((g): g is GameSummary => g != null);
    // A Boost with hero days comes first after the games the team pinned.
    const heroBoost = games.filter((g) => !picked.includes(g) && isHeroActive(g.promo));
    picked.push(...heroBoost);
    const others = games.filter((g) => !picked.includes(g));
    const featuredFirst = [...sortGames(others.filter((g) => g.status === 'featured'), 'recommended'), ...sortGames(others.filter((g) => g.status !== 'featured'), 'trending')];
    return [...picked, ...featuredFirst].slice(0, 3);
  }, [games, config.heroGameIds]);
  const featured = useMemo(() => {
    const byId = new Map(games.map((g) => [g.id, g]));
    return config.featuredGameIds.map((id) => byId.get(id)).filter((g): g is GameSummary => g != null);
  }, [games, config.featuredGameIds]);

  return (
    <div className="page" data-testid="home">
      <h1 className="sr-only">{t('h1')}</h1>
      {hero.length >= HERO_MIN_GAMES ? <HeroCarousel games={hero} /> : <PublishBanner />}
      <ContinuePlaying />
      {featured.length > 0 ? <Rail title={t('featured')} games={featured} testId="rail-featured" /> : null}
      {rails.map((rail, i) => (
        <Fragment key={rail.id}>
          <Rail
            title={t(`rails.${rail.id}`)}
            games={rail.games}
            href={rail.href}
            priority={i === 0}
            testId={`rail-${rail.id}`}
          />
          {i === 1 || i === 5 ? <AdSlot placement="home-rail" className={cn('mt-7')} /> : null}
        </Fragment>
      ))}
      <CategoryGrid />
    </div>
  );
}
