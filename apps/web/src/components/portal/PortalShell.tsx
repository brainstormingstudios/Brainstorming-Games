import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { fontClasses } from '@/app/fonts';
import { defaultLocale } from '@/i18n/config';
import { PREFS_BOOT_SCRIPT } from '@/lib/prefsBoot';
import { PortalFrame, type PortalKind } from './PortalFrame';

/**
 * <html>, fonts and providers for the developer portal and the management portal. Both are
 * English, signed-in tools, so they get every message namespace up front.
 */
export async function PortalShell({ kind, children }: { kind: PortalKind; children: ReactNode }) {
  setRequestLocale(defaultLocale);
  const messages = await getMessages({ locale: defaultLocale });
  const t = await getTranslations({ locale: defaultLocale, namespace: 'common' });
  return (
    <html lang="en" data-theme="dark" className={fontClasses} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0d0e10" />
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={defaultLocale} messages={messages}>
          <PortalFrame kind={kind} dismissLabel={t('dismiss')}>
            {children}
          </PortalFrame>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
