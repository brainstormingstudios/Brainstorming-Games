import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RootShell } from '@/components/shell/RootShell';
import { isLocale, prefixedLocales } from '@/i18n/config';
import { initLocale, type RouteParams } from '@/i18n/server';

export { generateMetadata } from '@/app/(en)/layout';

/** One static tree per prefixed locale (`/hi/...`). English lives un-prefixed in `(en)`. */
export function generateStaticParams() {
  return prefixedLocales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export default async function PrefixedLocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: RouteParams;
}) {
  const raw = await params;
  if (!isLocale(raw.locale) || !(prefixedLocales as string[]).includes(raw.locale)) notFound();
  const { locale } = await initLocale(params);
  return <RootShell locale={locale}>{children}</RootShell>;
}
