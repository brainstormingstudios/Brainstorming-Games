'use client';

import { ADSENSE_CLIENT } from '@/lib/config';
import { canPersonaliseAds, getConsent } from './consent';

// `window.adsbygoogle` is declared by the SDK's H5 ads adapter (same queue).
type AdsQueue = unknown[] & { requestNonPersonalizedAds?: number };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let loading: Promise<void> | null = null;

/** Consent Mode v2 signals, sent before any ad script runs and again on every change. */
export function applyConsentMode(kind: 'default' | 'update'): void {
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
  const c = getConsent();
  const personal = canPersonaliseAds();
  window.gtag('consent', kind, {
    ad_storage: c.ad_storage,
    ad_user_data: personal ? c.ad_user_data : 'denied',
    ad_personalization: personal ? 'granted' : 'denied',
    analytics_storage: c.analytics_storage,
  });
  if (window.adsbygoogle) window.adsbygoogle.requestNonPersonalizedAds = personal ? 0 : 1;
}

/**
 * Loads AdSense once. Non-personalised ads are requested unless the visitor is a signed-in adult
 * who opted in: unknown age, minors and school-safe mode never get personalised ads.
 */
export function loadAdsense(): Promise<void> {
  if (!ADSENSE_CLIENT) return Promise.reject(new Error('adsense disabled'));
  loading ??= new Promise<void>((resolve, reject) => {
    window.adsbygoogle = window.adsbygoogle || ([] as unknown as AdsQueue);
    applyConsentMode('default');
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('adsense blocked'));
    };
    document.head.appendChild(s);
    window.addEventListener('bg:consent', () => applyConsentMode('update'));
  });
  return loading;
}
