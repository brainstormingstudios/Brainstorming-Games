'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRepo, type Repo } from '@/lib/data';
import { onTopic, type Topic } from '@/lib/data/bus';

export interface RepoQueryOptions<T> {
  /** Data to show before the first fetch resolves (usually pre-rendered at build time). */
  initial?: T;
  /** Refetch whenever one of these topics is emitted. */
  topics?: Topic[];
  enabled?: boolean;
}

export interface RepoQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Runs a repository read on the client, keeps it fresh when related data changes, and ignores
 * responses that arrive out of order.
 */
export function useRepoQuery<T>(
  fn: (repo: Repo) => Promise<T>,
  deps: readonly unknown[],
  { initial, topics, enabled = true }: RepoQueryOptions<T> = {},
): RepoQueryResult<T> {
  const [data, setData] = useState<T | undefined>(initial);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const request = useRef(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    getRepo()
      .then((repo) => fnRef.current(repo))
      .then(
        (result) => {
          if (request.current !== id) return;
          setData(result);
          setError(null);
          setLoading(false);
        },
        (err: unknown) => {
          if (request.current !== id) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [enabled, tick, ...deps]);

  const topicKey = topics?.join(',') ?? '';
  useEffect(() => {
    if (!topicKey) return;
    const offs = (topicKey.split(',') as Topic[]).map((t) => onTopic(t, refresh));
    return () => offs.forEach((off) => off());
  }, [topicKey, refresh]);

  return { data, loading, error, refresh };
}
