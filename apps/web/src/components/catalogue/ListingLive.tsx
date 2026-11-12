'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Spinner, buttonClass, chipClass } from '@brainstorming/ui';
import { AdSlot } from '@/components/ads/AdSlot';
import { Link } from '@/i18n/navigation';
import { getCategory, tagLabel } from '@/lib/catalogue/categories';
import { LIMITS } from '@/lib/config';
import { getRepo } from '@/lib/data';
import { onTopic } from '@/lib/data/bus';
import type { GameQuery, GameSummary, SortOrder } from '@/lib/data/types';
import { usePrefs } from '@/lib/prefs';
import { GameTile } from './GameTile';

export type ListingKind = 'category' | 'tag' | 'new' | 'trending' | 'updated' | 'originals' | 'multiplayer';

const PAGE_SIZE = 48;

const BASE: Record<ListingKind, (slug: string) => GameQuery> = {
  category: (slug) => ({ category: slug, sort: 'popular' }),
  tag: (slug) => ({ tag: slug, sort: 'popular' }),
  new: () => ({ sort: 'new' }),
  trending: () => ({ sort: 'trending' }),
  updated: () => ({ sort: 'updated' }),
  originals: () => ({ originals: true, sort: 'popular' }),
  multiplayer: () => ({ multiplayer: true, sort: 'popular' }),
};

/** Listings whose order is the point of the page do not offer a sort control. */
const FIXED_SORT: ListingKind[] = ['new', 'trending', 'updated'];

type FilterKey = 'multiplayer' | 'mobile' | 'under10mb' | 'new';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'multiplayer', label: 'filterMultiplayer' },
  { key: 'mobile', label: 'filterMobile' },
  { key: 'under10mb', label: 'filterUnder10mb' },
  { key: 'new', label: 'filterNew' },
];
const SORTS: { key: SortOrder; label: string }[] = [
  { key: 'popular', label: 'sortPopular' },
  { key: 'new', label: 'sortNew' },
  { key: 'rating', label: 'sortRating' },
];

export interface ListingLiveProps {
  kind: ListingKind;
  /** Category or tag slug. */
  slug?: string;
  /** First page, pre-rendered at build time. */
  initial: GameSummary[];
  initialTotal?: number;
  /** Intro paragraph for category pages, rendered on the server. */
  intro?: string;
}

/** A titled grid with filter chips, sort and infinite scrolling. */
export function ListingLive({ kind, slug = '', initial, initialTotal, intro: introProp }: ListingLiveProps) {
  const t = useTranslations('listing');
  const tc = useTranslations('categories');
  const te = useTranslations('empty');
  const { schoolSafe } = usePrefs();
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    multiplayer: false,
    mobile: false,
    under10mb: false,
    new: false,
  });
  const base = useMemo(() => BASE[kind](slug), [kind, slug]);
  const [sort, setSort] = useState<SortOrder>(base.sort ?? 'popular');
  const [items, setItems] = useState<GameSummary[]>(initial);
  const [total, setTotal] = useState<number | null>(initialTotal ?? null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);

  const query = useMemo<GameQuery>(
    () => ({
      ...base,
      sort,
      ...(filters.multiplayer ? { multiplayer: true } : {}),
      ...(filters.mobile ? { mobile: true } : {}),
      ...(filters.under10mb ? { maxSize: LIMITS.under10Mb } : {}),
      ...(filters.new ? { newWithinDays: 30 } : {}),
      ...(schoolSafe ? { schoolSafeOnly: true } : {}),
    }),
    [base, sort, filters, schoolSafe],
  );

  const load = useCallback(
    async (offset: number) => {
      const id = ++request.current;
      setLoading(true);
      try {
        const repo = await getRepo();
        const page = await repo.catalogue.list({ ...query, offset, limit: PAGE_SIZE });
        if (request.current !== id) return;
        setItems((prev) => {
          if (offset === 0) return page.items;
          const seen = new Set(prev.map((g) => g.id));
          return [...prev, ...page.items.filter((g) => !seen.has(g.id))];
        });
        setTotal(page.total);
        setDone(page.items.length < PAGE_SIZE);
      } catch {
        // Keep whatever is on screen (the pre-rendered page) if the live query fails.
        if (request.current === id) setDone(true);
      } finally {
        if (request.current === id) {
          setLoading(false);
          setSettled(true);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    void load(0);
    return onTopic('catalogue', () => void load(0));
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && settled) void load(items.length);
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [done, loading, settled, items.length, load]);

  const anyFilter = Object.values(filters).some(Boolean);
  const category = kind === 'category' ? getCategory(slug) : undefined;
  const name = kind === 'category' ? (category ? tc(`${slug}.name`) : tagLabel(slug)) : tagLabel(slug);
  const title =
    kind === 'category' ? t('tagHeading', { name }) : kind === 'tag' ? t('tagHeading', { name }) : t(`pages.${kind}.title`);
  const intro =
    kind === 'category'
      ? (introProp ?? '')
      : kind === 'tag'
        ? t('tagIntro', { name })
        : t(`pages.${kind}.intro`);
  const showSort = !FIXED_SORT.includes(kind);
  const count = total ?? items.length;

  return (
    <div className="page" data-testid="listing">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {intro ? <p className="mt-2 text-fg-muted">{intro}</p> : null}
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2" data-testid="listing-controls">
        <div role="group" aria-label={t('filters')} className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filters[f.key]}
              onClick={() => setFilters((s) => ({ ...s, [f.key]: !s[f.key] }))}
              className={chipClass(filters[f.key])}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
        {showSort ? (
          <label className="ml-auto flex items-center gap-2 text-sm font-bold">
            <span className="text-fg-muted">{t('sort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOrder)}
              className="h-9 rounded-full border border-border bg-surface px-3 text-sm font-semibold text-fg"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <p className="mt-3 text-sm font-semibold text-fg-muted" aria-live="polite" data-testid="listing-count">
        {t('count', { count })}
      </p>

      {items.length === 0 ? (
        settled || initial.length === 0 ? (
          anyFilter ? (
            <EmptyState
              className="mt-4"
              title={te('filteredTitle')}
              description={te('filteredBody')}
              action={
                <button
                  type="button"
                  className={buttonClass({ variant: 'outline' })}
                  onClick={() => setFilters({ multiplayer: false, mobile: false, under10mb: false, new: false })}
                >
                  {te('clearFilters')}
                </button>
              }
            />
          ) : (
            <EmptyState
              className="mt-4"
              title={te('gamesTitle')}
              description={te('gamesBody')}
              action={
                <Link href="/developers" className={buttonClass({})}>
                  {te('gamesCta')}
                </Link>
              }
            />
          )
        ) : null
      ) : (
        <ul className="game-grid mt-4">
          {items.map((game, i) => (
            <Fragment key={game.id}>
              {i > 0 && i % LIMITS.adGridInterval === 0 ? (
                <li className="col-span-full">
                  <AdSlot placement="grid" />
                </li>
              ) : null}
              <li>
                <GameTile game={game} priority={i < 6} />
              </li>
            </Fragment>
          ))}
        </ul>
      )}

      <div ref={sentinel} className="flex h-16 items-center justify-center" aria-hidden={!loading}>
        {loading && items.length > 0 ? (
          <span className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner /> {t('loadingMore')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
