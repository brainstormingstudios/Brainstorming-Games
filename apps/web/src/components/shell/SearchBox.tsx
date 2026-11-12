'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@brainstorming/ui';
import { localizePath } from '@/i18n/config';
import { useLocale } from '@/i18n/navigation';
import { GameCover } from '@/components/catalogue/GameCover';
import { isPrebuilt } from '@/components/catalogue/GameTile';
import { getRepo } from '@/lib/data';
import { onTopic } from '@/lib/data/bus';
import type { GameSummary } from '@/lib/data/types';
import { gameHref } from '@/lib/format';

const MAX_SUGGESTIONS = 6;
const INDEX_SIZE = 500;

/**
 * Header search with an instant dropdown (WAI-ARIA combobox). The first focus loads the most
 * popular games and Fuse.js searches them locally on every keystroke; on Supabase a debounced
 * full-text query fills in anything outside that set.
 */
export function SearchBox({ className }: { className?: string }) {
  const t = useTranslations('shell');
  const locale = useLocale();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [index, setIndex] = useState<GameSummary[] | null>(null);
  const [remote, setRemote] = useState<GameSummary[]>([]);
  const [local, setLocal] = useState<GameSummary[]>([]);
  const loading = useRef(false);

  const loadIndex = () => {
    if (index || loading.current) return;
    loading.current = true;
    void getRepo()
      .then((repo) => repo.catalogue.list({ sort: 'popular', limit: INDEX_SIZE }))
      .then((page) => setIndex(page.items))
      .catch(() => setIndex([]))
      .finally(() => {
        loading.current = false;
      });
  };

  // New games should be searchable without a reload.
  useEffect(() => onTopic('catalogue', () => setIndex(null)), []);

  // "/" focuses search from anywhere, unless the player is typing in a field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const q = query.trim();

  useEffect(() => {
    let cancelled = false;
    if (!q || !index) {
      setLocal([]);
      return;
    }
    void import('@/lib/catalogue/search').then(({ searchGames }) => {
      if (!cancelled) setLocal(searchGames(q, index));
    });
    return () => {
      cancelled = true;
    };
  }, [q, index]);

  useEffect(() => {
    if (q.length < 3) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void getRepo().then((repo) => {
        if (repo.mode !== 'supabase') return;
        repo.catalogue
          .search(q, MAX_SUGGESTIONS)
          .then((items) => !cancelled && setRemote(items))
          .catch(() => {});
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [q]);

  const results = useMemo(() => {
    const seen = new Set<string>();
    const out: GameSummary[] = [];
    for (const g of [...local, ...remote]) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }, [local, remote]);

  const showList = open && q.length > 0;
  // The last option is always "see all results".
  const optionCount = results.length + 1;

  const go = (href: string, hard = false) => {
    setOpen(false);
    inputRef.current?.blur();
    const target = localizePath(href, locale);
    if (hard) window.location.assign(target);
    else router.push(target);
  };
  const goSearch = () => q && go(`/search?q=${encodeURIComponent(q)}`);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) setOpen(false);
      else setQuery('');
      return;
    }
    if (!showList) {
      if (e.key === 'Enter') goSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % optionCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? optionCount - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const game = results[active];
      if (game) go(gameHref(game.slug), !isPrebuilt(game));
      else goSearch();
    }
  };

  return (
    <div ref={wrapRef} role="search" className={cn('relative min-w-0', className)}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        {t('searchLabel')}
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-fg-muted" />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={t('searchPlaceholder')}
        title={t('searchShortcut')}
        value={query}
        data-testid="search-input"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => {
          loadIndex();
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-control border border-border bg-surface-3 pr-9 pl-10 text-[0.95rem] font-semibold text-fg placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          aria-label={t('searchLabel') + ': ' + query + ' ✕'}
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-fg-muted hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-md border border-border px-1.5 text-xs font-bold text-fg-muted md:block"
        >
          /
        </kbd>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={t('searchLabel')}
        hidden={!showList}
        data-testid="search-results"
        className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[70dvh] animate-pop-in overflow-y-auto rounded-card border border-border bg-surface-3 p-1.5 shadow-card"
      >
        {results.map((game, i) => (
          // Keyboard selection is handled by the combobox input (aria-activedescendant pattern).
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li
            key={game.id}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={active === i}
            onPointerEnter={() => setActive(i)}
            onClick={() => go(gameHref(game.slug), !isPrebuilt(game))}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-control p-1.5',
              active === i && 'bg-surface-2',
            )}
          >
            <span className="block aspect-video w-20 shrink-0 overflow-hidden rounded-lg">
              <GameCover game={game} sizes="80px" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{game.title}</span>
              <span className="block truncate text-xs text-fg-muted">{game.studio.name}</span>
            </span>
          </li>
        ))}
        {results.length === 0 && index ? (
          <li role="presentation" className="px-3 py-2.5 text-sm text-fg-muted">
            {t('searchNoResults', { query: q })}
          </li>
        ) : null}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- see above */}
        <li
          id={`${listId}-opt-${results.length}`}
          role="option"
          aria-selected={active === results.length}
          onPointerEnter={() => setActive(results.length)}
          onClick={goSearch}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-control px-3 py-2.5 text-sm font-bold text-link',
            active === results.length && 'bg-surface-2',
          )}
        >
          <Search aria-hidden="true" className="size-4" />
          {t('searchSeeAll', { query: q })}
        </li>
      </ul>
    </div>
  );
}
