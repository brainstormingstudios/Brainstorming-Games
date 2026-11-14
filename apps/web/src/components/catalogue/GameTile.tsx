'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Sparkles, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@brainstorming/ui';
import { localizePath } from '@/i18n/config';
import { Link, useLocale } from '@/i18n/navigation';
import { BUILD_TIME } from '@/lib/config';
import { getAnonId } from '@/lib/data/local';
import type { GameSummary } from '@/lib/data/types';
import { variantFor } from '@/lib/domain/abTest';
import { gameHref } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { GameCover } from './GameCover';

/** A game page exists in this build only if the game was already live when the build started. */
export function isPrebuilt(game: Pick<GameSummary, 'releasedAt'>): boolean {
  return game.releasedAt != null && game.releasedAt <= BUILD_TIME;
}

export interface GameTileProps {
  game: GameSummary;
  priority?: boolean;
  sizes?: string;
  className?: string;
}

const HOVER_DELAY = 350;
const LONG_PRESS = 450;

/**
 * Landscape tile. On desktop the silent preview plays on hover; on touch a long press plays it.
 * Previews never load in low-data mode.
 */
export function GameTile({ game, priority, sizes, className }: GameTileProps) {
  const t = useTranslations('game');
  const locale = useLocale();
  const router = useRouter();
  const { lowData } = usePrefs();
  const [preview, setPreview] = useState(false);
  const timer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const href = gameHref(game.slug);
  const prebuilt = isPrebuilt(game);
  const canPreview = Boolean(game.preview) && !lowData;

  // Every tile shown is an impression and every click is counted: the discovery algorithm's raw
  // input. In a thumbnail A/B test each visitor always sees the same cover, counted per cover.
  const link = useRef<HTMLAnchorElement>(null);
  const testing = game.coverVariants.length >= 2;
  const [variant, setVariant] = useState<string | null>(null);
  useEffect(() => {
    // '' means "no test": the tile is still counted for the discovery algorithm.
    setVariant(testing ? variantFor(getAnonId(), game.id, game.coverVariants.map((m) => m.variantLabel ?? '')) : '');
  }, [testing, game.id, game.coverVariants]);
  useEffect(() => {
    const el = link.current;
    if (variant == null || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void import('@/lib/growth/abTracker').then((m) => m.recordImpression(game.id, variant));
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [variant, game.id]);
  const variantAsset = variant ? game.coverVariants.find((m) => m.variantLabel === variant) : undefined;

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const arm = (delay: number, fromTouch: boolean) => {
    if (!canPreview) return;
    clear();
    timer.current = window.setTimeout(() => {
      setPreview(true);
      if (fromTouch) suppressClick.current = true;
    }, delay);
  };
  const stop = () => {
    clear();
    setPreview(false);
  };

  return (
    <Link
      ref={link}
      href={href}
      hard={!prebuilt}
      data-testid="game-tile"
      data-slug={game.slug}
      data-variant={variant || undefined}
      className={cn('game-tile group block rounded-card', className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        arm(HOVER_DELAY, false);
        // Warm the page on intent rather than for every tile on screen.
        if (prebuilt && !lowData) router.prefetch(localizePath(href, locale));
      }}
      onPointerLeave={stop}
      onTouchStart={() => arm(LONG_PRESS, true)}
      onTouchEnd={stop}
      onTouchMove={stop}
      onTouchCancel={stop}
      onContextMenu={(e) => {
        if (preview) e.preventDefault();
      }}
      onClick={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          return;
        }
        if (variant != null) void import('@/lib/growth/abTracker').then((m) => m.recordClick(game.id, variant));
      }}
    >
      <span className="relative block aspect-video overflow-hidden rounded-card border border-border bg-surface shadow-card transition-[transform,box-shadow] duration-200 ease-(--ease-spring) group-hover:-translate-y-1 group-hover:shadow-glow group-focus-visible:shadow-glow">
        <GameCover game={game} asset={variantAsset} priority={priority} sizes={sizes} />
        {preview && game.preview ? (
          <video
            src={game.preview.url}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
            aria-hidden="true"
            className="absolute inset-0 size-full animate-fade-in object-cover"
          />
        ) : null}
        <span className="pointer-events-none absolute top-1.5 left-1.5 flex gap-1">
          {game.status === 'spark' ? (
            <span
              title={t('sparkBadgeHint')}
              className="inline-flex items-center gap-1 rounded-full bg-navy-950/85 px-2 py-0.5 text-[0.7rem] font-extrabold text-cyan-300"
            >
              <Sparkles aria-hidden="true" className="size-3" />
              {t('sparkBadge')}
            </span>
          ) : null}
          {game.isMultiplayer ? (
            <span
              className="inline-flex items-center rounded-full bg-navy-950/85 p-1 text-white"
              title={t('multiplayerBadge')}
            >
              <Users aria-hidden="true" className="size-3" />
              <span className="sr-only">{t('multiplayerBadge')}</span>
            </span>
          ) : null}
        </span>
      </span>
      <span className="mt-1.5 block truncate px-1 text-sm font-bold text-fg">{game.title}</span>
    </Link>
  );
}
