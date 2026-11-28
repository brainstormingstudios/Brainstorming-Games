import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { SitePageView } from '@/components/shell/SitePageView';
import { AllMessages } from '@/components/shell/AllMessages';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { SITE_NAME } from '@/lib/config';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'page' });
  void t;
  return { ...pageMetadata({ locale, path: '/page', title: SITE_NAME, description: SITE_NAME }), robots: { index: false, follow: true } };
}

export default async function Page({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  return (
    <AllMessages locale={locale}>
      <Suspense fallback={<PageSkeleton />}>
        <SitePageView />
      </Suspense>
    </AllMessages>
  );
}
