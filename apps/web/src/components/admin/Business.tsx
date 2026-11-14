'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, SelectField, Skeleton, TextAreaField } from '@brainstorming/ui';
import { BOOST_TONE, BoostLinks } from '@/components/billing/BoostPage';
import { useLocale } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import type { BoostOrder } from '@/lib/data/billingTypes';
import { BOOSTS, formatInr } from '@/lib/domain/premium';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

const STATUSES: BoostOrder['status'][] = ['paid', 'live', 'done', 'cancelled'];

function BoostRow({ order }: { order: BoostOrder }) {
  const t = useTranslations('admin.promotions');
  const tb = useTranslations('boost');
  const locale = useLocale();
  const act = useAct();
  const [shorts, setShorts] = useState(order.shortUrls.join('\n'));
  const [reels, setReels] = useState(order.reelUrls.join('\n'));
  const [notes, setNotes] = useState(order.notes);
  const def = BOOSTS[order.package];
  const lines = (v: string) => v.split(/\s+/).filter(Boolean);
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="promotion-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-bold">{order.gameTitle}</span>
        <span className="text-sm text-fg-muted">{order.studioName}</span>
        <Badge>{tb(`packages.${order.package}`)}</Badge>
        <Badge tone={BOOST_TONE[order.status]}>{tb(`status.${order.status}`)}</Badge>
        <span className="ml-auto text-sm font-bold">{formatInr(order.amount)}</span>
      </div>
      <p className="text-sm text-fg-muted">
        {t('todo', { shorts: def.shorts, reels: def.reels })}
        {order.startsAt && order.endsAt ? ` · ${tb('window', { from: formatDate(order.startsAt, locale), to: formatDate(order.endsAt, locale) })}` : ''}
      </p>
      <BoostLinks order={order} />
      <div className="grid gap-3 md:grid-cols-2">
        <TextAreaField label={t('shortLinks')} hint={t('oneLink')} rows={3} value={shorts} onChange={(e) => setShorts(e.target.value)} data-testid="short-links" />
        <TextAreaField label={t('reelLinks')} hint={t('oneLink')} rows={3} value={reels} onChange={(e) => setReels(e.target.value)} data-testid="reel-links" />
      </div>
      <TextAreaField label={t('notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          label={t('status')}
          className="w-48"
          value={order.status}
          onChange={(e) => {
            const status = e.target.value as BoostOrder['status'];
            void act(async () => (await getRepo()).billing.updateBoost(order.id, { status }), t('saved'));
          }}
          options={STATUSES.map((s) => ({ value: s, label: tb(`status.${s}`) }))}
        />
        <Button onClick={() => void act(async () => (await getRepo()).billing.updateBoost(order.id, { shortUrls: lines(shorts), reelUrls: lines(reels), notes }), t('saved'))} data-testid="save-links">
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

/** Boost orders to fulfil: make and post the videos, then add the links (the studio is e-mailed). */
export function PromotionsAdmin() {
  const t = useTranslations('admin.promotions');
  const orders = useRepoQuery((repo) => repo.billing.boosts(), [], { topics: ['revenue', 'catalogue'] });
  return (
    <div className="flex flex-col gap-4" data-testid="promotions-admin">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-fg-muted">{t('intro')}</p>
      </div>
      {orders.loading && !orders.data ? <Skeleton className="h-40 w-full" /> : null}
      {(orders.data ?? []).length === 0 && !orders.loading ? <EmptyState title={t('empty')} size="sm" /> : null}
      {(orders.data ?? []).map((o) => (
        <BoostRow key={`${o.id}:${o.shortUrls.length}:${o.reelUrls.length}:${o.status}`} order={o} />
      ))}
    </div>
  );
}

/** Every payment, and the totals that matter. */
export function PaymentsAdmin() {
  const t = useTranslations('admin.payments');
  const locale = useLocale();
  const rows = useRepoQuery((repo) => repo.billing.payments(), [], { topics: ['revenue'] });
  const paid = (rows.data ?? []).filter((r) => r.status === 'paid');
  const month = new Date().toISOString().slice(0, 7);
  const sum = (list: typeof paid) => list.reduce((n, r) => n + r.amount, 0);
  return (
    <div className="flex flex-col gap-4" data-testid="payments-admin">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <dl className="stat-grid">
        {[
          ['month', formatInr(sum(paid.filter((r) => r.createdAt.startsWith(month))))],
          ['premium', formatInr(sum(paid.filter((r) => r.kind === 'premium')))],
          ['boost', formatInr(sum(paid.filter((r) => r.kind === 'boost')))],
          ['count', String(paid.length)],
        ].map(([k, v]) => (
          <div key={k} className="stat">
            <dt>{t(`stats.${k}`)}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {rows.loading && !rows.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (rows.data ?? []).length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-left">
              <tr>
                {(['when', 'what', 'who', 'amount', 'status', 'reference'] as const).map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-display">
                    {t(`cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border" data-testid="payment-row">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.createdAt, locale)}</td>
                  <td className="px-3 py-2">{r.what}</td>
                  <td className="px-3 py-2">{r.who}</td>
                  <td className="px-3 py-2 font-bold tabular-nums">{formatInr(r.amount)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === 'paid' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{t(`status.${r.status}`)}</Badge>
                    {r.provider === 'test' ? <Badge className="ml-1">{t('test')}</Badge> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The automated e-mails: what went out, to whom, and whether it arrived at Gmail. */
export function EmailsAdmin() {
  const t = useTranslations('admin.emails');
  const locale = useLocale();
  const rows = useRepoQuery((repo) => repo.billing.emails(), [], { topics: ['admin', 'qa', 'revenue', 'session'] });
  return (
    <div className="flex flex-col gap-4" data-testid="emails-admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="max-w-3xl text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button variant="outline" onClick={() => rows.refresh()}>
          {t('refresh')}
        </Button>
      </div>
      {rows.loading && !rows.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (rows.data ?? []).length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-left">
              <tr>
                {(['when', 'to', 'subject', 'status'] as const).map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-display">
                    {t(`cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border" data-testid="email-row">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.createdAt, locale)}</td>
                  <td className="px-3 py-2">{r.to}</td>
                  <td className="px-3 py-2">{r.subject}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'} title={r.error ?? undefined}>
                      {t(`status.${r.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
