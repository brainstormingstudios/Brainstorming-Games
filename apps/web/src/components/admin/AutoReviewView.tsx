'use client';

import { useTranslations } from 'next-intl';
import { Badge, Card } from '@brainstorming/ui';
import type { AutoReviewReport } from '@/lib/data/devTypes';

const TONE = { pass: 'success', warn: 'warning', fail: 'danger', manual: 'glow' } as const;

/**
 * The automatic moderation report for one submission: rights declaration, copied build or cover,
 * protected names, similar titles, outside ad code and content words. A moderator reads it before
 * playing the game; "manual" rows are the things only a person can judge.
 */
export function AutoReviewView({ report }: { report: AutoReviewReport | null }) {
  const t = useTranslations('admin.autoReview');
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="auto-review">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        {report ? <Badge tone={TONE[report.status]}>{t(`status.${report.status}`)}</Badge> : <Badge>{t('notRun')}</Badge>}
      </div>
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      {report ? (
        <ul className="flex flex-col gap-2">
          {report.checks.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5 rounded-control bg-surface-3 px-3 py-2 text-sm sm:flex-row sm:items-start sm:gap-3" data-testid="auto-check" data-status={c.status}>
              <Badge tone={TONE[c.status]} className="shrink-0 self-start">
                {t(`status.${c.status}`)}
              </Badge>
              <span className="min-w-0">
                <span className="block font-bold">{t(`checks.${c.id}` as 'checks.rights')}</span>
                <span className="text-fg-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
