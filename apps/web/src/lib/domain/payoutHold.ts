/**
 * Security Phase 3: a change to payout details waits this long before money can go to it, and it
 * needs a sign-in from the last REAUTH_MINUTES. Mirrors supabase/functions/payout-profile.
 */
export const PAYOUT_HOLD_HOURS = 48;
export const REAUTH_MINUTES = 15;

export interface HoldRow<M, C> {
  method: M | null;
  currency: C | null;
  summary: string | null;
  updatedAt: string;
  pending?: { method: M; currency: C; summary: string; effectiveAt: string } | null;
}

/** Moves a change whose hold is over into use. Returns the same object when nothing changed. */
export function promoteHold<T extends HoldRow<unknown, unknown>>(row: T, now = Date.now()): T {
  const p = row.pending;
  if (!p || Date.parse(p.effectiveAt) > now) return row;
  return { ...row, method: p.method, currency: p.currency, summary: p.summary, updatedAt: new Date(now).toISOString(), pending: null };
}

/** When a change saved now takes effect. */
export function holdUntil(now = Date.now()): string {
  return new Date(now + PAYOUT_HOLD_HOURS * 3_600_000).toISOString();
}
