import { IS_MOCK } from '@/lib/config';
import type { Repo } from './repo';

let repoPromise: Promise<Repo> | null = null;

/**
 * The data layer for this build: Supabase when it is configured, otherwise the in-browser mock.
 * Both are loaded on demand so neither costs anything in the first-load bundle.
 */
export function getRepo(): Promise<Repo> {
  if (!repoPromise) {
    repoPromise = IS_MOCK
      ? import('./mock').then((m) => m.createMockRepo())
      : import('./supabase').then((m) => m.createSupabaseRepo());
    repoPromise.catch(() => {
      // Let the next call retry instead of caching a failed load forever.
      repoPromise = null;
    });
  }
  return repoPromise;
}

export { RepoError } from './repo';
export type { Repo } from './repo';
