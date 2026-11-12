import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MascotAvatar } from '@brainstorming/ui';
import { ReloadButton } from '@/components/shell/ReloadButton';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'offline' });
  return pageMetadata({ locale, path: '/offline', title: t('metaTitle'), noindex: true });
}

/** Shown by the service worker when a page load fails because there is no connection. */
export default async function OfflinePage({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'offline' });
  return (
    <div className="page">
      <div className="mx-auto flex max-w-md flex-col items-center py-14 text-center">
        <MascotAvatar size={160} mood="sad" animated />
        <h1 className="mt-4 text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-fg-muted">{t('body')}</p>
        <ReloadButton label={t('retry')} />
      </div>
    </div>
  );
}
