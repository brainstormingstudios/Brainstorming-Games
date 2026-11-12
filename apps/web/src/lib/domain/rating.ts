/**
 * Game rating out of 10.
 *
 * A Bayesian average: every game starts with 20 imaginary votes at 70% liked, so three likes on a
 * new game do not outrank a classic with thousands. Only votes from the last 180 days count; the
 * caller is responsible for passing windowed counts.
 */
export const RATING_PRIOR_VOTES = 20;
export const RATING_PRIOR_MEAN = 0.7;
export const RATING_WINDOW_DAYS = 180;

export function bayesianRating10(likes: number, dislikes: number): number | null {
  const l = Math.max(0, Math.floor(likes));
  const d = Math.max(0, Math.floor(dislikes));
  const votes = l + d;
  if (votes === 0) return null;
  const score = (10 * (RATING_PRIOR_VOTES * RATING_PRIOR_MEAN + l)) / (RATING_PRIOR_VOTES + votes);
  return Math.round(score * 10) / 10;
}

/** Whether a vote cast at `createdAt` still counts at `now`. */
export function isVoteInWindow(createdAt: string, now: Date = new Date()): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return age <= RATING_WINDOW_DAYS * 86_400_000;
}
