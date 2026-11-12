/**
 * Spark Launch rules.
 *
 * A Spark game gets guaranteed exposure (the "Fresh games" rail plus 1 in 10 slots of the other
 * homepage rails) while its KPIs are measured with ads off. The window ends when the game has
 * had 7 days and 1,000 plays, or at 14 days, whichever comes first.
 */
export const SPARK_MIN_DAYS = 7;
export const SPARK_MIN_PLAYS = 1000;
export const SPARK_MAX_DAYS = 14;
/** One homepage slot in this many goes to a Spark game. */
export const SPARK_SLOT_INTERVAL = 10;
/** Index of the first Spark slot in a rail (the third tile). */
export const SPARK_FIRST_SLOT = 2;

const DAY = 86_400_000;

export function sparkDays(startedAt: string, now: Date = new Date()): number {
  return Math.max(0, (now.getTime() - new Date(startedAt).getTime()) / DAY);
}

export function isSparkWindowOver(startedAt: string, plays: number, now: Date = new Date()): boolean {
  const days = sparkDays(startedAt, now);
  return days >= SPARK_MAX_DAYS || (days >= SPARK_MIN_DAYS && plays >= SPARK_MIN_PLAYS);
}

/** 0 to 1: how far through its Spark window a game is. */
export function sparkProgress(startedAt: string, plays: number, now: Date = new Date()): number {
  if (isSparkWindowOver(startedAt, plays, now)) return 1;
  const days = sparkDays(startedAt, now);
  const byMax = days / SPARK_MAX_DAYS;
  const byMin = Math.min(days / SPARK_MIN_DAYS, plays / SPARK_MIN_PLAYS);
  return Math.max(0, Math.min(1, Math.max(byMax, byMin)));
}

/** Small deterministic string hash (FNV-1a) for seeded ordering. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface SparkCandidate {
  id: string;
  stats: { plays: number };
}

/**
 * Orders Spark games for exposure: fewest plays first, so every game climbs toward its 1,000
 * plays at a similar pace. Ties (and brand-new games with zero plays) rotate with the seed.
 */
export function orderSparkForExposure<T extends SparkCandidate>(spark: readonly T[], seed: string): T[] {
  return [...spark].sort((a, b) => {
    // Bucket plays so near-equal games shuffle instead of always showing in the same order.
    const bucketA = Math.floor(a.stats.plays / 50);
    const bucketB = Math.floor(b.stats.plays / 50);
    if (bucketA !== bucketB) return bucketA - bucketB;
    return hashString(`${seed}:${a.id}`) - hashString(`${seed}:${b.id}`);
  });
}

/**
 * Gives Spark games 1 in `SPARK_SLOT_INTERVAL` slots of a rail. Spark games already in the rail
 * are left where they are; the rail keeps its length.
 */
export function injectSparkSlots<T extends SparkCandidate>(
  rail: readonly T[],
  spark: readonly T[],
  seed: string,
): T[] {
  if (rail.length === 0 || spark.length === 0) return [...rail];
  const present = new Set(rail.map((g) => g.id));
  const queue = orderSparkForExposure(spark, seed).filter((g) => !present.has(g.id));
  if (queue.length === 0) return [...rail];
  const out = [...rail];
  for (let slot = SPARK_FIRST_SLOT; slot < out.length && queue.length > 0; slot += SPARK_SLOT_INTERVAL) {
    out.splice(slot, 0, queue.shift()!);
  }
  return out.slice(0, rail.length);
}
