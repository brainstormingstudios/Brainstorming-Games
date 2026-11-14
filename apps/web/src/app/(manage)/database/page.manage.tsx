import { Suspense } from 'react';
import { AdminShell } from '@/components/admin/Admin';
import { DatabasePage } from '@/components/admin/Site';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(manage)/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <AdminShell>
      <Suspense fallback={<PageSkeleton />}>
        <DatabasePage />
      </Suspense>
    </AdminShell>
  );
}
