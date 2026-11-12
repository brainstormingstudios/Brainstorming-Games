import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ListingLive } from '@/components/catalogue/ListingLive';
import { initLocale, type RouteParams } from '@/i18n/server';
import { tagLabel } from '@/lib/catalogue/categories';
import { applyQuery, collectTags } from '@/lib/catalogue/listings';
import { snapshotSummaries } from '@/lib/catalogue/snapshot';
import { SITE_NAME } from '@/lib/config';
import { pageMetadata } from '@/lib/seo';

type Params = RouteParams<{ tag: string }>;

/** One page per tag in use. `_` is the shell for tags that appear after this build. */
export function generateStaticParams() {
  return [...collectTags(snapshotSummaries()).map((t) => ({ tag: t.tag })), { tag: '_' }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, tag } = await initLocale(params);
  if (tag === '_') return { title: { absolute: SITE_NAME }, robots: { index: false, follow: true } };
  const t = await getTranslations({ locale, namespace: 'listing' });
  const name = tagLabel(tag);
  return pageMetadata({
    locale,
    path: `/t/${tag}`,
    title: t('tagMetaTitle', { name }),
    description: t('tagIntro', { name }),
  });
}

export default async function TagPage({ params }: { params: Params }) {
  const { tag } = await initLocale(params);
  const page = applyQuery(snapshotSummaries(), { tag, sort: 'popular', limit: 48 });
  return <ListingLive kind="tag" slug={tag} initial={page.items} initialTotal={page.total ?? undefined} />;
}
