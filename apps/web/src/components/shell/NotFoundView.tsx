'use client';

import { useTranslations } from 'next-intl';
import { MascotAvatar, buttonClass } from '@brainstorming/ui';
import { GameTile } from '@/components/catalogue/GameTile';
import { Link } from '@/i18n/navigation';
import { MASCOT_NAME } from '@/lib/config';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

/** 404 body: the sad mascot, a way home and a few games to play instead. */
export function NotFoundView({ title, body }: { title?: string; body?: string }) {
  const t = useTranslations('notFound');
  const { data } = useRepoQuery((repo) => repo.catalogue.list({ sort: 'trending', limit: 6 }), [], {
    topics: ['catalogue'],
  });
  const games = data?.items ?? [];
  return (
    <div className="page" data-testid="not-found">
      <div className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
        <MascotAvatar size={168} mood="sad" animated />
        <h1 className="mt-4 text-3xl font-bold">{title ?? t('title')}</h1>
        <p className="mt-2 text-fg-muted">{body ?? t('body', { name: MASCOT_NAME })}</p>
        <Link href="/" className={buttonClass({ size: 'lg', className: 'mt-5' })}>
          {t('home')}
        </Link>
      </div>
      {games.length > 0 ? (
        <section aria-labelledby="nf-suggestions" className="pb-4">
          <h2 id="nf-suggestions" className="mb-3 text-xl font-semibold">
            {t('suggestions')}
          </h2>
          <ul className="game-grid">
            {games.map((g) => (
              <li key={g.id}>
                <GameTile game={g} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
