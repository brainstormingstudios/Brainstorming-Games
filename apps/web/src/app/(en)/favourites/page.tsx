import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SavedGames } from '@/components/catalogue/SavedGames';
import { initLocale, type RouteParams } from '@/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'listing' });
  return pageMetadata({ locale, path: '/favourites', title: t('pages.favourites.title'), noindex: true });
}

export default async function FavouritesPage({ params }: { params: RouteParams }) {
  await initLocale(params);
  return <SavedGames kind="favourites" />;
}
