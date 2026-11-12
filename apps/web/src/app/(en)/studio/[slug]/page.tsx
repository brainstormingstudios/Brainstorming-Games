import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StudioLive } from '@/components/catalogue/StudioLive';
import { initLocale, type RouteParams } from '@/i18n/server';
import { applyQuery } from '@/lib/catalogue/listings';
import { snapshotStudio, snapshotStudios, snapshotSummaries } from '@/lib/catalogue/snapshot';
import { SITE_NAME } from '@/lib/config';
import { pageMetadata } from '@/lib/seo';

type Params = RouteParams<{ slug: string }>;

export function generateStaticParams() {
  return [...snapshotStudios().map((s) => ({ slug: s.slug })), { slug: '_' }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await initLocale(params);
  const studio = snapshotStudio(slug);
  if (!studio) return { title: { absolute: SITE_NAME }, robots: { index: false, follow: true } };
  const t = await getTranslations({ locale, namespace: 'studio' });
  return pageMetadata({
    locale,
    path: `/studio/${studio.slug}`,
    title: t('metaTitle', { name: studio.name }),
    description: studio.bio || undefined,
  });
}

export default async function StudioPage({ params }: { params: Params }) {
  const { slug } = await initLocale(params);
  const studio = snapshotStudio(slug);
  const games = studio ? applyQuery(snapshotSummaries(), { studioSlug: slug, sort: 'popular' }).items : [];
  return <StudioLive slug={slug} initial={studio} initialGames={games} />;
}
