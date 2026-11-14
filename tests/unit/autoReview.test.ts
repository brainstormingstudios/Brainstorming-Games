import { describe, expect, it } from 'vitest';
import { hammingHex, runAutoReview, type ReviewInput } from '../../supabase/functions/_shared/autoReview';

const base: ReviewInput = {
  title: 'Moss Garden',
  description: 'Grow a tiny garden one tile at a time.',
  tags: ['puzzle', 'relaxing', 'casual'],
  studioId: 'studio-a',
  declaration: { ownsRights: true, noCopies: true, credits: '' },
  buildFingerprint: 'aaa',
  coverHashes: ['ffff0000ffff0000'],
  preQaProblems: [],
  others: [{ title: 'Rocket Rally', studioId: 'studio-b', buildFingerprints: ['bbb'], coverHashes: ['0000ffff0000ffff'] }],
};
const check = (input: ReviewInput, id: string) => runAutoReview(input).checks.find((c) => c.id === id)?.status;

describe('auto-review', () => {
  it('passes an original game', () => {
    expect(runAutoReview(base).status).toBe('pass');
  });

  it('fails without the rights declaration', () => {
    const r = runAutoReview({ ...base, declaration: { ownsRights: false, noCopies: true, credits: '' } });
    expect(r.status).toBe('fail');
    expect(check({ ...base, declaration: null as never }, 'rights')).toBe('fail');
  });

  it('fails a build identical to another studio’s', () => {
    expect(check({ ...base, buildFingerprint: 'bbb' }, 'copied-build')).toBe('fail');
  });

  it('fails a near-identical cover and passes a different one', () => {
    expect(hammingHex('ffff0000ffff0000', 'ffff0000ffff0001')).toBe(1);
    expect(check({ ...base, coverHashes: ['0000ffff0000fffe'] }, 'copied-cover')).toBe('fail');
    expect(check(base, 'copied-cover')).toBe('pass');
  });

  it('warns on protected names and close titles', () => {
    expect(check({ ...base, title: 'Minecraft Garden' }, 'protected-names')).toBe('warn');
    expect(check({ ...base, title: 'Rocket Rallys' }, 'similar-title')).toBe('warn');
  });

  it('carries outside-code problems from pre-QA', () => {
    expect(check({ ...base, preQaProblems: [{ id: 'external-ads', status: 'fail' }] }, 'outside-code')).toBe('fail');
  });

  it('always leaves the art to a person', () => {
    expect(check(base, 'art')).toBe('manual');
  });
});
