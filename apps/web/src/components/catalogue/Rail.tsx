'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { IconButton, Mascot } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import type { GameSummary } from '@/lib/data/types';
import { GameTile } from './GameTile';

/** Compact "nothing here yet" card used inside rails and small lists. */
export function ShelfEmpty({ children }: { children?: ReactNode }) {
  const t = useTranslations('empty');
  return (
    <div
      data-testid="shelf-empty"
      className="flex items-center gap-3 rounded-card border border-dashed border-border bg-surface-3 px-4 py-3"
    >
      <Mascot size={56} animated={false} />
      <p className="text-sm text-fg-muted">
        {children ?? (
          <>
            <span className="font-bold text-fg">{t('gamesTitle')}.</span> {t('gamesBody')}{' '}
            <Link href="/developers" className="font-bold text-link underline underline-offset-4">
              {t('gamesCta')}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

export interface RailProps {
  title: string;
  games: GameSummary[];
  href?: string | null;
  /** Mark the first tiles as high priority (first rail on the page only). */
  priority?: boolean;
  testId?: string;
}

/** A titled, horizontally scrolling shelf of game tiles. */
export function Rail({ title, games, href, priority, testId }: RailProps) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const id = useId();
  const track = useRef<HTMLUListElement>(null);
  const scrollBy = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  return (
    <section aria-labelledby={id} data-testid={testId ?? 'rail'} className="mt-7">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id={id} className="text-xl font-semibold sm:text-2xl">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          {href && games.length > 0 ? (
            <Link href={href} className="mr-1 inline-flex min-h-11 items-center px-1 text-sm font-bold text-link underline-offset-4 hover:underline">
              {tc('seeAll')}
              <span className="sr-only">: {title}</span>
            </Link>
          ) : null}
          {games.length > 4 ? (
            <span className="hidden gap-1 md:flex">
              <IconButton size="sm" variant="outline" label={t('railScrollLeft', { title })} onClick={() => scrollBy(-1)}>
                <ChevronLeft aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton size="sm" variant="outline" label={t('railScrollRight', { title })} onClick={() => scrollBy(1)}>
                <ChevronRight aria-hidden="true" className="size-4" />
              </IconButton>
            </span>
          ) : null}
        </div>
      </div>
      {games.length === 0 ? (
        <ShelfEmpty />
      ) : (
        <ul ref={track} className="rail-track">
          {games.map((game, i) => (
            <li key={game.id}>
              <GameTile game={game} priority={priority && i < 4} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
