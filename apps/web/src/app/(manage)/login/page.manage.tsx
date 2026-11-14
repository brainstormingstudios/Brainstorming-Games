import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginPage } from '@/components/auth/LoginPage';
import { PageSkeleton } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';

export const metadata: Metadata = { title: 'Log in', robots: { index: false, follow: false } };

/** Where the e-mailed sign-in link lands on this site. */
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
