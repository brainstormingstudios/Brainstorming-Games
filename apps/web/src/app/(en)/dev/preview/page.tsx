import { Suspense } from 'react';
import { PreviewPage } from '@/components/dev/PreviewPage';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(en)/dev/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <div className="page">
      <Suspense fallback={<PageSkeleton />}>
        <PreviewPage />
      </Suspense>
    </div>
  );
}
