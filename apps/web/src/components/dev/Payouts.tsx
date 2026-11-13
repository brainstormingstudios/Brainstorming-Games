'use client';

import { useTranslations } from 'next-intl';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, SelectField, Skeleton, TextField, useToast } from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import type { PayoutMethod, PayoutProfileInput, RevenueMonthRow } from '@/lib/data/repo';
import { formatMoney, THRESHOLD_MINOR, type Currency } from '@/lib/domain/revenue';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useLocale } from '@/i18n/navigation';
import { useDev } from './DevShell';

const download = async (row: RevenueMonthRow) => (await import('@/lib/revenue/statementPdf')).downloadStatement(row);

/** The developer's statements, payouts and payout details. */
export function PayoutsPage() {
  const t = useTranslations('dev.payouts');
  const tc = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const { studio } = useDev();
  const statements = useRepoQuery((repo) => repo.revenue.myStatements(), [], { topics: ['revenue'] });
  const payouts = useRepoQuery((repo) => repo.revenue.myPayouts(), [], { topics: ['revenue'] });
  const profile = useRepoQuery((repo) => repo.revenue.payoutProfile(), [], { topics: ['revenue'] });
  const [form, setForm] = useState<PayoutProfileInput>({ method: 'bank', currency: 'INR', accountName: studio.guardianName ?? '', details: {} });
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await (await getRepo()).revenue.savePayoutProfile(form);
      toast(t('saved'), { tone: 'success' });
      setForm({ ...form, details: {} });
    } catch (err) {
      setError(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'));
    }
  };
  const field = (key: string, label: string, props: Record<string, unknown> = {}) => (
    <TextField label={label} value={form.details[key] ?? ''} onChange={(e) => setForm({ ...form, details: { ...form.details, [key]: e.target.value } })} {...props} />
  );

  return (
    <div className="flex flex-col gap-5" data-testid="payouts-page">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="text-sm text-fg-muted">
        {t('intro', { inr: formatMoney(THRESHOLD_MINOR.INR, 'INR'), usd: formatMoney(THRESHOLD_MINOR.USD, 'USD') })}
      </p>
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('profile')}</h2>
        {profile.data ? (
          <p className="text-sm">
            <span className="font-bold">{profile.data.summary}</span> · {profile.data.currency} · {formatDate(profile.data.updatedAt, locale)}
          </p>
        ) : (
          <p className="text-sm text-fg-muted">{t('noProfile')}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label={t('method')}
            value={form.method}
            onChange={(e) => {
              const method = e.target.value as PayoutMethod;
              setForm({ ...form, method, currency: method === 'bank' ? 'INR' : form.currency, details: {} });
            }}
            options={(['bank', 'paypal', 'wise', 'payoneer'] as const).map((m) => ({ value: m, label: t(`methods.${m}`) }))}
          />
          <SelectField
            label={t('currency')}
            value={form.currency}
            disabled={form.method === 'bank'}
            onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
            options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]}
          />
          <TextField label={studio.guardianName ? t('guardianName') : t('accountName')} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
          {form.method === 'bank' ? (
            <>
              {field('accountNumber', t('accountNumber'), { inputMode: 'numeric', autoComplete: 'off' })}
              {field('ifsc', t('ifsc'), { autoComplete: 'off' })}
            </>
          ) : (
            field('email', t('accountEmail'), { type: 'email' })
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm font-bold text-danger">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-fg-muted">{t('encrypted')}</p>
        <Button className="self-start" onClick={() => void save()}>
          {t('save')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('statements')}</h2>
        {statements.loading && !statements.data ? (
          <Skeleton className="h-24 w-full" />
        ) : (statements.data ?? []).length === 0 ? (
          <EmptyState title={t('noStatements')} size="sm" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(statements.data ?? []).map((s) => (
              <li key={s.month} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="statement-row">
                <span className="font-bold">{s.month}</span>
                <span>{t('earned', { amount: formatMoney(s.earned, s.currency) })}</span>
                <span className="font-bold">{t('due', { amount: formatMoney(s.payoutDue, s.currency) })}</span>
                <Badge tone={s.status === 'paid' ? 'success' : s.status === 'rolled_over' ? 'warning' : 'primary'}>{t(`status.${s.status}`)}</Badge>
                <Button size="sm" variant="ghost" icon={<FileDown aria-hidden="true" className="size-4" />} onClick={() => void download(s)}>
                  {t('pdf')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('payouts')}</h2>
        {(payouts.data ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">{t('noPayouts')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {(payouts.data ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap gap-3 py-2">
                <span className="font-bold">{formatMoney(p.amount, p.currency)}</span>
                <span>{t(`methods.${p.method}`)}</span>
                <span className="text-fg-muted">{p.months.join(', ')}</span>
                <span className="text-fg-muted">{formatDate(p.paidAt, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
