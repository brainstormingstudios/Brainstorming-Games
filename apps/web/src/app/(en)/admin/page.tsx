import { Suspense } from 'react';
import { AdminShell, AdminOverview } from '@/components/admin/Admin';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(en)/admin/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <AdminShell>
      <Suspense fallback={<PageSkeleton />}>
        <AdminOverview />
      </Suspense>
    </AdminShell>
  );
}
