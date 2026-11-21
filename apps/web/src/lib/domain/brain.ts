/**
 * Brain Profile: what a player's play time says about the skills they practise.
 *
 * Each game is tagged by its developer with up to three skills. A play session's seconds are
 * shared equally between the game's skills. A skill's score (0 to 100) grows with practice and
 * slows down as it gets high, so early play shows progress quickly and a 100 takes real work:
 *
 *   score = 100 × (1 − e^(−seconds / SCALE)),  SCALE = 6 hours  (6 h ≈ 63, 12 h ≈ 86, 18 h ≈ 95)
 *
 * Weekly change compares the last 7 days with the 7 days before.
 */
export const SKILLS = ['memory', 'logic', 'speed', 'focus', 'strategy'] as const;
export type Skill = (typeof SKILLS)[number];
export const MAX_SKILLS_PER_GAME = 3;

const SCALE_SECONDS = 6 * 3600;

/** Play time of one game on one day. */
export interface PlayRow {
  gameId: string;
  /** YYYY-MM-DD (UTC). */
  day: string;
  seconds: number;
}

export type SkillMap = Record<Skill, number>;

export interface BrainProfile {
  /** 0 to 100 per skill. */
  scores: SkillMap;
  /** All-time minutes per skill. */
  minutes: SkillMap;
  /** Minutes per skill in the last 7 days and the 7 days before. */
  week: SkillMap;
  prevWeek: SkillMap;
  /** Last 7 days, oldest first: minutes per skill each day (the learning-time chart). */
  days: { day: string; minutes: SkillMap }[];
  /** The strongest skill, or null before any tagged play. */
  top: Skill | null;
  totalMinutes: number;
  weekMinutes: number;
  /** Sum of scores ÷ 5, rounded: one number for the whole profile. */
  brainScore: number;
}

export const emptySkills = (): SkillMap => ({ memory: 0, logic: 0, speed: 0, focus: 0, strategy: 0 });

export function isSkill(value: unknown): value is Skill {
  return typeof value === 'string' && (SKILLS as readonly string[]).includes(value);
}

/** Cleans a developer's choice: known skills only, no repeats, at most three. */
export function normaliseSkills(values: readonly unknown[]): Skill[] {
  return [...new Set(values.filter(isSkill))].slice(0, MAX_SKILLS_PER_GAME);
}

export function skillScore(seconds: number): number {
  if (!(seconds > 0)) return 0;
  // Any practice shows: a few seconds of play is a 1, not a 0.
  return Math.min(100, Math.max(1, Math.round(100 * (1 - Math.exp(-seconds / SCALE_SECONDS)))));
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeBrainProfile(rows: readonly PlayRow[], skillsByGame: Readonly<Record<string, readonly Skill[]>>, today = new Date()): BrainProfile {
  const seconds = emptySkills();
  const week = emptySkills();
  const prevWeek = emptySkills();
  const todayKey = dayKey(today);
  const weekStart = dayKey(addDays(today, -6));
  const prevStart = dayKey(addDays(today, -13));
  const dayKeys = Array.from({ length: 7 }, (_, i) => dayKey(addDays(today, i - 6)));
  const perDay = new Map(dayKeys.map((k) => [k, emptySkills()]));

  for (const row of rows) {
    const skills = normaliseSkills(skillsByGame[row.gameId] ?? []);
    if (skills.length === 0 || !(row.seconds > 0) || row.day > todayKey) continue;
    const share = row.seconds / skills.length;
    for (const s of skills) {
      seconds[s] += share;
      if (row.day >= weekStart) {
        week[s] += share / 60;
        perDay.get(row.day)![s] += share / 60;
      } else if (row.day >= prevStart) prevWeek[s] += share / 60;
    }
  }

  const scores = emptySkills();
  const minutes = emptySkills();
  for (const s of SKILLS) {
    scores[s] = skillScore(seconds[s]);
    minutes[s] = round1(seconds[s] / 60);
    week[s] = round1(week[s]);
    prevWeek[s] = round1(prevWeek[s]);
  }
  const ranked = [...SKILLS].sort((a, b) => seconds[b] - seconds[a]);
  const top = seconds[ranked[0]!] > 0 ? ranked[0]! : null;
  return {
    scores,
    minutes,
    week,
    prevWeek,
    days: dayKeys.map((day) => {
      const m = perDay.get(day)!;
      for (const s of SKILLS) m[s] = round1(m[s]);
      return { day, minutes: m };
    }),
    top,
    totalMinutes: round1(SKILLS.reduce((n, s) => n + seconds[s], 0) / 60),
    weekMinutes: round1(SKILLS.reduce((n, s) => n + week[s], 0)),
    brainScore: Math.round(SKILLS.reduce((n, s) => n + scores[s], 0) / SKILLS.length),
  };
}

/** Percentage change this week vs last week, or null when there was no play last week. */
export function weeklyChange(week: number, prevWeek: number): number | null {
  if (!(prevWeek > 0)) return null;
  return Math.round(((week - prevWeek) / prevWeek) * 100);
}
