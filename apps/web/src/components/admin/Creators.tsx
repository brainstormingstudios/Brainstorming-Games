'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, SelectField, Skeleton, Tabs, TextField } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import type { AdminCreatorRow, CreatorStatus } from '@/lib/data/creatorTypes';
import type { PayoutMethod } from '@/lib/data/repo';
import { formatMoney } from '@/lib/domain/revenue';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

const TONE: Record<CreatorStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { pending: 'warning', approved: 'success', rejected: 'neutral', suspended: 'danger' };

function CreatorCard({ c }: { c: AdminCreatorRow }) {
  const t = useTranslations('admin.creators');
  const locale = useLocale();
  const act = useAct();
  const [note, setNote] = useState('');
  const decide = (decision: 'approve' | 'reject' | 'suspend', done: string) => void act(async () => (await getRepo()).creators.decide(c.id, decision, note), done);
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm" data-testid="admin-creator-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-semibold">@{c.handle}</span>
        <span className="text-fg-muted">{c.displayName}</span>
        <Badge tone={TONE[c.status]}>{t(`status.${c.status}`)}</Badge>
        <span className="ml-auto text-fg-muted">
          {c.username ?? '–'} · {c.email ?? '–'} · {formatDate(c.createdAt, locale)}
        </span>
      </div>
      <ul className="flex flex-wrap gap-3">
        {c.channels.map((ch) => (
          <li key={ch.url}>
            <a href={ch.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-primary hover:underline">
              {t(`kinds.${ch.kind}`)} <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
      <p className="whitespace-pre-wrap">{c.about}</p>
      {c.reviewNote ? <p className="text-fg-muted">{t('lastNote', { note: c.reviewNote })}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={t('note')} className="min-w-60 flex-1" value={note} onChange={(e) => setNote(e.target.value)} data-testid="admin-creator-note" />
        {c.status !== 'approved' ? (
          <Button size="sm" onClick={() => decide('approve', t('approved'))} data-testid="admin-creator-approve">
            {t('approve')}
          </Button>
        ) : null}
        {c.status === 'pending' ? (
          <Button size="sm" variant="secondary" disabled={note.trim().length < 3} onClick={() => decide('reject', t('rejected'))}>
            {t('reject')}
          </Button>
        ) : null}
        {c.status === 'approved' ? (
          <Button size="sm" variant="danger" disabled={note.trim().length < 3} onClick={() => decide('suspend', t('suspended'))}>
            {t('suspend')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function CreatorList({ status }: { status: CreatorStatus | 'all' }) {
  const t = useTranslations('admin.creators');
  const list = useRepoQuery((repo) => repo.creators.list(status), [status], { topics: ['creators'] });
  if (list.loading && !list.data) return <Skeleton className="h-40 w-full" />;
  if ((list.data ?? []).length === 0) return <EmptyState title={t('empty')} size="sm" />;
  return (
    <div className="flex flex-col gap-3">
      {(list.data ?? []).map((c) => (
        <CreatorCard key={`${c.id}:${c.status}`} c={c} />
      ))}
    </div>
  );
}

function CreatorPayouts() {
  const t = useTranslations('admin.creators');
  const tp = useTranslations('dev.payouts');
  const act = useAct();
  const months = useRepoQuery((repo) => repo.creators.months(), [], { topics: ['creators', 'revenue'] });
  const payouts = useRepoQuery((repo) => repo.creators.payouts(), [], { topics: ['creators'] });
  const [method, setMethod] = useState<PayoutMethod>('bank');
  const [reference, setReference] = useState('');
  const due = (months.data ?? []).filter((m) => m.status === 'finalised');
  const byCreator = new Map<string, typeof due>();
  for (const m of due) byCreator.set(m.creatorId, [...(byCreator.get(m.creatorId) ?? []), m]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t('payoutsIntro')}</p>
      {byCreator.size === 0 ? <EmptyState title={t('nothingDue')} size="sm" /> : null}
      {[...byCreator.entries()].map(([creatorId, rows]) => (
        <Card key={creatorId} className="flex flex-wrap items-end gap-3 p-3 text-sm" data-testid="admin-creator-due">
          <span className="min-w-40 flex-1">
            <span className="block font-bold">@{rows[0]!.handle}</span>
            <span className="text-fg-muted">
              {rows.map((r) => r.month).join(', ')} · {formatMoney(rows.reduce((n, r) => n + r.payoutDue, 0), rows[0]!.currency)}
            </span>
          </span>
          <SelectField label={tp('method')} className="w-36" value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)} options={(['bank', 'paypal', 'wise', 'payoneer'] as const).map((m) => ({ value: m, label: tp(`methods.${m}`) }))} />
          <TextField label={t('reference')} className="w-48" value={reference} onChange={(e) => setReference(e.target.value)} />
          <Button
            size="sm"
            onClick={() =>
              void act(
                async () =>
                  (await getRepo()).creators.recordPayout(
                    creatorId,
                    rows.map((r) => r.month),
                    method,
                    reference,
                  ),
                t('paid'),
              )
            }
          >
            {t('recordPayout')}
          </Button>
        </Card>
      ))}
      {(payouts.data ?? []).length > 0 ? (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {(payouts.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap gap-3 py-2">
              <span className="font-bold">@{p.handle}</span>
              <span>{formatMoney(p.amount, p.currency)}</span>
              <span className="text-fg-muted">{p.months.join(', ')}</span>
              <span className="text-fg-muted">{p.reference}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Creator applications, approved creators, and their monthly payouts. */
export function CreatorsAdmin() {
  const t = useTranslations('admin.creators');
  const [tab, setTab] = useState('pending');
  return (
    <div className="flex flex-col gap-4" data-testid="creators-admin">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <Tabs
        label={t('title')}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pending', label: t('tabPending'), content: <CreatorList status="pending" /> },
          { id: 'approved', label: t('tabApproved'), content: <CreatorList status="approved" /> },
          { id: 'all', label: t('tabAll'), content: <CreatorList status="all" /> },
          { id: 'payouts', label: t('tabPayouts'), content: <CreatorPayouts /> },
        ]}
      />
    </div>
  );
}
