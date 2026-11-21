import { describe, expect, it } from 'vitest';
import { computeBrainProfile, normaliseSkills, skillScore, weeklyChange } from '@/lib/domain/brain';

const today = new Date('2026-11-21T12:00:00Z');

describe('brain profile', () => {
  it('scores grow fast at first and slowly near the top', () => {
    expect(skillScore(0)).toBe(0);
    expect(skillScore(5)).toBe(1);
    expect(skillScore(6 * 3600)).toBe(63);
    expect(skillScore(12 * 3600)).toBe(86);
    expect(skillScore(1e9)).toBe(100);
  });

  it('cleans skill tags: known ones, no repeats, at most three', () => {
    expect(normaliseSkills(['logic', 'logic', 'nope', 'speed', 'focus', 'memory'])).toEqual(['logic', 'speed', 'focus']);
  });

  it('splits play time across a game’s skills and separates this week from last week', () => {
    const profile = computeBrainProfile(
      [
        { gameId: 'puzzle', day: '2026-11-21', seconds: 1200 }, // today: 20 min, logic + memory
        { gameId: 'racer', day: '2026-11-20', seconds: 600 }, // 10 min speed
        { gameId: 'racer', day: '2026-11-10', seconds: 1800 }, // last week: 30 min speed
        { gameId: 'untagged', day: '2026-11-21', seconds: 9999 },
      ],
      { puzzle: ['logic', 'memory'], racer: ['speed'] },
      today,
    );
    expect(profile.week).toEqual({ memory: 10, logic: 10, speed: 10, focus: 0, strategy: 0 });
    expect(profile.prevWeek.speed).toBe(30);
    expect(profile.minutes.speed).toBe(40);
    expect(profile.top).toBe('speed');
    expect(profile.weekMinutes).toBe(30);
    expect(profile.days).toHaveLength(7);
    expect(profile.days[6]).toEqual({ day: '2026-11-21', minutes: { memory: 10, logic: 10, speed: 0, focus: 0, strategy: 0 } });
    expect(weeklyChange(profile.week.speed, profile.prevWeek.speed)).toBe(-67);
    expect(weeklyChange(5, 0)).toBeNull();
  });

  it('is empty before any tagged play', () => {
    const p = computeBrainProfile([], {}, today);
    expect(p.top).toBeNull();
    expect(p.brainScore).toBe(0);
  });
});
