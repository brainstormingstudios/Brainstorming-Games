import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LoginPage } from '@/components/auth/LoginPage';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return pageMetadata({ locale, path: '/login', title: t('logIn'), noindex: true });
}

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <div className="page">
      <Suspense fallback={<PageSkeleton />}>
        <LoginPage />
      </Suspense>
    </div>
  );
}
