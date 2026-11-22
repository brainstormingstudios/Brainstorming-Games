import { describe, expect, it } from 'vitest';
import { disguisedName, runAutoReview, textOverlap, type ReviewInput } from '../../supabase/functions/_shared/autoReview';

const base: ReviewInput = {
  title: 'Moss Garden',
  description: 'Grow a tiny garden one tile at a time and watch the moss spread across the old stones.',
  tags: ['puzzle', 'relaxing', 'casual'],
  studioId: 'studio-a',
  declaration: { ownsRights: true, noCopies: true, credits: '' },
  buildFingerprint: 'aaa',
  coverHashes: ['ffff0000ffff0000'],
  preQaProblems: [],
  others: [{ title: 'Rocket Rally', studioId: 'studio-b', buildFingerprints: ['bbb'], coverHashes: ['0000ffff0000ffff'], description: 'Race tiny rockets around the moon and collect fuel cells before your rivals do.' }],
};
const check = (input: ReviewInput, id: string) => runAutoReview(input).checks.find((c) => c.id === id)?.status;

describe('auto-review: disguised names', () => {
  it('catches changed spelling and spacing, but not honest words', () => {
    expect(disguisedName('M1necraft Builder', 'minecraft')).toBe('hidden');
    expect(disguisedName('Mine Craft Builder', 'minecraft')).toBe('hidden');
    expect(disguisedName('Subwaysurfers Run', 'subway surfers')).toBe('hidden');
    expect(disguisedName('Pokemom Catch', 'pokemon')).toBe('close');
    expect(disguisedName('Garden Party', 'pokemon')).toBe(null);
    expect(disguisedName('Minecraf Land', 'minecraft')).toBe('close');
    expect(disguisedName('Among Usual Friends', 'among us')).toBe(null);
    expect(check({ ...base, title: 'M1necraft Garden' }, 'protected-names')).toBe('fail');
    expect(check({ ...base, title: 'Minecraf Garden' }, 'protected-names')).toBe('warn');
    expect(check(base, 'protected-names')).toBe('pass');
  });
});

describe('auto-review: copied assets and text', () => {
  it('fails a build whose art and audio largely match another studio’s game', () => {
    const copied = { ...base, assetCount: 40, assetOverlaps: [{ title: 'Rocket Rally', studioId: 'studio-b', shared: 30 }] };
    expect(check(copied, 'copied-assets')).toBe('fail');
    const pack = { ...base, assetCount: 100, assetOverlaps: [{ title: 'Rocket Rally', studioId: 'studio-b', shared: 26 }] };
    expect(check(pack, 'copied-assets')).toBe('warn');
    expect(check({ ...base, assetCount: 40, assetOverlaps: [] }, 'copied-assets')).toBe('pass');
    // The studio's own other games do not count.
    expect(check({ ...base, assetCount: 40, assetOverlaps: [{ title: 'Moss 2', studioId: 'studio-a', shared: 40 }] }, 'copied-assets')).toBe('pass');
  });

  it('fails a description copied from another studio’s game', () => {
    const copied = { ...base, description: 'Race tiny rockets around the moon and collect fuel cells before your rivals do. Now with more levels.' };
    expect(textOverlap(copied.description, base.others[0]!.description!)).toBeGreaterThan(0.5);
    expect(check(copied, 'copied-text')).toBe('fail');
    expect(check(base, 'copied-text')).toBe('pass');
  });
});

describe('auto-review: page, studio and risk', () => {
  it('warns on an incomplete page and on a studio with rejections', () => {
    const page = { shortDescription: 'A garden game', descriptionMd: 'Short.', howToPlayMd: '', controls: 0, tags: 3 };
    expect(check({ ...base, page }, 'page-complete')).toBe('warn');
    expect(check({ ...base, studio: { createdAt: '2020-01-01T00:00:00Z', rejections: 3, verified: false } }, 'studio-record')).toBe('warn');
  });

  it('scores risk from the checks', () => {
    expect(runAutoReview(base).risk).toBe(0);
    const bad = runAutoReview({ ...base, title: 'M1necraft Garden', buildFingerprint: 'bbb' });
    expect(bad.risk).toBeGreaterThanOrEqual(80);
  });
});
