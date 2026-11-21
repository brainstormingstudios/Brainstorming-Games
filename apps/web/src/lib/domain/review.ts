/**
 * The review promise: a person reviews every submitted game within 72 hours. If we are late, the
 * studio gets one free Spotlight Boost (see 0019_developer_perks.sql).
 */
export const REVIEW_SLA_HOURS = 72;

export function reviewDeadline(submittedAt: string): Date {
  return new Date(new Date(submittedAt).getTime() + REVIEW_SLA_HOURS * 3_600_000);
}

/** Whole hours left before the deadline; negative once it has passed. */
export function reviewHoursLeft(submittedAt: string, now = new Date()): number {
  return Math.floor((reviewDeadline(submittedAt).getTime() - now.getTime()) / 3_600_000);
}

export function reviewLate(submittedAt: string, decidedAt: string | Date = new Date()): boolean {
  return new Date(decidedAt).getTime() > reviewDeadline(submittedAt).getTime();
}
