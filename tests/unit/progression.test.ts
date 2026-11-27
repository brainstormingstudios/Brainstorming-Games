import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMinorByBirthYear, isRestricted } from '@/lib/domain/ageGate';
import {
  COSMETICS,
  QUESTS,
  activeQuests,
  levelFor,
  nextStreak,
  periodStart,
  pointsForLevel,
  questProgress,
  type ProgressInputs,
} from '@/lib/domain/progression';
import { COSMETIC_CODES } from '@brainstorming/ui';

const seed = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'seed.sql'), 'utf8');

describe('seed data', () => {
  it('has exactly 42 cosmetics (12 are profile pictures), the same as seed.sql, all drawable', () => {
    expect(COSMETICS).toHaveLength(42);
    for (const c of COSMETICS) {
      expect(seed).toContain(`('${c.slot}', '${c.code}'`);
      expect(COSMETIC_CODES[c.slot]).toContain(c.code);
    }
  });
  it('has the same quests as seed.sql', () => {
    for (const q of QUESTS) expect(seed).toContain(`('${q.code}', '${q.period}'`);
  });
});

describe('levels and streaks', () => {
  it('levels up on lifetime points', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(49)).toBe(1);
    expect(levelFor(50)).toBe(2);
    expect(levelFor(200)).toBe(3);
    expect(pointsForLevel(3)).toBe(200);
  });
  it('keeps, extends or restarts a streak', () => {
    expect(nextStreak(4, '2026-11-12', '2026-11-12')).toBe(4);
    expect(nextStreak(4, '2026-11-11', '2026-11-12')).toBe(5);
    expect(nextStreak(4, '2026-11-09', '2026-11-12')).toBe(1);
    expect(nextStreak(0, null, '2026-11-12')).toBe(1);
  });
});

describe('quests', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  it('rotates 3 daily and 5 weekly quests, the same for everyone', () => {
    const a = activeQuests(QUESTS, now);
    expect(a.filter((q) => q.period === 'daily')).toHaveLength(3);
    expect(a.filter((q) => q.period === 'weekly')).toHaveLength(5);
    expect(activeQuests(QUESTS, now).map((q) => q.code)).toEqual(a.map((q) => q.code));
    expect(periodStart('weekly', now)).toBe('2026-11-09');
  });
  it('counts progress from play, capped at the target', () => {
    const inputs: ProgressInputs = {
      plays: [
        { gameId: 'a', category: 'puzzle', multiplayer: false, releasedAt: '2026-11-11T00:00:00Z', seconds: 300, at: '' },
        { gameId: 'b', category: 'puzzle', multiplayer: true, releasedAt: '2026-01-01T00:00:00Z', seconds: 400, at: '' },
        { gameId: 'b', category: 'puzzle', multiplayer: true, releasedAt: '2026-01-01T00:00:00Z', seconds: 0, at: '' },
      ],
      ratings: 2,
      favourites: 1,
      custom: { boss: 3 },
    };
    const q = (code: string) => QUESTS.find((x) => x.code === code)!;
    expect(questProgress(q('daily_play_3'), inputs, now)).toBe(2);
    expect(questProgress(q('daily_puzzle_2'), inputs, now)).toBe(2);
    expect(questProgress(q('daily_minutes_10'), inputs, now)).toBe(10);
    expect(questProgress(q('daily_new_1'), inputs, now)).toBe(1);
    expect(questProgress(q('weekly_multiplayer_2'), inputs, now)).toBe(1);
    expect(questProgress(q('daily_rate_1'), inputs, now)).toBe(1);
    expect(questProgress(q('weekly_sessions_20'), inputs, now)).toBe(3);
  });
});

describe('age gate', () => {
  const now = new Date('2026-11-12T00:00:00Z');
  it('treats anyone who could still be 17 as a minor', () => {
    expect(isMinorByBirthYear(2008, now)).toBe(true); // could be 17 until their birthday
    expect(isMinorByBirthYear(2007, now)).toBe(false);
    expect(isMinorByBirthYear(2014, now)).toBe(true);
  });
  it('restricts minors until consent is granted', () => {
    expect(isRestricted({ isMinor: true, consent: 'pending' })).toBe(true);
    expect(isRestricted({ isMinor: true, consent: 'granted' })).toBe(false);
    expect(isRestricted({ isMinor: false, consent: 'not_required' })).toBe(false);
  });
});
