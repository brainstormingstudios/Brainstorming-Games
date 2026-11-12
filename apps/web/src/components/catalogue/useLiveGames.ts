'use client';

import { useMemo } from 'react';
import { mergeLive } from '@/lib/catalogue/listings';
import { BUILD_TIME } from '@/lib/config';
import type { GameSummary } from '@/lib/data/types';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

/**
 * Pre-rendered games plus everything that changed since the build: newly published games appear,
 * paused or removed ones disappear. In mock mode the pre-rendered list is empty and every game
 * arrives through this path.
 */
export function useLiveGames(initial: GameSummary[]): { games: GameSummary[]; settled: boolean } {
  const { data, loading } = useRepoQuery(
    (repo) => repo.catalogue.list({ changedSince: BUILD_TIME }),
    [],
    { topics: ['catalogue', 'ratings'] },
  );
  const games = useMemo(() => mergeLive(initial, data?.items ?? []), [initial, data]);
  return { games, settled: !loading };
}
