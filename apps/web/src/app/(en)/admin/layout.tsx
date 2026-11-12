import type { ReactNode } from 'react';
import { AllMessages } from '@/components/shell/AllMessages';
import { initLocale, type RouteParams } from '@/i18n/server';

export default async function AdminLayout({ children, params }: { children: ReactNode; params: RouteParams }) {
  const { locale } = await initLocale(params);
  return <AllMessages locale={locale}>{children}</AllMessages>;
}
