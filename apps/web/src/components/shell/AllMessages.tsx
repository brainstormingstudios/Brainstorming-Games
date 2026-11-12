import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';

/**
 * Gives client components every message namespace. Used by the developer portal and the admin
 * console, which are not indexed and need far more strings than player pages.
 */
export async function AllMessages({ locale, children }: { locale: Locale; children: ReactNode }) {
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
