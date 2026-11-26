'use client';

import { isHeroActive } from '@/lib/domain/premium';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Play, Rocket } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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

const HERO_MS = 7000;

/**
 * Featured games, cinematic: slides cross-fade while the artwork slowly zooms (a gentle camera
 * move), the title and Play button rise in after it, and bars show the time to the next game.
 * Only the active slide's silent preview plays (none in low-data mode). Swipe on phones; hover
 * or focus pauses; reduced motion keeps a plain fade.
 */
function HeroCarousel({ games }: { games: GameSummary[] }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const tg = useTranslations('game');
  const { lowData } = usePrefs();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const swipe = useRef<number | null>(null);
  const count = games.length;
  const go = (next: number) => {
    setIndex(((next % count) + count) % count);
    setCycle((c) => c + 1);
  };
  useEffect(() => {
    if (paused || count < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setTimeout(() => go(index + 1), HERO_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts on every slide change
  }, [paused, count, index, cycle]);
  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('heroLabel')}
      data-testid="hero-carousel"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => (swipe.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const from = swipe.current;
        const to = e.changedTouches[0]?.clientX;
        swipe.current = null;
        if (from == null || to == null || Math.abs(to - from) < 45) return;
        go(to < from ? index + 1 : index - 1);
      }}
      className="hero relative overflow-hidden rounded-card border border-border bg-navy-950"
    >
      <div className="relative aspect-[16/10] max-h-[26rem] w-full sm:aspect-[21/9]">
        {games.map((game, i) => {
          const active = i === index;
          return (
            <div
              key={game.id}
              role="group"
              aria-roledescription="slide"
              aria-label={t('heroSlide', { index: i + 1, total: count })}
              aria-hidden={active ? undefined : true}
              data-active={active || undefined}
              className={cn('hero-slide absolute inset-0', active ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0')}
            >
              <div key={active ? `on-${cycle}` : 'off'} className={cn('absolute inset-0', active && 'hero-kenburns')}>
                <GameCover game={game} priority={i === 0} sizes="(min-width: 64rem) 70vw, 100vw" />
                {active && game.preview && !lowData ? (
                  <video
                    src={game.preview.url}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="none"
                    aria-hidden="true"
                    className="hero-video absolute inset-0 size-full object-cover"
                  />
                ) : null}
              </div>
              <div className="absolute inset-0 bg-linear-to-t from-navy-950 via-navy-950/40 to-transparent" />
              <div className="absolute inset-0 bg-linear-to-r from-navy-950/70 via-transparent to-transparent" />
              {active ? (
                <div key={`text-${cycle}`} className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 pb-7 sm:p-6 sm:pb-9">
                  <div className="min-w-0 text-white">
                    <h2 className="hero-rise truncate text-2xl font-bold drop-shadow-lg sm:text-4xl">{game.title}</h2>
                    <p className="hero-rise hero-rise-2 mt-1 line-clamp-2 max-w-xl text-sm text-white/90 sm:text-base">{game.shortDescription}</p>
                  </div>
                  <Link
                    href={gameHref(game.slug)}
                    hard={!isPrebuilt(game)}
                    className={cn(buttonClass({ size: 'lg' }), 'hero-rise hero-rise-3')}
                    aria-label={tg('playLabel', { title: game.title })}
                  >
                    <Play aria-hidden="true" className="size-5 fill-current" />
                    {tc('play')}
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {count > 1 ? (
        <>
          <div className="absolute top-3 right-3 z-20 flex gap-1">
            <IconButton size="sm" variant="secondary" label={tc('previous')} onClick={() => go(index - 1)}>
              <ChevronLeft aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton size="sm" variant="secondary" label={tc('next')} onClick={() => go(index + 1)}>
              <ChevronRight aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
          <div className="absolute inset-x-4 bottom-2.5 z-20 flex gap-1.5 sm:inset-x-6">
            {games.map((g, i) => (
              <button
                key={g.id}
                type="button"
                aria-label={t('heroSlide', { index: i + 1, total: count })}
                aria-current={i === index || undefined}
                onClick={() => go(i)}
                className="relative h-4 flex-1"
              >
                <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
                  <span
                    key={i === index ? `bar-${cycle}` : 'bar'}
                    className={cn('block h-full rounded-full bg-white', i === index ? (paused ? 'hero-bar hero-bar-paused' : 'hero-bar') : i < index ? 'w-full' : 'w-0')}
                  />
                </span>
              </button>
            ))}
          </div>
        </>
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
