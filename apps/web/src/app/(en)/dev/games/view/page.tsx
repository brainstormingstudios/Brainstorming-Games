import { Suspense } from 'react';
import { DevShell } from '@/components/dev/DevShell';
import { GameManage } from '@/components/dev/GameManage';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(en)/dev/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <DevShell>
      <Suspense fallback={<PageSkeleton />}>
        <GameManage />
      </Suspense>
    </DevShell>
  );
}
