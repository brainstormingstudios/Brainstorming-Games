import { RepoError } from '../repo';

/** Maps a PostgREST or function error onto the UI's error codes. */
export function toRepoError(error: { message: string; code?: string }): RepoError {
  const text = `${error.code ?? ''} ${error.message}`.toLowerCase();
  if (text.includes('rate_limited')) return new RepoError('rate_limited');
  if (text.includes('login_required') || error.code === 'PGRST301') return new RepoError('login_required');
  if (text.includes('not_allowed') || error.code === '42501') return new RepoError('not_allowed');
  if (text.includes('not_found')) return new RepoError('not_found');
  if (text.includes('conflict') || error.code === '23505') return new RepoError('conflict');
  if (text.includes('invalid') || error.code === '23514' || error.code === '22023') {
    return new RepoError('invalid', error.message);
  }
  return new RepoError('unavailable', error.message);
}
