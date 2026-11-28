import { describe, expect, it } from 'vitest';
import { WORDS, canExtend, markGuess, pathOfDay, pathSolved, puzzleNumber, wordOfDay } from '@/lib/domain/puzzles';

describe('Brain Word', () => {
  it('has a long list of five-letter answers and the same word all day', () => {
    expect(WORDS.length).toBeGreaterThan(300);
    expect(wordOfDay('2026-12-01')).toBe(wordOfDay('2026-12-01'));
    expect(wordOfDay('2026-12-01')).not.toBe(wordOfDay('2026-12-02'));
    expect(puzzleNumber('2026-11-27')).toBe(1);
  });

  it('marks repeated letters only as often as the answer has them', () => {
    expect(markGuess('apple', 'apple')).toEqual(['correct', 'correct', 'correct', 'correct', 'correct']);
    expect(markGuess('sheep', 'peach')).toEqual(['absent', 'present', 'present', 'absent', 'present']);
    expect(markGuess('llama', 'hello')).toEqual(['present', 'present', 'absent', 'absent', 'absent']);
  });
});

describe('Brain Path', () => {
  it('makes a grid whose own solution passes and whose numbers are in order', () => {
    for (const day of ['2026-11-27', '2026-11-28', '2026-12-25']) {
      const p = pathOfDay(day);
      expect(p.solution).toHaveLength(p.size * p.size);
      expect(pathSolved(p, p.solution)).toBe(true);
      expect(p.clues.get(p.solution[0]!)).toBe(1);
    }
    expect(pathOfDay('2026-11-28').size).toBe(7); // a Saturday
  });

  it('refuses lines that skip a number, cross themselves or miss squares', () => {
    const p = pathOfDay('2026-11-27');
    expect(pathSolved(p, p.solution.slice(0, -1))).toBe(false);
    expect(canExtend(p, [], p.solution[1]!)).toBe(p.clues.get(p.solution[1]!) === 1);
    expect(canExtend(p, [p.solution[0]!], p.solution[0]!)).toBe(false);
  });
});

describe('Brain Word dictionary', () => {
  it('accepts every answer and refuses made-up words', async () => {
    const { GUESSES } = await import('@/lib/domain/words5');
    const all = new Set(GUESSES.split(' '));
    expect(all.size).toBeGreaterThan(10_000);
    for (const w of WORDS) expect(all.has(w)).toBe(true);
    expect(all.has('qzxvb')).toBe(false);
    expect(all.has('aaaaa')).toBe(false);
  });
});

describe('Sudoku and Mini Crossword', () => {
  it('makes a Sudoku with exactly one solution that fits its givens', async () => {
    const { sudokuOfDay, clashes } = await import('@/lib/domain/sudoku');
    const p = sudokuOfDay('2026-11-28');
    expect(p.solution.every((n) => n >= 1 && n <= 9)).toBe(true);
    expect(clashes(p.solution).size).toBe(0);
    p.givens.forEach((n, i) => n && expect(n).toBe(p.solution[i]));
    const filled = p.givens.filter(Boolean).length;
    expect(filled).toBeGreaterThanOrEqual(28);
    expect(filled).toBeLessThan(45);
  });

  it('makes a crossword of crossing words with clues, the same all day', async () => {
    const { crosswordOfDay, crosswordSolved, CLUES } = await import('@/lib/domain/crossword');
    for (const day of ['2026-11-28', '2026-11-29', '2026-12-31']) {
      const c = crosswordOfDay(day);
      expect(c.entries.length).toBeGreaterThanOrEqual(4);
      for (const e of c.entries) {
        expect(CLUES[e.word]).toBe(e.clue);
        for (let k = 0; k < e.word.length; k++) expect(c.grid[e.row + (e.across ? 0 : k)]![e.col + (e.across ? k : 0)]).toBe(e.word[k]);
      }
      const all: Record<string, string> = {};
      c.grid.forEach((row, r) => row.forEach((ch, col) => ch && (all[`${r},${col}`] = ch)));
      expect(crosswordSolved(c, all)).toBe(true);
      expect(crosswordSolved(c, {})).toBe(false);
    }
    expect(JSON.stringify(crosswordOfDay('2026-11-28'))).toBe(JSON.stringify(crosswordOfDay('2026-11-28')));
  });
});
