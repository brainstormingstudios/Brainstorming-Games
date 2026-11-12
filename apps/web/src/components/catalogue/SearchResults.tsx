'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EmptyState, Skeleton, buttonClass } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { usePrefs } from '@/lib/prefs';
import { GameTile } from './GameTile';

/** `/search?q=`: the query lives in the URL, so results are shareable and the page is static. */
export function SearchResults() {
  const t = useTranslations('search');
  const tl = useTranslations('listing');
  const te = useTranslations('empty');
  const q = (useSearchParams().get('q') ?? '').trim().slice(0, 80);
  const { schoolSafe } = usePrefs();
  const { data, loading } = useRepoQuery((repo) => (q ? repo.catalogue.search(q, 60) : Promise.resolve([])), [q], {
    topics: ['catalogue'],
  });
  const games = (data ?? []).filter((g) => !schoolSafe || g.schoolSafe);
  return (
    <div className="page" data-testid="search-page">
      <h1 className="text-3xl font-bold sm:text-4xl">{q ? t('heading', { query: q }) : t('headingEmpty')}</h1>
      {!q ? (
        <p className="mt-2 max-w-2xl text-fg-muted">{t('prompt')}</p>
      ) : loading && !data ? (
        <div className="game-grid mt-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <EmptyState
          className="mt-5"
          title={t('noResultsTitle', { query: q })}
          description={`${t('noResultsBody')} ${te('gamesBody')}`}
          action={
            <Link href="/developers" className={buttonClass({ variant: 'outline' })}>
              {te('gamesCta')}
            </Link>
          }
        />
      ) : (
        <>
          <p className="mt-2 text-sm font-semibold text-fg-muted" aria-live="polite">
            {tl('count', { count: games.length })}
          </p>
          <ul className="game-grid mt-4" data-testid="search-page-results">
            {games.map((g) => (
              <li key={g.id}>
                <GameTile game={g} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
