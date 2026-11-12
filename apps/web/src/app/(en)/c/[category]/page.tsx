import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ListingLive } from '@/components/catalogue/ListingLive';
import { initLocale, type RouteParams } from '@/i18n/server';
import { CATEGORY_SLUGS, getCategory } from '@/lib/catalogue/categories';
import { applyQuery } from '@/lib/catalogue/listings';
import { snapshotSummaries } from '@/lib/catalogue/snapshot';
import { pageMetadata } from '@/lib/seo';

type Params = RouteParams<{ category: string }>;

export function generateStaticParams() {
  return CATEGORY_SLUGS.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, category } = await initLocale(params);
  if (!getCategory(category)) return {};
  const t = await getTranslations({ locale });
  return pageMetadata({
    locale,
    path: `/c/${category}`,
    title: t('listing.categoryMetaTitle', { name: t(`categories.${category}.name`) }),
    description: t(`categories.${category}.intro`),
  });
}

export default async function CategoryPage({ params }: { params: Params }) {
  const { locale, category } = await initLocale(params);
  if (!getCategory(category)) notFound();
  const t = await getTranslations({ locale, namespace: 'categories' });
  const page = applyQuery(snapshotSummaries(), { category, sort: 'popular', limit: 48 });
  return (
    <ListingLive
      kind="category"
      slug={category}
      intro={t(`${category}.intro`)}
      initial={page.items}
      initialTotal={page.total ?? undefined}
    />
  );
}
