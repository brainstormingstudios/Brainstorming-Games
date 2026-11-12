import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GameLive } from '@/components/game/GameLive';
import { localizePath } from '@/i18n/config';
import { initLocale, type RouteParams } from '@/i18n/server';
import { getCategory } from '@/lib/catalogue/categories';
import { relatedGames } from '@/lib/catalogue/listings';
import { snapshotGame, snapshotGames, snapshotSummaries } from '@/lib/catalogue/snapshot';
import { SITE_NAME } from '@/lib/config';
import { absoluteUrl, jsonLd, pageMetadata } from '@/lib/seo';

type Params = RouteParams<{ slug: string }>;

/** `_` is a shell for games that are not in this build; it resolves the game in the browser. */
export function generateStaticParams() {
  return [...snapshotGames().map((g) => ({ slug: g.slug })), { slug: '_' }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await initLocale(params);
  const game = snapshotGame(slug);
  if (!game) return { title: { absolute: SITE_NAME }, robots: { index: false, follow: true } };
  const t = await getTranslations({ locale, namespace: 'game' });
  return pageMetadata({
    locale,
    path: `/game/${game.slug}`,
    title: t('metaTitle', { title: game.title }),
    description: t('metaDescription', { title: game.title, description: game.shortDescription }).trim(),
    image: `/og/game/${game.slug}/image.png`,
  });
}

export default async function GamePage({ params }: { params: Params }) {
  const { locale, slug } = await initLocale(params);
  const game = snapshotGame(slug);
  if (!game) return <GameLive slug={slug} initial={null} related={null} />;

  const t = await getTranslations({ locale });
  const category = getCategory(game.category);
  const url = absoluteUrl(localizePath(`/game/${game.slug}`, locale));
  const structured: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: game.title,
      description: game.shortDescription,
      url,
      image: game.cover?.url,
      genre: category ? t(`categories.${category.slug}.name`) : game.category,
      gamePlatform: ['Web browser', ...game.platforms],
      applicationCategory: 'Game',
      operatingSystem: 'Any',
      playMode: game.isMultiplayer ? 'MultiPlayer' : 'SinglePlayer',
      datePublished: game.releasedAt ?? undefined,
      dateModified: game.updatedAt,
      author: { '@type': 'Organization', name: game.studio.name },
      publisher: { '@type': 'Organization', name: SITE_NAME },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      ...(game.stats.rating10 != null && game.stats.votes > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: game.stats.rating10,
              bestRating: 10,
              worstRating: 0,
              ratingCount: game.stats.votes,
            },
          }
        : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('nav.home'), item: absoluteUrl(localizePath('/', locale)) },
        ...(category
          ? [
              {
                '@type': 'ListItem',
                position: 2,
                name: t(`categories.${category.slug}.name`),
                item: absoluteUrl(localizePath(`/c/${category.slug}`, locale)),
              },
            ]
          : []),
        { '@type': 'ListItem', position: category ? 3 : 2, name: game.title, item: url },
      ],
    },
  ];
  if (game.faq.length > 0) {
    structured.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: game.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return (
    <>
      {structured.map((data, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      ))}
      <GameLive slug={game.slug} initial={game} related={relatedGames(game, snapshotSummaries())} />
    </>
  );
}
