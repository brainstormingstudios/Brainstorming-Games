import { AGE_GATE } from '@/lib/config';

/**
 * We ask for a birth year only, so someone born in `birthYear` may be one year younger than the
 * difference. With the conservative rule (the default), anyone who could still be under 18 this
 * year is treated as a minor: a year difference of 18 or less. Same rule as complete_signup().
 */
export function isMinorByBirthYear(birthYear: number, now: Date = new Date()): boolean {
  const diff = now.getUTCFullYear() - birthYear;
  return AGE_GATE.conservative ? diff <= AGE_GATE.adultAge : diff < AGE_GATE.adultAge;
}

/** Features a minor keeps without parental consent (guest-level). */
export const RESTRICTED_FEATURES = ['friends', 'public_profile', 'party_chat', 'named_leaderboards'] as const;

export function isRestricted(user: { isMinor: boolean; consent: string } | null): boolean {
  return Boolean(user && user.isMinor && user.consent !== 'granted');
}
