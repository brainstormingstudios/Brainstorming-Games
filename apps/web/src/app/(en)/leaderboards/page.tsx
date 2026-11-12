import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LeaderboardsPage } from '@/components/player/Account';
import { AllMessages } from '@/components/shell/AllMessages';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'leaderboards' });
  return pageMetadata({ locale, path: '/leaderboards', title: t('metaTitle').trim(), noindex: false });
}

export default async function Page({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  return (
    <AllMessages locale={locale}>
      <div className="page">
        <Suspense fallback={<PageSkeleton />}>
          <LeaderboardsPage />
        </Suspense>
      </div>
    </AllMessages>
  );
}
