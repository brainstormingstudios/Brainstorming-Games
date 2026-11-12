/**
 * Brain Quests, Brain Points, levels and cosmetics. The same rules as 0004_progression.sql; the
 * seed lists mirror supabase/seed.sql (a unit test keeps them in sync).
 *
 * Brain Points are earned by playing. They are never money: they cannot be bought, sold or
 * traded, and there are no paid random rewards.
 */
import { hashString } from './spark';

export type QuestPeriod = 'daily' | 'weekly';

export type QuestRule =
  | { kind: 'play_sessions' }
  | { kind: 'play_distinct'; category?: string }
  | { kind: 'play_new'; days: number }
  | { kind: 'play_multiplayer' }
  | { kind: 'play_minutes' }
  | { kind: 'rate' }
  | { kind: 'favourite' }
  | { kind: 'custom'; event: string };

export interface QuestDef {
  code: string;
  period: QuestPeriod;
  title: { en: string; hi: string };
  description: { en: string; hi: string };
  rule: QuestRule;
  target: number;
  reward: number;
}

export const QUESTS: QuestDef[] = [
  { code: 'daily_play_1', period: 'daily', title: { en: 'Play a game', hi: 'एक गेम खेलें' }, description: { en: 'Start any game today.', hi: 'आज कोई भी गेम शुरू करें।' }, rule: { kind: 'play_sessions' }, target: 1, reward: 10 },
  { code: 'daily_play_3', period: 'daily', title: { en: 'Try 3 different games', hi: '3 अलग गेम आज़माएँ' }, description: { en: 'Play three different games today.', hi: 'आज तीन अलग-अलग गेम खेलें।' }, rule: { kind: 'play_distinct' }, target: 3, reward: 25 },
  { code: 'daily_minutes_10', period: 'daily', title: { en: 'Play for 10 minutes', hi: '10 मिनट खेलें' }, description: { en: 'Reach 10 minutes of play in any games.', hi: 'किसी भी गेम में कुल 10 मिनट खेलें।' }, rule: { kind: 'play_minutes' }, target: 10, reward: 20 },
  { code: 'daily_puzzle_2', period: 'daily', title: { en: 'Solve it', hi: 'पहेली सुलझाएँ' }, description: { en: 'Play 2 different puzzle games.', hi: '2 अलग पहेली गेम खेलें।' }, rule: { kind: 'play_distinct', category: 'puzzle' }, target: 2, reward: 20 },
  { code: 'daily_rate_1', period: 'daily', title: { en: 'Have your say', hi: 'अपनी राय दें' }, description: { en: 'Like or dislike a game.', hi: 'किसी गेम को पसंद या नापसंद करें।' }, rule: { kind: 'rate' }, target: 1, reward: 10 },
  { code: 'daily_new_1', period: 'daily', title: { en: 'Fresh pick', hi: 'ताज़ा पसंद' }, description: { en: 'Play a game released this week.', hi: 'इस हफ़्ते रिलीज़ हुआ कोई गेम खेलें।' }, rule: { kind: 'play_new', days: 7 }, target: 1, reward: 20 },
  { code: 'daily_arcade_2', period: 'daily', title: { en: 'Arcade break', hi: 'आर्केड ब्रेक' }, description: { en: 'Play 2 different arcade games.', hi: '2 अलग आर्केड गेम खेलें।' }, rule: { kind: 'play_distinct', category: 'arcade' }, target: 2, reward: 20 },
  { code: 'weekly_play_10', period: 'weekly', title: { en: 'Explorer', hi: 'खोजी' }, description: { en: 'Play 10 different games this week.', hi: 'इस हफ़्ते 10 अलग गेम खेलें।' }, rule: { kind: 'play_distinct' }, target: 10, reward: 100 },
  { code: 'weekly_minutes_60', period: 'weekly', title: { en: 'Marathon', hi: 'मैराथन' }, description: { en: 'Reach 60 minutes of play this week.', hi: 'इस हफ़्ते कुल 60 मिनट खेलें।' }, rule: { kind: 'play_minutes' }, target: 60, reward: 80 },
  { code: 'weekly_new_3', period: 'weekly', title: { en: 'Early bird', hi: 'सबसे पहले' }, description: { en: 'Play 3 games released in the last 7 days.', hi: 'पिछले 7 दिनों में रिलीज़ हुए 3 गेम खेलें।' }, rule: { kind: 'play_new', days: 7 }, target: 3, reward: 80 },
  { code: 'weekly_multiplayer_2', period: 'weekly', title: { en: 'Team up', hi: 'टीम बनाएँ' }, description: { en: 'Play 2 different multiplayer games.', hi: '2 अलग मल्टीप्लेयर गेम खेलें।' }, rule: { kind: 'play_multiplayer' }, target: 2, reward: 60 },
  { code: 'weekly_rate_5', period: 'weekly', title: { en: 'Critic', hi: 'समीक्षक' }, description: { en: 'Rate 5 games.', hi: '5 गेम रेट करें।' }, rule: { kind: 'rate' }, target: 5, reward: 50 },
  { code: 'weekly_favourite_3', period: 'weekly', title: { en: 'Collector', hi: 'संग्राहक' }, description: { en: 'Add 3 games to your favourites.', hi: '3 गेम पसंदीदा में जोड़ें।' }, rule: { kind: 'favourite' }, target: 3, reward: 40 },
  { code: 'weekly_strategy_3', period: 'weekly', title: { en: 'Mastermind', hi: 'मास्टरमाइंड' }, description: { en: 'Play 3 different strategy games.', hi: '3 अलग रणनीति गेम खेलें।' }, rule: { kind: 'play_distinct', category: 'strategy' }, target: 3, reward: 60 },
  { code: 'weekly_sessions_20', period: 'weekly', title: { en: 'Regular', hi: 'नियमित खिलाड़ी' }, description: { en: 'Start 20 play sessions this week.', hi: 'इस हफ़्ते 20 बार गेम शुरू करें।' }, rule: { kind: 'play_sessions' }, target: 20, reward: 70 },
];

export type CosmeticSlot = 'colour' | 'hat' | 'glasses' | 'headphones' | 'glow' | 'frame';

export interface CosmeticDef {
  slot: CosmeticSlot;
  code: string;
  name: { en: string; hi: string };
  cost: number;
  minLevel: number;
}

const c = (slot: CosmeticSlot, code: string, en: string, hi: string, cost: number, minLevel: number): CosmeticDef => ({ slot, code, name: { en, hi }, cost, minLevel });

/** 30 avatar cosmetics. Codes match the art in packages/ui/src/mascot/MascotAvatar.tsx. */
export const COSMETICS: CosmeticDef[] = [
  c('colour', 'classic', 'Classic navy', 'क्लासिक नेवी', 0, 1),
  c('colour', 'ocean', 'Ocean', 'समुद्री', 60, 2),
  c('colour', 'forest', 'Forest', 'हरा-भरा', 60, 2),
  c('colour', 'sunset', 'Sunset', 'सूर्यास्त', 120, 3),
  c('colour', 'berry', 'Berry', 'बेरी', 120, 3),
  c('colour', 'royal', 'Royal', 'शाही', 200, 5),
  c('hat', 'cap', 'Cap', 'कैप', 40, 1),
  c('hat', 'beanie', 'Beanie', 'बीनी', 60, 2),
  c('hat', 'party', 'Party hat', 'पार्टी हैट', 80, 2),
  c('hat', 'graduation', 'Graduation cap', 'ग्रेजुएशन कैप', 150, 4),
  c('hat', 'wizard', 'Wizard hat', 'जादूगर की टोपी', 220, 5),
  c('hat', 'crown', 'Crown', 'ताज', 400, 8),
  c('glasses', 'round', 'Round glasses', 'गोल चश्मा', 40, 1),
  c('glasses', 'shades', 'Shades', 'काला चश्मा', 90, 2),
  c('glasses', 'pixel', 'Pixel shades', 'पिक्सेल चश्मा', 140, 4),
  c('glasses', 'star', 'Star glasses', 'सितारा चश्मा', 180, 5),
  c('glasses', 'monocle', 'Monocle', 'मोनोकल', 240, 6),
  c('headphones', 'studio', 'Studio headphones', 'स्टूडियो हेडफ़ोन', 0, 1),
  c('headphones', 'retro', 'Retro headphones', 'रेट्रो हेडफ़ोन', 70, 2),
  c('headphones', 'cat', 'Cat-ear headphones', 'बिल्ली-कान हेडफ़ोन', 160, 4),
  c('headphones', 'neon', 'Neon headphones', 'नियॉन हेडफ़ोन', 260, 6),
  c('glow', 'cyan', 'Cyan glow', 'सियान चमक', 0, 1),
  c('glow', 'lime', 'Lime glow', 'नींबू चमक', 80, 2),
  c('glow', 'pink', 'Pink glow', 'गुलाबी चमक', 80, 2),
  c('glow', 'violet', 'Violet glow', 'बैंगनी चमक', 150, 4),
  c('glow', 'gold', 'Gold glow', 'सुनहरी चमक', 300, 7),
  c('frame', 'ring-cyan', 'Cyan ring', 'सियान घेरा', 50, 1),
  c('frame', 'hex', 'Hex frame', 'षट्कोण फ़्रेम', 120, 3),
  c('frame', 'sparkle', 'Sparkle frame', 'चमकदार फ़्रेम', 220, 5),
  c('frame', 'ring-gold', 'Gold ring', 'सुनहरा घेरा', 500, 10),
];

/** Level from lifetime points: 50 for level 2, 200 for level 3, 450 for level 4 ... */
export function levelFor(lifetimePoints: number): number {
  return Math.floor(Math.sqrt(Math.max(lifetimePoints, 0) / 50)) + 1;
}

/** Lifetime points needed to reach `level`. */
export function pointsForLevel(level: number): number {
  return 50 * (level - 1) ** 2;
}

/** UTC day or ISO-week start, as YYYY-MM-DD. */
export function periodStart(period: QuestPeriod, now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Today's 3 daily and this week's 5 weekly quests: the same for every player, rotating. */
export function activeQuests(all: readonly QuestDef[] = QUESTS, now: Date = new Date()): QuestDef[] {
  const pick = (period: QuestPeriod, n: number) => {
    const start = periodStart(period, now);
    return all
      .filter((q) => q.period === period)
      .sort((a, b) => hashString(`${a.code}${start}`) - hashString(`${b.code}${start}`))
      .slice(0, n);
  };
  return [...pick('daily', 3), ...pick('weekly', 5)];
}

export interface ProgressInputs {
  /** The player's play sessions in the period: game, its category, flags, seconds played. */
  plays: { gameId: string; category: string; multiplayer: boolean; releasedAt: string | null; seconds: number; at: string }[];
  ratings: number;
  favourites: number;
  custom: Record<string, number>;
}

/** Progress of one quest from the player's activity since the period started. */
export function questProgress(q: QuestDef, inputs: ProgressInputs, now: Date = new Date()): number {
  const r = q.rule;
  let value = 0;
  switch (r.kind) {
    case 'play_sessions':
      value = inputs.plays.length;
      break;
    case 'play_distinct':
      value = new Set(inputs.plays.filter((p) => !r.category || p.category === r.category).map((p) => p.gameId)).size;
      break;
    case 'play_new': {
      const cutoff = now.getTime() - r.days * 86_400_000;
      value = new Set(inputs.plays.filter((p) => p.releasedAt && new Date(p.releasedAt).getTime() > cutoff).map((p) => p.gameId)).size;
      break;
    }
    case 'play_multiplayer':
      value = new Set(inputs.plays.filter((p) => p.multiplayer).map((p) => p.gameId)).size;
      break;
    case 'play_minutes':
      value = Math.floor(inputs.plays.reduce((n, p) => n + p.seconds, 0) / 60);
      break;
    case 'rate':
      value = inputs.ratings;
      break;
    case 'favourite':
      value = inputs.favourites;
      break;
    case 'custom':
      value = inputs.custom[r.event] ?? 0;
      break;
  }
  return Math.min(value, q.target);
}

/** Next streak value after playing on `today`, given the last day played. */
export function nextStreak(current: number, lastDay: string | null, today: string): number {
  if (lastDay === today) return current;
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return lastDay === yesterday.toISOString().slice(0, 10) ? current + 1 : 1;
}

/** Profile badges, earned from play. */
export function badgesFor(
  stats: { gamesPlayed: number; questsCompleted: number },
  user: { streakDays: number; level: number },
): string[] {
  const out: string[] = [];
  if (stats.gamesPlayed >= 1) out.push('first-game');
  if (stats.gamesPlayed >= 10) out.push('explorer');
  if (stats.questsCompleted >= 5) out.push('quester');
  if (user.streakDays >= 7) out.push('streak-7');
  if (user.level >= 5) out.push('level-5');
  return out;
}

/** Preset party-chat phrases. Only these ids are accepted; there is no free text. */
export const PARTY_PHRASES = ['hi', 'gg', 'nice', 'ready', 'wait', 'next', 'again', 'thanks', 'wow', 'brb', 'lol', 'bye'] as const;
export type PartyPhrase = (typeof PARTY_PHRASES)[number];
export const PARTY_EMOJI: Partial<Record<PartyPhrase, string>> = { gg: '🏆', nice: '👍', wow: '🤩', lol: '😂', ready: '✅', thanks: '🙏', hi: '👋', bye: '👋' };
