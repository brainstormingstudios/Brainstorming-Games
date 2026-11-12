import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { balooDeva, fredoka, nunito } from '@/app/fonts';
import { localeTags, type Locale } from '@/i18n/config';
import { PREFS_BOOT_SCRIPT } from '@/lib/prefsBoot';
import { Footer } from './Footer';
import { Header } from './Header';
import { Providers } from './Providers';
import { BottomTabs, Sidebar } from './Sidebar';

/**
 * Message namespaces every page's client components may use. Large, rarely needed namespaces
 * (developer portal, admin) are provided by their own layouts instead.
 */
const CLIENT_NAMESPACES = [
  'common',
  'shell',
  'nav',
  'categories',
  'home',
  'empty',
  'listing',
  'search',
  'game',
  'studio',
  'notFound',
  'ads',
  'auth',
] as const;

function pick(messages: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in messages) out[k] = messages[k];
  // Category intros are long and only shown on their own page, which passes them as a prop.
  const categories = out.categories as Record<string, { name: string }> | undefined;
  if (categories) {
    out.categories = Object.fromEntries(Object.entries(categories).map(([slug, c]) => [slug, { name: c.name }]));
  }
  return out;
}

/** <html>, fonts, providers and the site chrome for one locale. */
export async function RootShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const messages = (await getMessages({ locale })) as Record<string, unknown>;
  const t = await getTranslations({ locale, namespace: 'common' });
  const fonts = [fredoka.variable, nunito.variable, locale === 'hi' ? balooDeva.variable : ''].join(' ');
  return (
    <html lang={localeTags[locale]} data-theme="dark" className={fonts} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0c2a6e" />
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={pick(messages, CLIENT_NAMESPACES)}>
          <Providers dismissLabel={t('dismiss')}>
            <a href="#main" className="skip-link">
              {t('skipToContent')}
            </a>
            <Header />
            <Sidebar />
            <div className="app-content">
              <main id="main" tabIndex={-1} className="min-h-[70dvh] outline-none">
                {children}
              </main>
              <Footer />
            </div>
            <BottomTabs />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
