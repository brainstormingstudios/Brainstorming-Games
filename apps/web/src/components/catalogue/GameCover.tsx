'use client';

import { useState } from 'react';
import { cn } from '@brainstorming/ui';
import type { GameSummary, MediaAsset } from '@/lib/data/types';
import { fallbackGradient, srcSetFor, variantUrl } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';

export interface GameCoverProps {
  game: Pick<GameSummary, 'slug' | 'title' | 'cover'>;
  /** Override the asset (portrait or square covers, A/B variants). */
  asset?: MediaAsset | null;
  /** CSS `sizes` for the responsive image. */
  sizes?: string;
  /** Above the fold: load eagerly with high priority (the LCP image). */
  priority?: boolean;
  className?: string;
  /** Empty alt by default: tiles already name the game in text. */
  alt?: string;
}

/**
 * A game cover with responsive WebP variants and a blur placeholder. Games without a cover (or
 * with a broken one) get a brand gradient with the title's first letter, never a broken image.
 */
export function GameCover({
  game,
  asset,
  sizes = '(min-width: 120rem) 268px, (min-width: 40rem) 208px, 44vw',
  priority = false,
  className,
  alt = '',
}: GameCoverProps) {
  const { lowData } = usePrefs();
  const [failed, setFailed] = useState(false);
  const cover = asset === undefined ? game.cover : asset;

  if (!cover || failed) {
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        className={cn('flex size-full items-center justify-center', className)}
        style={{ background: fallbackGradient(game.slug) }}
      >
        <span aria-hidden="true" className="font-display text-4xl font-bold text-white/85 select-none">
          {game.title.trim().charAt(0).toUpperCase() || '?'}
        </span>
      </div>
    );
  }

  const smallest = cover.widths[0];
  return (
    <img
      src={lowData && smallest ? variantUrl(cover, smallest) : cover.url}
      // Low-data mode only ever offers the smallest variant.
      srcSet={lowData ? undefined : srcSetFor(cover)}
      sizes={lowData ? undefined : sizes}
      width={cover.width}
      height={cover.height}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('size-full object-cover', className)}
      style={
        cover.placeholder
          ? { backgroundImage: `url(${cover.placeholder})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: fallbackGradient(game.slug) }
      }
    />
  );
}
