import { describe, expect, it } from 'vitest';
import { harmfulReason, type PreQaCheck } from '@/lib/domain/preqa';
import { autoRejectReason, type AutoReviewReport } from '../../supabase/functions/_shared/autoReview';

const review = (checks: AutoReviewReport['checks']): AutoReviewReport => ({ status: 'fail', checks, ranAt: '2026-11-22T00:00:00Z', risk: 50 });

describe('automatic rejection of clear copies', () => {
  it('rejects on a failed copy or rights check, with the reasons', () => {
    const reason = autoRejectReason(
      review([
        { id: 'copied-build', status: 'fail', detail: 'Another studio already published this exact build.' },
        { id: 'similar-title', status: 'warn', detail: 'Close to another title.' },
      ]),
    );
    expect(reason).toMatch(/^Rejected automatically: Another studio already published this exact build\./);
    expect(reason).not.toContain('Close to another title');
  });

  it('leaves borderline findings and other failures to a person', () => {
    expect(autoRejectReason(review([{ id: 'protected-names', status: 'warn', detail: 'One letter off.' }]))).toBeNull();
    expect(autoRejectReason(review([{ id: 'outside-code', status: 'fail', detail: 'Ad network.' }]))).toBeNull();
  });
});

describe('automatic rejection of harmful code', () => {
  const check = (id: string, status: PreQaCheck['status'], label: string): PreQaCheck => ({ id, status, label, detail: 'found', fix: null });

  it('rejects mining, password fields and outside ad networks', () => {
    expect(harmfulReason({ checks: [check('no-mining', 'fail', 'No crypto-mining')] })).toBe('Rejected automatically: the test-play found crypto-mining (found).');
    expect(harmfulReason({ checks: [check('external-ads', 'fail', 'No external ads')] })).not.toBeNull();
  });

  it('ignores warnings and harmless failures such as slow loading', () => {
    expect(harmfulReason({ checks: [check('no-credentials', 'warn', 'No password fields')] })).toBeNull();
    expect(harmfulReason({ checks: [check('time-to-gameplay', 'fail', 'Reaches gameplay within 20 s')] })).toBeNull();
  });
});
