'use client';

import { useTranslations } from 'next-intl';
import { Button, EmptyState, Skeleton, buttonClass, useToast } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { GameTile } from './GameTile';

/** "Recently played" and "Favourites": lists kept on this device for guests. */
export function SavedGames({ kind }: { kind: 'recent' | 'favourites' }) {
  const t = useTranslations('listing');
  const te = useTranslations('empty');
  const toast = useToast();
  const { data, loading } = useRepoQuery(
    async (repo) => {
      const ids =
        kind === 'recent'
          ? (await repo.player.history()).map((h) => h.gameId)
          : (await repo.player.favourites()).slice().reverse();
      return ids.length ? repo.catalogue.byIds(ids) : [];
    },
    [kind],
    { topics: [kind === 'recent' ? 'history' : 'favourites', 'catalogue'] },
  );
  const games = data ?? [];
  return (
    <div className="page" data-testid={`saved-${kind}`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold sm:text-4xl">{t(`pages.${kind}.title`)}</h1>
          <p className="mt-2 text-fg-muted">{t(`pages.${kind}.intro`)}</p>
        </div>
        {kind === 'recent' && games.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void getRepo()
                .then((repo) => repo.player.clearHistory())
                .then(() => toast(t('historyCleared')))
            }
          >
            {t('clearHistory')}
          </Button>
        ) : null}
      </header>
      {loading && !data ? (
        <div className="game-grid mt-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <EmptyState
          className="mt-5"
          title={te(kind === 'recent' ? 'historyTitle' : 'favouritesTitle')}
          description={te(kind === 'recent' ? 'historyBody' : 'favouritesBody')}
          action={
            <Link href="/" className={buttonClass({})}>
              {te('browse')}
            </Link>
          }
        />
      ) : (
        <ul className="game-grid mt-5">
          {games.map((g) => (
            <li key={g.id}>
              <GameTile game={g} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
