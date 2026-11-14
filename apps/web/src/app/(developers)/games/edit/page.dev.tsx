import { Suspense } from 'react';
import { DevShell } from '@/components/dev/DevShell';
import { GameWizard } from '@/components/dev/GameWizard';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(developers)/metadata';

export default async function Page({ params }: { params: RouteParams }) {
  await initLocale(params);
  return (
    <DevShell>
      <Suspense fallback={<PageSkeleton />}>
        <GameWizard />
      </Suspense>
    </DevShell>
  );
}
