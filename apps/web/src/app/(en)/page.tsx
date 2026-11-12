import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HomeView } from '@/components/catalogue/HomeView';
import { initLocale, type RouteParams } from '@/i18n/server';
import { buildRails, sortGames } from '@/lib/catalogue/listings';
import { snapshotConfig, snapshotGeneratedAt, snapshotSummaries } from '@/lib/catalogue/snapshot';
import { SITE_NAME, SITE_URL } from '@/lib/config';
import type { GameSummary } from '@/lib/data/types';
import { jsonLd, pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale });
  return pageMetadata({
    locale,
    path: '/',
    title: t('home.metaTitle'),
    description: t('meta.siteDescription'),
    absoluteTitle: true,
  });
}

export default async function HomePage({ params }: { params: RouteParams }) {
  await initLocale(params);
  const all = snapshotSummaries();
  const config = snapshotConfig();
  // The rotation seed changes with each day's build, so Spark games take turns.
  const seed = snapshotGeneratedAt.slice(0, 10);
  const rails = buildRails(all, config, { seed });

  // Send the client only the games that are actually on the page.
  const onPage = new Map<string, GameSummary>();
  for (const rail of rails) for (const g of rail.games) onPage.set(g.id, g);
  const byId = new Map(all.map((g) => [g.id, g]));
  for (const id of config.heroGameIds) {
    const g = byId.get(id);
    if (g) onPage.set(g.id, g);
  }
  for (const g of sortGames(all, 'trending').slice(0, 3)) onPage.set(g.id, g);

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(website) }} />
      <HomeView initialGames={[...onPage.values()]} config={config} seed={seed} />
    </>
  );
}
