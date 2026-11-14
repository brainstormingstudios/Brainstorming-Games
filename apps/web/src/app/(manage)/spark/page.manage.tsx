import { Suspense } from 'react';
import { AdminShell, SparkDecisions } from '@/components/admin/Admin';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(manage)/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <AdminShell>
      <Suspense fallback={<PageSkeleton />}>
        <SparkDecisions />
      </Suspense>
    </AdminShell>
  );
}
