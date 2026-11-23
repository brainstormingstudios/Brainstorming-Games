'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Mascot, ToastProvider } from '@brainstorming/ui';
import { ConsentBanner } from '@/components/ads/ConsentBanner';
import { NavProgress } from './NavProgress';
import { LoginDialog } from '@/components/auth/AccountMenu';
import { MASCOT_NAME } from '@/lib/config';
import { getRepo } from '@/lib/data';
import { creatorRef, referral } from '@/lib/data/local';
import { track } from '@/lib/events/client';
import { getPrefs, setPrefs } from '@/lib/prefs';

/** Registers the service worker (production only) and records page views and referral links. */
function AppEffects() {
  const pathname = usePathname();
  useEffect(() => {
    const before = referral.current();
    referral.capture(window.location.search);
    const after = referral.current();
    // A new referral visit is credited to the studio (85% share on its players' ad revenue).
    if (after && after !== before) void getRepo().then((repo) => repo.player.recordReferral(after)).catch(() => {});
    // A creator link (`?cr=handle`) credits the creator for 30 days.
    const creatorBefore = creatorRef.current();
    const creator = creatorRef.capture(window.location.search);
    if (creator && creator !== creatorBefore) void getRepo().then((repo) => repo.creators.recordVisit(creator)).catch(() => {});
    // Thumbnail-test clicks that the previous page could not deliver before it unloaded.
    try {
      if (window.sessionStorage.getItem('bg.ab.pending')) void import('@/lib/growth/abTracker');
    } catch {
      // storage unavailable
    }
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const register = () => void navigator.serviceWorker.register('/sw.js').catch(() => {});
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }
  }, []);
  useEffect(() => {
    if (!pathname) return;
    // Game pages send their own page_view with the game id.
    if (/^\/([a-z]{2}\/)?game\//.test(pathname)) return;
    track('page_view', { payload: { path: pathname } });
  }, [pathname]);
  return null;
}

/** The mascot says hello once, the first time someone visits. */
function MascotGreeting() {
  const t = useTranslations('shell');
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (getPrefs().greeted) return;
    const id = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(id);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setPrefs({ greeted: true });
    setShow(false);
  };
  return (
    <div
      role="status"
      data-testid="mascot-greeting"
      className="fixed right-4 bottom-[calc(var(--tabs-h)+16px)] z-[70] flex max-w-[min(22rem,calc(100vw-2rem))] animate-pop-in items-center gap-3 rounded-card border border-border bg-surface-3 p-3 pr-4 shadow-card"
    >
      <Mascot size={64} />
      <div className="min-w-0">
        <p className="font-display text-base font-semibold">{t('greetingTitle', { name: MASCOT_NAME })}</p>
        <p className="text-sm text-fg-muted">{t('greetingBody')}</p>
        <Button size="sm" className="mt-2" onClick={dismiss}>
          {t('greetingCta')}
        </Button>
      </div>
    </div>
  );
}

export function Providers({ children, dismissLabel }: { children: ReactNode; dismissLabel: string }) {
  return (
    <ToastProvider dismissLabel={dismissLabel}>
      <NavProgress />
      <AppEffects />
      {children}
      <MascotGreeting />
      <LoginDialog />
      <ConsentBanner />
    </ToastProvider>
  );
}
