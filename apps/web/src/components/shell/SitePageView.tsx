'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { EmptyState, Skeleton, buttonClass } from '@brainstorming/ui';
import { Markdown } from '@/lib/domain/markdown';
import { Link } from '@/i18n/navigation';
import { SITE_NAME } from '@/lib/config';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

/** A page written in the management portal (Pages), at /page/?s=<address>. */
export function SitePageView() {
  const t = useTranslations('page');
  const slug = (useSearchParams().get('s') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const page = useRepoQuery((repo) => (slug ? repo.growth.page(slug) : Promise.resolve(null)), [slug]);
  useEffect(() => {
    if (page.data) document.title = `${page.data.title} – ${SITE_NAME}`;
  }, [page.data]);
  if (page.loading && page.data === undefined) return <div className="page"><Skeleton className="h-96 w-full" /></div>;
  if (!page.data) {
    return (
      <div className="page">
        <EmptyState title={t('notFound')} action={<Link href="/" className={buttonClass({})}>{t('back')}</Link>} />
      </div>
    );
  }
  return (
    <article className="page max-w-3xl!" data-testid="site-page">
      <h1 className="text-3xl font-bold sm:text-4xl">{page.data.title}</h1>
      <div className="prose-bg mt-4">
        <Markdown source={page.data.bodyMd} baseHeading={2} />
      </div>
    </article>
  );
}
