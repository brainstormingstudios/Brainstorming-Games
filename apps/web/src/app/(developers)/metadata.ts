import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { initLocale, type RouteParams } from '@/i18n/server';
import { SITE_NAME } from '@/lib/config';

/** Every developer-portal page is private: never indexed. */
export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'dev' });
  return { title: { absolute: `${t('metaTitle')} – ${SITE_NAME}` }, robots: { index: false, follow: false } };
}
