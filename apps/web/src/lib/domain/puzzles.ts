/**
 * Daily puzzles, the same for everyone each day (by the player's own date):
 * - Brain Word: guess the five-letter word in six tries. Each guess shows which letters are in
 *   the right place, in the word but elsewhere, or not in it.
 * - Brain Path: draw one line through every square of the grid, passing the numbers in order.
 * Everything here is pure, so the same day always gives the same puzzle.
 */
import { hashString } from './spark';

/** The player's local date as YYYY-MM-DD. */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Days since the first puzzle (27 November 2026 is puzzle #1). */
export function puzzleNumber(day: string): number {
  return Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse('2026-11-27T00:00:00Z')) / 86_400_000) + 1;
}

/** A small seeded random number generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Brain Word
// ---------------------------------------------------------------------------------------------

/** Everyday, child-friendly answers. Guesses must be real words (words5.ts). */
export const WORDS = `
apple brain chair dance eagle flame grape happy juice knife lemon magic night ocean piano queen river smile
tiger unity voice water yacht zebra adult beach bread candy cloud crown dream earth field frost ghost glass
heart horse house image jelly koala laugh light lucky mango maple metal money mouse music noble north olive
orbit paint panda party peace pearl pilot plant plate power pride prize quick quiet radio raven robot rocket
salad scale score shape shark sheep shell shine shirt skate sleep snake solar sound space spark spoon sport
squad stamp stand steam stone storm story sugar sunny sweet table teeth think thumb toast torch tower track
train treat trick truck trust uncle under unite urban value video vivid wagon whale wheat white world young
youth zesty alarm amber angel arrow badge basic beard bench berry blaze block bloom board bonus brave brick
bring brush build camel canal cargo chalk charm chase cheer chess chief child chips civic clean clear climb
clock coach coral count cover craft crisp curve daily delta diary dodge dozen eager early elbow enjoy entry
equal event extra fable fairy faith feast fiber final flash fleet float flock flour focus forge frame fresh
fruit funny giant giddy globe glove grand grass green guard guess guide habit honey hotel humor ideal igloo
input jolly joker judge jumbo kayak kneel label lance large laser layer learn level linen lodge logic loyal
lunar lunch march match mercy merry minor mixer model month motor movie naval nerve nurse oasis offer onion
opera order otter outer owner oxide paper patch pedal penny petal phase phone photo piece pixel pizza place
plaza plume point polar pouch press print proud pulse puppy quest quilt quota rally ranch rapid reach ready
realm relax reply rhyme ridge rings roast rover royal ruler rural saint sauce scarf scene scout seven shade
`
  .trim()
  .split(/\s+/)
  .filter((w) => /^[a-z]{5}$/.test(w));

/** Today's word. The list is shuffled once (fixed seed), so a word never repeats within a cycle. */
export function wordOfDay(day: string): string {
  const order = [...WORDS];
  const rand = seeded(20261127);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const n = Math.max(0, puzzleNumber(day) - 1);
  return order[n % order.length]!;
}

export type LetterMark = 'correct' | 'present' | 'absent';

/** Marks each letter of a guess. Repeated letters are only marked as often as the answer has them. */
export function markGuess(guess: string, answer: string): LetterMark[] {
  const g = guess.toLowerCase().split('');
  const a = answer.toLowerCase().split('');
  const marks: LetterMark[] = g.map(() => 'absent');
  const left = new Map<string, number>();
  g.forEach((ch, i) => {
    if (ch === a[i]) marks[i] = 'correct';
    else left.set(a[i]!, (left.get(a[i]!) ?? 0) + 1);
  });
  g.forEach((ch, i) => {
    if (marks[i] === 'correct') return;
    const n = left.get(ch) ?? 0;
    if (n > 0) {
      marks[i] = 'present';
      left.set(ch, n - 1);
    }
  });
  return marks;
}

export const WORD_TRIES = 6;

/** The share text: the puzzle number, the score and coloured squares, never the word itself. */
export function shareWord(day: string, guesses: string[], answer: string, won: boolean): string {
  const rows = guesses.map((g) => markGuess(g, answer).map((m) => (m === 'correct' ? '🟩' : m === 'present' ? '🟨' : '⬛')).join(''));
  return `Brain Word #${puzzleNumber(day)} ${won ? guesses.length : 'X'}/${WORD_TRIES}\n${rows.join('\n')}`;
}

// ---------------------------------------------------------------------------------------------
// Brain Path
// ---------------------------------------------------------------------------------------------

export interface PathPuzzle {
  size: number;
  /** One solution, as cell indexes (row * size + column). */
  solution: number[];
  /** Numbered cells: cell index → number (1 is the start, the highest is the end). */
  clues: Map<number, number>;
}

const neighbours = (cell: number, size: number): number[] => {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const out: number[] = [];
  if (r > 0) out.push(cell - size);
  if (r < size - 1) out.push(cell + size);
  if (c > 0) out.push(cell - 1);
  if (c < size - 1) out.push(cell + 1);
  return out;
};

export const isNeighbour = (a: number, b: number, size: number) => neighbours(a, size).includes(b);

/**
 * Today's grid: a random line through every square (made by "backbite" moves on a zig-zag), with
 * numbers along it. Bigger on weekends.
 */
export function pathOfDay(day: string): PathPuzzle {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const size = weekday === 0 || weekday === 6 ? 7 : 6;
  const rand = seeded(hashString(`path:${day}`));
  // Start from a zig-zag line through every square.
  let path: number[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) path.push(r * size + (r % 2 === 0 ? c : size - 1 - c));
  }
  for (let step = 0; step < size * size * 40; step++) {
    if (rand() < 0.5) path = path.reverse();
    const tail = path[path.length - 1]!;
    const options = neighbours(tail, size).filter((n) => n !== path[path.length - 2]);
    const pick = options[Math.floor(rand() * options.length)]!;
    const i = path.indexOf(pick);
    path = [...path.slice(0, i + 1), ...path.slice(i + 1).reverse()];
  }
  const clues = new Map<number, number>();
  const count = size === 7 ? 10 : 8;
  for (let k = 0; k < count; k++) {
    const at = Math.round((k * (path.length - 1)) / (count - 1));
    clues.set(path[at]!, k + 1);
  }
  return { size, solution: path, clues };
}

/** Whether a drawn line solves the puzzle: every square once, side by side, the numbers in order. */
export function pathSolved(p: PathPuzzle, line: number[]): boolean {
  if (line.length !== p.size * p.size || new Set(line).size !== line.length) return false;
  let next = 1;
  for (let i = 0; i < line.length; i++) {
    if (i > 0 && !isNeighbour(line[i - 1]!, line[i]!, p.size)) return false;
    const n = p.clues.get(line[i]!);
    if (n != null) {
      if (n !== next) return false;
      next += 1;
    }
  }
  return next === p.clues.size + 1 && p.clues.get(line[line.length - 1]!) === p.clues.size;
}

/** Whether `line` may grow to `cell`: next to the end, not used yet, and no number skipped. */
export function canExtend(p: PathPuzzle, line: number[], cell: number): boolean {
  if (line.length === 0) return p.clues.get(cell) === 1;
  if (line.includes(cell) || !isNeighbour(line[line.length - 1]!, cell, p.size)) return false;
  const n = p.clues.get(cell);
  if (n == null) return true;
  const reached = line.reduce((m, c) => Math.max(m, p.clues.get(c) ?? 0), 0);
  return n === reached + 1;
}

export function sharePath(day: string, seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `Brain Path #${puzzleNumber(day)} solved in ${m}:${s} 🧠`;
}
