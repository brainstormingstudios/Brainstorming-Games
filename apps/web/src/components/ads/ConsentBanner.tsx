'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button, Switch } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { getConsent, setConsent } from '@/lib/ads/consent';

/** EU, EEA, UK and Switzerland, judged by the browser's time zone (no IP lookup, no tracking). */
export function needsConsentPrompt(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (/^Europe\/(Moscow|Minsk|Kirov|Volgograd|Samara|Ulyanovsk|Astrakhan|Saratov|Istanbul|Simferopol)$/.test(tz)) return false;
    return tz.startsWith('Europe/') || /^Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe)$/.test(tz);
  } catch {
    return false;
  }
}

/**
 * Cookie consent in the style of Consent Mode v2. Shown automatically to EU and UK visitors
 * until they choose; anyone can reopen it from Cookie preferences. Defaults are "denied", and the
 * reject button is as prominent as accept.
 */
export function ConsentBanner() {
  const t = useTranslations('cookieBanner');
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [ads, setAds] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    if (needsConsentPrompt() && !getConsent().decidedAt) setOpen(true);
    const reopen = () => {
      const c = getConsent();
      setAds(c.ad_personalization === 'granted');
      setAnalytics(c.analytics_storage === 'granted');
      setCustom(true);
      setOpen(true);
    };
    window.addEventListener('bg:open-consent', reopen);
    return () => window.removeEventListener('bg:open-consent', reopen);
  }, []);

  if (!open) return null;
  const decide = (personalised: boolean, measure: boolean) => {
    setConsent({
      ad_storage: 'granted',
      ad_user_data: personalised ? 'granted' : 'denied',
      ad_personalization: personalised ? 'granted' : 'denied',
      analytics_storage: measure ? 'granted' : 'denied',
    });
    setOpen(false);
  };
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-[calc(var(--tabs-h)+12px)] z-[75] mx-auto max-w-2xl animate-pop-in rounded-card border border-border bg-surface-3 p-4 shadow-card"
    >
      <h2 id="consent-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {t('body')}{' '}
        <Link href="/cookies" className="font-bold text-link underline">
          {t('more')}
        </Link>
      </p>
      {custom ? (
        <div className="mt-3 flex flex-col gap-3">
          <Switch label={t('personalised')} description={t('personalisedBody')} checked={ads} onChange={(e) => setAds(e.target.checked)} />
          <Switch label={t('analytics')} description={t('analyticsBody')} checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => decide(false, false)} data-testid="consent-reject">
          {t('reject')}
        </Button>
        <Button onClick={() => decide(true, true)} data-testid="consent-accept">
          {t('accept')}
        </Button>
        {custom ? (
          <Button variant="outline" onClick={() => decide(ads, analytics)}>
            {t('save')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setCustom(true)}>
            {t('customise')}
          </Button>
        )}
      </div>
    </section>
  );
}

export function CookieChoicesButton() {
  const t = useTranslations('cookieBanner');
  return (
    <Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('bg:open-consent'))} data-testid="cookie-choices">
      {t('change')}
    </Button>
  );
}
