import type { GameEditable } from '@/lib/data/devTypes';

/**
 * The fields of a released game that only change after review (mirror of app.held_columns() in
 * 0021_security_live_games.sql). Anything players read on the game page is here, so a reviewed
 * page cannot be swapped for a different one.
 */
export const HELD_FIELDS = [
  'title',
  'shortDescription',
  'descriptionMd',
  'howToPlayMd',
  'controls',
  'faq',
  'featuresMd',
  'tipsMd',
  'category',
  'tags',
  'maxScorePerSec',
] as const satisfies readonly (keyof GameEditable)[];

export type HeldField = (typeof HELD_FIELDS)[number];

/** Database column for each held field. */
export const HELD_COLUMNS: Record<HeldField, string> = {
  title: 'title',
  shortDescription: 'short_description',
  descriptionMd: 'description_md',
  howToPlayMd: 'how_to_play_md',
  controls: 'controls',
  faq: 'faq',
  featuresMd: 'features_md',
  tipsMd: 'tips_md',
  category: 'category',
  tags: 'tags',
  maxScorePerSec: 'max_score_per_sec',
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Splits a patch for a released game: the held fields that differ from the live values go to
 * review, the rest applies now. Held fields equal to the live value are left out (the held edit
 * keeps whatever it already had for them).
 */
export function splitLivePatch<T extends Partial<GameEditable>>(live: Partial<GameEditable>, patch: T): { now: Partial<GameEditable>; held: Partial<Record<HeldField, unknown>> } {
  const now: Partial<GameEditable> = {};
  const held: Partial<Record<HeldField, unknown>> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if ((HELD_FIELDS as readonly string[]).includes(k)) {
      if (!sameValue(v, live[k as HeldField])) held[k as HeldField] = v;
    } else {
      (now as Record<string, unknown>)[k] = v;
    }
  }
  return { now, held };
}
