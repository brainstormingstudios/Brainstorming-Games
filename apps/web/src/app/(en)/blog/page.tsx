import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { BlogPage } from '@/components/growth/Public';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'growth' });
  return pageMetadata({ locale, path: '/blog', title: t('blogTitle'), description: t('blogIntro') });
}

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BlogPage />
    </Suspense>
  );
}
