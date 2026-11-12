'use client';

import { useEffect } from 'react';
import { setKnownAdult } from '@/lib/ads/consent';
import type { SessionUser } from '@/lib/data/repo';
import { useRepoQuery } from './useRepoQuery';

/** The signed-in player (null for guests). `ready` is false until the first check finishes. */
export function useSession(): { user: SessionUser | null; ready: boolean; refresh: () => void } {
  const { data, loading, refresh } = useRepoQuery((repo) => repo.auth.session(), [], {
    topics: ['session', 'profile', 'points'],
  });
  const user = data ?? null;
  useEffect(() => {
    setKnownAdult(Boolean(user && !user.isMinor));
  }, [user]);
  return { user, ready: !loading || data !== undefined, refresh };
}

export const isStaff = (user: SessionUser | null) => user?.role === 'admin' || user?.role === 'moderator';
