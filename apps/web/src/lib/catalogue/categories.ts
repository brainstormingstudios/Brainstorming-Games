import type { GameSummary } from '@/lib/data/types';

/**
 * The 15 sidebar categories.
 * `primary` categories are what a developer picks for a game. `collection` categories are
 * derived: a game appears in them because of a tag, a flag or the studio's country.
 */
export interface CategoryDef {
  slug: string;
  kind: 'primary' | 'collection';
  /** Extra search terms: Hindi words and common Hinglish spellings for Hindi-first discovery. */
  keywords: string[];
}

export const CATEGORIES: readonly CategoryDef[] = [
  { slug: 'action', kind: 'primary', keywords: ['एक्शन', 'ladai', 'fight', 'लड़ाई'] },
  { slug: 'adventure', kind: 'primary', keywords: ['एडवेंचर', 'रोमांच', 'romanch', 'safar'] },
  { slug: 'arcade', kind: 'primary', keywords: ['आर्केड', 'classic', 'retro'] },
  { slug: 'puzzle', kind: 'primary', keywords: ['पहेली', 'paheli', 'dimaag', 'दिमाग', 'brain'] },
  { slug: 'racing-driving', kind: 'primary', keywords: ['रेसिंग', 'रेस', 'gaadi', 'गाड़ी', 'car', 'bike', 'race'] },
  { slug: 'shooting', kind: 'primary', keywords: ['शूटिंग', 'bandook', 'बंदूक', 'gun', 'fps'] },
  { slug: 'sports', kind: 'primary', keywords: ['खेल', 'khel', 'cricket', 'क्रिकेट', 'football', 'फुटबॉल'] },
  { slug: 'strategy', kind: 'primary', keywords: ['रणनीति', 'ranniti', 'tower defense', 'chaal'] },
  { slug: 'simulation', kind: 'primary', keywords: ['सिमुलेशन', 'sim', 'tycoon'] },
  { slug: 'clicker-idle', kind: 'primary', keywords: ['क्लिकर', 'idle', 'tap', 'incremental'] },
  { slug: 'io', kind: 'primary', keywords: ['.io', 'io games', 'आईओ'] },
  { slug: 'card-board', kind: 'primary', keywords: ['ताश', 'taash', 'ludo', 'लूडो', 'carrom', 'कैरम', 'chess', 'शतरंज', 'board'] },
  { slug: 'word-trivia', kind: 'primary', keywords: ['शब्द', 'shabd', 'quiz', 'क्विज़', 'gk', 'trivia'] },
  { slug: '2-player', kind: 'collection', keywords: ['दो खिलाड़ी', 'do khiladi', 'two player', '2 player', 'dost'] },
  { slug: 'made-in-india', kind: 'collection', keywords: ['भारत', 'bharat', 'desi', 'देसी', 'indian', 'india'] },
] as const;

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
export const PRIMARY_CATEGORY_SLUGS = CATEGORIES.filter((c) => c.kind === 'primary').map((c) => c.slug);

const bySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function getCategory(slug: string): CategoryDef | undefined {
  return bySlug.get(slug);
}

/** Whether a game belongs on a category page. */
export function gameInCategory(
  game: Pick<GameSummary, 'category' | 'tags' | 'studio'>,
  slug: string,
): boolean {
  switch (slug) {
    case '2-player':
      return game.tags.includes('2-player') || game.category === '2-player';
    case 'made-in-india':
      return game.studio.country === 'IN' || game.tags.includes('made-in-india');
    default:
      return game.category === slug;
  }
}

/** Normalises free-text tags into URL-safe slugs: `Tower Defense!` becomes `tower-defense`. */
export function tagSlug(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** `tower-defense` becomes `Tower defense` for display. */
export function tagLabel(slug: string): string {
  const text = slug.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
