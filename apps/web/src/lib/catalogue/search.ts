import Fuse, { type IFuseOptions } from 'fuse.js';
import type { GameSummary } from '@/lib/data/types';
import { getCategory, tagLabel } from './categories';

/** A game plus the extra words it should be findable by. */
interface SearchDoc {
  game: GameSummary;
  title: string;
  tags: string;
  category: string;
  studio: string;
  description: string;
}

const OPTIONS: IFuseOptions<SearchDoc> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.34,
  minMatchCharLength: 2,
  keys: [
    { name: 'title', weight: 0.55 },
    { name: 'tags', weight: 0.18 },
    { name: 'category', weight: 0.12 },
    { name: 'studio', weight: 0.08 },
    { name: 'description', weight: 0.07 },
  ],
};

function toDoc(game: GameSummary): SearchDoc {
  const category = getCategory(game.category);
  return {
    game,
    title: game.title,
    tags: game.tags.map(tagLabel).join(' '),
    // Hindi and Hinglish category words, so "paheli" or "पहेली" finds puzzle games.
    category: [game.category.replace(/-/g, ' '), ...(category?.keywords ?? [])].join(' '),
    studio: game.studio.name,
    description: game.shortDescription,
  };
}

/** Fuzzy search over a list of games. An empty query returns nothing. */
export function searchGames(query: string, games: readonly GameSummary[]): GameSummary[] {
  const q = query.trim();
  if (q.length === 0) return [];
  if (q.length === 1) {
    const lower = q.toLowerCase();
    return games.filter((g) => g.title.toLowerCase().startsWith(lower));
  }
  const fuse = new Fuse(games.map(toDoc), OPTIONS);
  return fuse.search(q).map((r) => r.item.game);
}
