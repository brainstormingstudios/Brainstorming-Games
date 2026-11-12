import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { SearchResults } from '@/components/catalogue/SearchResults';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'search' });
  return pageMetadata({ locale, path: '/search', title: t('metaTitle'), noindex: true });
}

export default async function SearchPage({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SearchResults />
    </Suspense>
  );
}
