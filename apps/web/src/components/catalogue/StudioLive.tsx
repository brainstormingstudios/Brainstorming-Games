'use client';

import { useTranslations } from 'next-intl';
import { BadgeCheck, Crown } from 'lucide-react';
import { Badge, EmptyState, MascotAvatar } from '@brainstorming/ui';
import { DevlogFeed, FollowButton, ReportLink } from '@/components/growth/Public';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { NotFoundView } from '@/components/shell/NotFoundView';
import type { GameSummary, StudioDetail } from '@/lib/data/types';
import { isSafeUrl } from '@/lib/domain/markdown';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { GameTile } from './GameTile';

export interface StudioLiveProps {
  slug: string;
  initial: StudioDetail | null;
  initialGames: GameSummary[];
}

/** A developer studio's public page: who they are and what they have published. */
export function StudioLive({ slug, initial, initialGames }: StudioLiveProps) {
  const t = useTranslations('studio');
  const studio = useRepoQuery((repo) => repo.catalogue.studio(slug), [slug], {
    initial: initial ?? undefined,
    topics: ['studio', 'catalogue'],
  });
  const games = useRepoQuery(
    (repo) => repo.catalogue.list({ studioSlug: slug, sort: 'popular', limit: 100 }).then((p) => p.items),
    [slug],
    { initial: initialGames, topics: ['catalogue'] },
  );
  const s = studio.data ?? initial;
  if (!s) {
    if (studio.loading) return <PageSkeleton />;
    return <NotFoundView title={t('notFoundTitle')} />;
  }
  const list = games.data ?? initialGames;
  const links = s.links.filter((l) => isSafeUrl(l.url) && /^https?:/i.test(l.url));
  return (
    <div className="page" data-testid="studio-page">
      <header className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface p-5">
        {s.avatarUrl ? (
          <img src={s.avatarUrl} alt="" width={88} height={88} className="size-22 rounded-card object-cover" />
        ) : (
          <MascotAvatar size={88} />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold">
            {s.name}
            {s.verified ? (
              <Badge tone="glow">
                <BadgeCheck aria-hidden="true" className="size-3.5" />
                {t('verified')}
              </Badge>
            ) : null}
            {s.isFirstParty ? (
              <Badge tone="primary">
                <Crown aria-hidden="true" className="size-3.5" />
                {t('firstParty')}
              </Badge>
            ) : null}
          </h1>
          {s.bio ? <p className="mt-1.5 max-w-2xl text-fg-muted">{s.bio}</p> : null}
          {links.length > 0 ? (
            <ul aria-label={t('links')} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="nofollow ugc noopener noreferrer"
                    className="font-bold text-link underline underline-offset-4"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
            <span data-testid="follower-count">{t('followers', { count: s.followers })}</span>
            <ReportLink target={{ kind: 'studio', targetType: 'studio', targetId: s.id }} />
          </p>
        </div>
        <FollowButton studioId={s.id} />
      </header>
      <section aria-labelledby="studio-games" className="mt-7">
        <h2 id="studio-games" className="mb-3 text-xl font-semibold sm:text-2xl">
          {t('games', { name: s.name })}
          <span className="ml-2 text-base font-semibold text-fg-muted">{t('gamesCount', { count: list.length })}</span>
        </h2>
        {list.length === 0 ? (
          <EmptyState title={t('noGamesTitle')} description={t('noGamesBody')} />
        ) : (
          <ul className="game-grid">
            {list.map((g) => (
              <li key={g.id}>
                <GameTile game={g} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="max-w-3xl">
        <DevlogFeed studioSlug={s.slug} heading={t('devlogs')} limit={10} />
      </div>
    </div>
  );
}
