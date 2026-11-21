import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CreatorDashboard } from '@/components/creators/CreatorDashboard';
import { AllMessages } from '@/components/shell/AllMessages';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'creators.dashboard' });
  return { ...pageMetadata({ locale, path: '/creators/dashboard', title: t('metaTitle') }), robots: { index: false } };
}

export default async function Page({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  return (
    <AllMessages locale={locale}>
      <Suspense fallback={<PageSkeleton />}>
        <CreatorDashboard />
      </Suspense>
    </AllMessages>
  );
}
