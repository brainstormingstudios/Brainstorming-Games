'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@brainstorming/ui';
import { GOOGLE_CLIENT_ID } from '@/lib/config';
import { getRepo } from '@/lib/data';

interface GoogleId {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean; use_fedcm_for_prompt?: boolean }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleId;
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Google sign-in could not load'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
    </svg>
  );
}

/**
 * "Continue with Google" and "Continue with Apple". The same Google or Apple account always opens
 * the same Brainstorming account.
 *
 *   Google  with NEXT_PUBLIC_GOOGLE_CLIENT_ID: Google's own button. Its signed ID token goes to
 *           the data layer (on the live site Supabase verifies it), so it works on every build.
 *   Apple   through Supabase on the live site (Apple only signs in on registered https domains).
 */
export function SocialSignIn({ next, disabled, onSignedIn, onError }: { next?: string; disabled?: boolean; onSignedIn: () => void; onError: (message: string) => void }) {
  const t = useTranslations('auth');
  const googleBox = useRef<HTMLDivElement>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const handlers = useRef({ onSignedIn, onError });
  handlers.current = { onSignedIn, onError };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleBox.current) return;
    let live = true;
    void loadGis()
      .then(() => {
        if (!live || !window.google || !googleBox.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'popup',
          use_fedcm_for_prompt: true,
          callback: (r) => {
            setBusy('google');
            void getRepo()
              .then((repo) => repo.auth.signInWithGoogleIdToken(r.credential))
              .then(() => handlers.current.onSignedIn())
              .catch((err: unknown) => handlers.current.onError(err instanceof Error ? err.message : t('socialFailed')))
              .finally(() => setBusy(null));
          },
        });
        // Google's own button, dressed to match the site: dark on the dark theme, rounded like our
        // buttons and as wide as the other sign-in options (Google allows 200 to 400 px).
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        const width = Math.round(Math.min(400, Math.max(200, googleBox.current.parentElement?.clientWidth ?? 320)));
        window.google.accounts.id.renderButton(googleBox.current, {
          type: 'standard',
          theme: light ? 'outline' : 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
        });
        setGoogleReady(true);
      })
      .catch(() => setGoogleReady(false));
    return () => {
      live = false;
    };
  }, [t]);

  const viaProvider = async (provider: 'google' | 'apple') => {
    setBusy(provider);
    try {
      const repo = await getRepo();
      await repo.auth.signInWithProvider(provider, next);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('socialFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="social-sign-in">
      {GOOGLE_CLIENT_ID ? (
        <div className="flex min-h-11 w-full items-center justify-center overflow-hidden rounded-full" data-testid="google-button">
          <div ref={googleBox} aria-label={t('google')} className="flex justify-center [color-scheme:normal]" />
          {!googleReady ? <span className="text-sm text-fg-muted">{t('googleLoading')}</span> : null}
        </div>
      ) : (
        <Button variant="outline" size="lg" disabled={disabled || busy != null} loading={busy === 'google'} icon={<GoogleMark />} onClick={() => void viaProvider('google')} data-testid="google-fallback">
          {t('google')}
        </Button>
      )}
      {/* Apple sign-in needs a paid Apple Developer account: switched on later. */}
      <Button variant="outline" size="lg" disabled icon={<AppleMark />} data-testid="apple-button" aria-describedby="apple-soon">
        {t('apple')}
        <span id="apple-soon" className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-[0.7rem] font-extrabold tracking-wide text-fg-muted uppercase">
          {t('comingSoon')}
        </span>
      </Button>
    </div>
  );
}
