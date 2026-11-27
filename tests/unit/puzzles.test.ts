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
