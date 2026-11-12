'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Skeleton } from '@brainstorming/ui';
import { splitLocale } from '@/i18n/config';
import { NotFoundView } from './NotFoundView';

const GameLive = dynamic(() => import('@/components/game/GameLive').then((m) => m.GameLive), {
  loading: () => <PageSkeleton />,
});
const StudioLive = dynamic(() => import('@/components/catalogue/StudioLive').then((m) => m.StudioLive), {
  loading: () => <PageSkeleton />,
});
const ListingLive = dynamic(() => import('@/components/catalogue/ListingLive').then((m) => m.ListingLive), {
  loading: () => <PageSkeleton />,
});
const ProfilePage = dynamic(() => import('@/components/player/Account').then((m) => m.ProfilePage), {
  loading: () => <PageSkeleton />,
});
const PartyRoom = dynamic(() => import('@/components/player/Social').then((m) => m.PartyRoom), {
  loading: () => <PageSkeleton />,
});

export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton className="aspect-video w-full max-w-5xl" />
      <Skeleton className="mt-4 h-8 w-2/3 max-w-md" />
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
    </div>
  );
}

type Resolved =
  | { kind: 'pending' }
  | { kind: 'game'; slug: string }
  | { kind: 'studio'; slug: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'profile' }
  | { kind: 'party' }
  | { kind: 'none' };

/** Maps a pathname (without its locale prefix) onto a page that can render in the browser. */
export function resolvePath(pathname: string): Resolved {
  const { path } = splitLocale(pathname);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b] = parts;
  if (parts.length === 2 && a === 'u' && b && /^[a-z0-9_]{3,20}$/i.test(b)) return { kind: 'profile' };
  if (parts.length === 2 && a === 'party' && b && /^[a-z0-9]{4,6}$/i.test(b)) return { kind: 'party' };
  if (parts.length === 2 && b && /^[a-z0-9][a-z0-9-]{0,63}$/.test(b)) {
    if (a === 'game') return { kind: 'game', slug: b };
    if (a === 'studio') return { kind: 'studio', slug: b };
    if (a === 't') return { kind: 'tag', tag: b };
  }
  return { kind: 'none' };
}

/**
 * Renders pages that have no pre-rendered file: a game published after the last build, a studio
 * page, a tag. Anything else is a real 404.
 */
export function ClientFallback() {
  const [route, setRoute] = useState<Resolved>({ kind: 'pending' });
  useEffect(() => setRoute(resolvePath(window.location.pathname)), []);
  switch (route.kind) {
    case 'pending':
      return <PageSkeleton />;
    case 'game':
      return <GameLive slug={route.slug} initial={null} related={null} />;
    case 'studio':
      return <StudioLive slug={route.slug} initial={null} initialGames={[]} />;
    case 'tag':
      return <ListingLive kind="tag" slug={route.tag} initial={[]} />;
    case 'profile':
      return (
        <div className="page">
          <ProfilePage />
        </div>
      );
    case 'party':
      return (
        <div className="page">
          <PartyRoom />
        </div>
      );
    default:
      return <NotFoundView />;
  }
}
