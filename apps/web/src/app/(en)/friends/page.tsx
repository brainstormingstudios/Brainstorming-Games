import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { FriendsPage } from '@/components/player/Social';
import { AllMessages } from '@/components/shell/AllMessages';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'friends' });
  return pageMetadata({ locale, path: '/friends', title: t('metaTitle').trim(), noindex: true });
}

export default async function Page({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  return (
    <AllMessages locale={locale}>
      <div className="page">
        <Suspense fallback={<PageSkeleton />}>
          <FriendsPage />
        </Suspense>
      </div>
    </AllMessages>
  );
}
