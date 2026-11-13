import { Suspense } from 'react';
import { AdminShell } from '@/components/admin/Admin';
import { ProgressionEditor } from '@/components/admin/Growth';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(en)/admin/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <AdminShell>
      <Suspense fallback={<PageSkeleton />}>
        <ProgressionEditor />
      </Suspense>
    </AdminShell>
  );
}
