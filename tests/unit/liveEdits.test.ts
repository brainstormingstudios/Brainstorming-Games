import { describe, expect, it } from 'vitest';
import { HELD_COLUMNS, HELD_FIELDS, splitLivePatch } from '@/lib/domain/liveEdits';

describe('live edits', () => {
  it('holds what players read and applies the rest now', () => {
    const live = { title: 'Live', tags: ['a', 'b', 'c'], orientation: 'landscape' as const };
    const { now, held } = splitLivePatch(live, { title: 'Free gems!', tags: ['a', 'b', 'c'], orientation: 'portrait' });
    expect(held).toEqual({ title: 'Free gems!' });
    expect(now).toEqual({ orientation: 'portrait' });
  });

  it('matches the database list of held columns', () => {
    // Mirror of app.held_columns() in 0021_security_live_games.sql.
    expect(HELD_FIELDS.map((f) => HELD_COLUMNS[f])).toEqual([
      'title', 'short_description', 'description_md', 'how_to_play_md', 'controls', 'faq',
      'features_md', 'tips_md', 'category', 'tags', 'max_score_per_sec',
    ]);
  });
});
