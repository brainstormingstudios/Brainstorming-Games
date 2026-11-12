'use client';

import { useTranslations } from 'next-intl';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Badge, cn } from '@brainstorming/ui';
import type { CheckStatus, PreQaReport } from '@/lib/domain/preqa';
import { formatBytes } from '@/lib/format';

const ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX } as const;
const TONE = { pass: 'success', warn: 'warning', fail: 'danger' } as const;
const COLOUR: Record<CheckStatus, string> = { pass: 'text-success', warn: 'text-warning', fail: 'text-danger' };

/** The pre-QA checklist with a fix for every problem, plus the two device runs. */
export function PreQaReportView({ report }: { report: PreQaReport }) {
  const t = useTranslations('dev.report');
  return (
    <div className="flex flex-col gap-3" data-testid="pre-qa-report" data-status={report.status}>
      <p className="flex items-center gap-2 font-bold">
        <Badge tone={TONE[report.status]}>{t(report.status)}</Badge>
        <span className="text-sm text-fg-muted">{new Date(report.ranAt).toLocaleString()}</span>
      </p>
      <ul className="flex flex-col gap-2">
        {report.checks.map((c) => {
          const Icon = ICON[c.status];
          return (
            <li key={c.id} className="flex gap-2.5 rounded-control border border-border bg-surface-3 p-3" data-check={c.id} data-check-status={c.status}>
              <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', COLOUR[c.status])} />
              <div className="min-w-0 text-sm">
                <p className="font-bold">
                  {c.label} <span className="sr-only">({t(c.status)})</span>
                </p>
                <p className="break-words text-fg-muted">{c.detail}</p>
                {c.fix ? (
                  <p className="mt-1">
                    <span className="font-bold">{t('fix')}: </span>
                    {c.fix}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['desktop', 'mobile'] as const).map((device) => {
          const run = report[device];
          if (!run) return null;
          return (
            <figure key={device} className="rounded-control border border-border bg-surface-3 p-3 text-sm">
              {run.screenshot ? <img src={run.screenshot} alt="" className="mb-2 w-full rounded-control border border-border" /> : null}
              <figcaption>
                <p className="font-bold">{t(device)}</p>
                <p className="text-fg-muted">
                  {t('timeToGameplay')}: {run.timeToGameplayMs == null ? '–' : `${(run.timeToGameplayMs / 1000).toFixed(1)} s`}
                </p>
                <p className="text-fg-muted">
                  {t('initialDownload')}: {formatBytes(run.initialBytes)}
                </p>
                <p className="text-fg-muted">
                  {t('events')}: {run.events.length ? run.events.join(', ') : t('none')}
                </p>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
