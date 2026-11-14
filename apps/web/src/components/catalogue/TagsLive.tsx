'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { EmptyState, buttonClass, chipClass } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { tagLabel } from '@/lib/catalogue/categories';
import { collectTags } from '@/lib/catalogue/listings';
import { PRERENDERED_UNTIL } from '@/lib/config';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

export function TagsLive({ initial }: { initial: { tag: string; count: number }[] }) {
  const t = useTranslations('listing');
  const te = useTranslations('empty');
  // Tags from games published since the build are added on top of the pre-rendered counts.
  const { data } = useRepoQuery((repo) => repo.catalogue.list({ changedSince: PRERENDERED_UNTIL }), [], {
    topics: ['catalogue'],
  });
  const tags = useMemo(() => {
    const counts = new Map(initial.map((x) => [x.tag, x.count]));
    for (const extra of collectTags(data?.items ?? [])) {
      counts.set(extra.tag, Math.max(counts.get(extra.tag) ?? 0, extra.count));
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [initial, data]);
  const prebuilt = useMemo(() => new Set(initial.map((x) => x.tag)), [initial]);
  return (
    <div className="page" data-testid="tags-page">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold sm:text-4xl">{t('tagsTitle')}</h1>
        <p className="mt-2 text-fg-muted">{t('tagsIntro')}</p>
      </header>
      {tags.length === 0 ? (
        <EmptyState
          className="mt-5"
          title={t('tagsEmptyTitle')}
          description={`${t('tagsEmptyBody')} ${te('gamesBody')}`}
          action={
            <Link href="/developers" className={buttonClass({})}>
              {te('gamesCta')}
            </Link>
          }
        />
      ) : (
        <ul className="mt-5 flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              <Link href={`/t/${tag}`} hard={!prebuilt.has(tag)} className={chipClass(false)}>
                {tagLabel(tag)}
                <span className="text-xs text-fg-muted">
                  <span className="sr-only">: </span>
                  {t('tagCount', { count })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
