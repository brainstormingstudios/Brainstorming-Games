import type { Metadata } from 'next';
import { AllMessages } from '@/components/shell/AllMessages';
import { ClientFallback } from '@/components/shell/ClientFallback';
import { initLocale, type RouteParams } from '@/i18n/server';
import { SITE_NAME } from '@/lib/config';

export const metadata: Metadata = {
  title: { absolute: SITE_NAME },
  robots: { index: false, follow: true },
};

/**
 * Exported as /fallback/ and copied over 404.html by the post-build step. Static hosting serves
 * it for any path that has no file, and it works out in the browser what that path should show.
 */
export default async function FallbackPage({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  return (
    <AllMessages locale={locale}>
      <ClientFallback />
    </AllMessages>
  );
}
