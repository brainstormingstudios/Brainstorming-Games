/**
 * Where money flows, for now: India only (decided 2026-11-22).
 * - Players buy Premium and Boosts only from India (prices are in rupees, GST applies).
 * - Studios and creators earn only when they are in India and are paid to an Indian bank account.
 * Add a country here (and the payment and tax set-up behind it) to open it up later.
 */
export const PAID_COUNTRIES: readonly string[] = ['IN'];
export const EARNING_COUNTRIES: readonly string[] = ['IN'];

/** Unknown country (no data) is allowed to see prices; Razorpay and the billing function still check. */
export const canBuyIn = (country: string | null | undefined) => !country || PAID_COUNTRIES.includes(country.toUpperCase());

/** Studios earn only in these countries. A studio without a country does not earn. */
export const canEarnIn = (country: string | null | undefined) => Boolean(country) && EARNING_COUNTRIES.includes(country!.toUpperCase());
