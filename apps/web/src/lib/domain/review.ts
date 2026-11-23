/**
 * The review promise: a person reviews every submitted game within 72 hours. If we are late, the
 * studio gets one free Spotlight Boost (see 0019_developer_perks.sql).
 */
export const REVIEW_SLA_HOURS = 72;

/** Verified studios are promised a review within 24 hours (migration 0027). */
export const reviewSlaHours = (verified: boolean): number => (verified ? 24 : REVIEW_SLA_HOURS);

export function reviewDeadline(submittedAt: string, hours = REVIEW_SLA_HOURS): Date {
  return new Date(new Date(submittedAt).getTime() + hours * 3_600_000);
}

/** Whole hours left before the deadline; negative once it has passed. */
export function reviewHoursLeft(submittedAt: string, now = new Date(), hours = REVIEW_SLA_HOURS): number {
  return Math.floor((reviewDeadline(submittedAt, hours).getTime() - now.getTime()) / 3_600_000);
}

export function reviewLate(submittedAt: string, decidedAt: string | Date = new Date(), hours = REVIEW_SLA_HOURS): boolean {
  return new Date(decidedAt).getTime() > reviewDeadline(submittedAt, hours).getTime();
}
