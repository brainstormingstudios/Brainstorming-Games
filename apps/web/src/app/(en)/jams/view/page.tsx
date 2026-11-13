import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { JamPage } from '@/components/growth/Public';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

// One page serves every jam (`?slug=`), so jams created after a build work straight away.
export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'growth' });
  return pageMetadata({ locale, path: '/jams/view', title: t('jamsTitle'), noindex: true });
}

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JamPage />
    </Suspense>
  );
}
