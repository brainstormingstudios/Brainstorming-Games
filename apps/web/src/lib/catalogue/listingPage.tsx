import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ListingLive, type ListingKind } from '@/components/catalogue/ListingLive';
import { initLocale, type RouteParams } from '@/i18n/server';
import { applyQuery } from '@/lib/catalogue/listings';
import { snapshotSummaries } from '@/lib/catalogue/snapshot';
import type { GameQuery } from '@/lib/data/types';
import { pageMetadata } from '@/lib/seo';

type FixedKind = Exclude<ListingKind, 'category' | 'tag'>;

const QUERIES: Record<FixedKind, GameQuery> = {
  new: { sort: 'new' },
  trending: { sort: 'trending' },
  updated: { sort: 'updated' },
  originals: { originals: true, sort: 'popular' },
  multiplayer: { multiplayer: true, sort: 'popular' },
};

/**
 * Builds the page and metadata for one of the fixed listings (/new, /trending, ...). Each route
 * file is two lines that call this, so the five pages cannot drift apart.
 */
export function createListingPage(kind: FixedKind) {
  async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
    const { locale } = await initLocale(params);
    const t = await getTranslations({ locale, namespace: 'listing' });
    return pageMetadata({
      locale,
      path: `/${kind}`,
      title: t(`pages.${kind}.title`),
      description: t(`pages.${kind}.intro`),
    });
  }
  async function Page({ params }: { params: RouteParams }) {
    await initLocale(params);
    const page = applyQuery(snapshotSummaries(), { ...QUERIES[kind], limit: 48 });
    return <ListingLive kind={kind} initial={page.items} initialTotal={page.total ?? undefined} />;
  }
  return { generateMetadata, Page };
}
