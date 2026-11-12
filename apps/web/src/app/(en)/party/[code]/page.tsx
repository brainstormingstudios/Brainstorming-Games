import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PartyRoom } from '@/components/player/Social';
import { AllMessages } from '@/components/shell/AllMessages';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

/** One shell page; the code is read from the URL in the browser (see _redirects). */
export function generateStaticParams() {
  return [{ code: '_' }];
}

export async function generateMetadata({ params }: { params: RouteParams<{ code: string }> }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'party' });
  return pageMetadata({ locale, path: '/party', title: t('metaTitle').trim(), noindex: true });
}

export default async function Page({ params }: { params: RouteParams<{ code: string }> }) {
  const { locale } = await initLocale(params);
  return (
    <AllMessages locale={locale}>
      <div className="page">
        <Suspense fallback={<PageSkeleton />}>
          <PartyRoom />
        </Suspense>
      </div>
    </AllMessages>
  );
}
