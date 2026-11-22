import type { PayoutMethod, PayoutProfileInput } from '@/lib/data/repo';

/**
 * Payout methods open now: Indian bank accounts (INR) only, as earnings are for India only
 * (lib/domain/market.ts). PayPal, Wise and Payoneer stay in the code for when we open abroad.
 */
export const OPEN_PAYOUT_METHODS: readonly PayoutMethod[] = ['bank'];

/** Validates payout details and returns an error message, or null when they look right. */
export function validatePayoutProfile(p: PayoutProfileInput): string | null {
  if (!OPEN_PAYOUT_METHODS.includes(p.method)) return 'Payouts go to Indian bank accounts only for now.';
  if (p.accountName.trim().length < 3) return 'Enter the account holder’s full name.';
  if (p.method === 'bank') {
    if (p.currency !== 'INR') return 'Indian bank transfers are paid in INR.';
    if (!/^\d{9,18}$/.test(p.details.accountNumber ?? '')) return 'Enter a valid account number (9 to 18 digits).';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test((p.details.ifsc ?? '').toUpperCase())) return 'Enter a valid IFSC code (e.g. HDFC0001234).';
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.details.email ?? '')) return 'Enter the e-mail address of the account.';
  return null;
}

/** A masked one-line summary: the only form in which payout details are ever shown again. */
export function maskPayoutProfile(p: PayoutProfileInput): string {
  if (p.method === 'bank') {
    const acct = p.details.accountNumber ?? '';
    return `Bank ••••${acct.slice(-4)} (${(p.details.ifsc ?? '').toUpperCase()})`;
  }
  const [user = '', domain = ''] = (p.details.email ?? '').split('@');
  const name = { paypal: 'PayPal', wise: 'Wise', payoneer: 'Payoneer' }[p.method];
  return `${name} ${user.slice(0, 2)}•••@${domain}`;
}
