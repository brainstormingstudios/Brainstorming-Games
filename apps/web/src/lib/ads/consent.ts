'use client';

import { local } from '@/lib/data/local';
import { getPrefs } from '@/lib/prefs';

/**
 * Ad personalisation (section 7 of the brief):
 *   - unknown age, any minor and school-safe mode: non-personalised ads only;
 *   - signed-in adults: personalised only with consent (asked in the EU, EEA and UK; the
 *     consent banner records the choice).
 */
export const CONSENT_KEY = 'bg.consent';

export interface ConsentState {
  /** Consent Mode v2 signals. */
  ad_storage: 'granted' | 'denied';
  ad_user_data: 'granted' | 'denied';
  ad_personalization: 'granted' | 'denied';
  analytics_storage: 'granted' | 'denied';
  decidedAt: string | null;
}

export const DENIED: ConsentState = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  decidedAt: null,
};

export function getConsent(): ConsentState {
  return { ...DENIED, ...local.get<Partial<ConsentState>>(CONSENT_KEY, {}) };
}

export function setConsent(state: Omit<ConsentState, 'decidedAt'>): void {
  local.set(CONSENT_KEY, { ...state, decidedAt: new Date().toISOString() });
  window.dispatchEvent(new CustomEvent('bg:consent'));
}

/** Set by the auth layer: whether the signed-in player is a known adult. */
let knownAdult = false;
export function setKnownAdult(value: boolean): void {
  knownAdult = value;
}

export function canPersonaliseAds(): boolean {
  if (typeof window === 'undefined') return false;
  if (getPrefs().schoolSafe) return false;
  if (!knownAdult) return false;
  return getConsent().ad_personalization === 'granted';
}
