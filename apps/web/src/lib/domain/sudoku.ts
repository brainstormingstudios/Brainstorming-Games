/**
 * Daily Sudoku: the same puzzle for everyone each day, always with exactly one solution.
 * Weekdays are a little easier than weekends.
 */
import { seeded } from './puzzles';
import { hashString } from './spark';

export interface SudokuPuzzle {
  /** 81 numbers, 0 for an empty square. */
  givens: number[];
  solution: number[];
}

const rowOf = (i: number) => Math.floor(i / 9);
const colOf = (i: number) => i % 9;
const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/** Whether `n` may go in square `i` of `grid`. */
export function allowed(grid: number[], i: number, n: number): boolean {
  for (let j = 0; j < 81; j++) {
    if (j === i || grid[j] !== n) continue;
    if (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) return false;
  }
  return true;
}

/** Counts solutions, stopping at `limit`. */
function countSolutions(grid: number[], limit: number): number {
  const i = grid.indexOf(0);
  if (i < 0) return 1;
  let count = 0;
  for (let n = 1; n <= 9 && count < limit; n++) {
    if (!allowed(grid, i, n)) continue;
    grid[i] = n;
    count += countSolutions(grid, limit - count);
    grid[i] = 0;
  }
  return count;
}

function fill(grid: number[], rand: () => number): boolean {
  const i = grid.indexOf(0);
  if (i < 0) return true;
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rand() - 0.5);
  for (const n of digits) {
    if (!allowed(grid, i, n)) continue;
    grid[i] = n;
    if (fill(grid, rand)) return true;
  }
  grid[i] = 0;
  return false;
}

export function sudokuOfDay(day: string): SudokuPuzzle {
  const rand = seeded(hashString(`sudoku:${day}`));
  const solution = Array<number>(81).fill(0);
  fill(solution, rand);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const keep = weekday === 0 || weekday === 6 ? 28 : 34;
  const givens = [...solution];
  const order = Array.from({ length: 81 }, (_, i) => i).sort(() => rand() - 0.5);
  let filled = 81;
  for (const i of order) {
    if (filled <= keep) break;
    const was = givens[i]!;
    givens[i] = 0;
    if (countSolutions([...givens], 2) !== 1) givens[i] = was;
    else filled -= 1;
  }
  return { givens, solution };
}

/** Squares whose number clashes with another in its row, column or box. */
export function clashes(grid: number[]): Set<number> {
  const out = new Set<number>();
  grid.forEach((n, i) => {
    if (n && !allowed(grid, i, n)) out.add(i);
  });
  return out;
}

export const sudokuSolved = (grid: number[], p: SudokuPuzzle) => grid.every((n, i) => n === p.solution[i]);
