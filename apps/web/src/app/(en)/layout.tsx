import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { RootShell } from '@/components/shell/RootShell';
import { initLocale, type RouteParams } from '@/i18n/server';
import { SITE_NAME, SITE_URL } from '@/lib/config';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: SITE_NAME, template: `%s – ${SITE_NAME}` },
    description: t('siteDescription'),
    applicationName: SITE_NAME,
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/brand/favicon.ico', sizes: '48x48' },
        { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
        { url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
    },
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'black-translucent' },
    formatDetection: { telephone: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: RouteParams;
}) {
  const { locale } = await initLocale(params);
  return <RootShell locale={locale}>{children}</RootShell>;
}
