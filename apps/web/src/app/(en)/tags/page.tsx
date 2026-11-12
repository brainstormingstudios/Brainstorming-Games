import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TagsLive } from '@/components/catalogue/TagsLive';
import { initLocale, type RouteParams } from '@/i18n/server';
import { collectTags } from '@/lib/catalogue/listings';
import { snapshotSummaries } from '@/lib/catalogue/snapshot';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'listing' });
  return pageMetadata({ locale, path: '/tags', title: t('tagsTitle'), description: t('tagsIntro') });
}

export default async function TagsPage({ params }: { params: RouteParams }) {
  await initLocale(params);
  return <TagsLive initial={collectTags(snapshotSummaries())} />;
}
