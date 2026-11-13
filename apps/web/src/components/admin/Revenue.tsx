'use client';

import { useTranslations } from 'next-intl';
import { FileDown, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, SelectField, Skeleton, TextAreaField, TextField, useToast } from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import type { PayoutMethod, RevenueMonthRow } from '@/lib/data/repo';
import { computeRevenue, formatMoney, parseRevenueCsv, type Currency, type RevenueRun } from '@/lib/domain/revenue';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

const download = async (row: RevenueMonthRow) => (await import('@/lib/revenue/statementPdf')).downloadStatement(row);

/**
 * Admin revenue console: upload the month's ad revenue CSV, preview the split, finalise it into
 * statements, download PDFs and record payouts.
 */
export function RevenueAdmin() {
  const t = useTranslations('admin.revenue');
  const tc = useTranslations('common');
  const toast = useToast();
  const [month, setMonth] = useState(lastMonth());
  const [currency, setCurrency] = useState<Currency>('USD');
  const [fx, setFx] = useState('');
  const [csv, setCsv] = useState('country,gross,refunds,invalid_traffic\n');
  const [run, setRun] = useState<RevenueRun | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const months = useRepoQuery((repo) => repo.revenue.months(), [], { topics: ['revenue'] });
  const payouts = useRepoQuery((repo) => repo.revenue.payouts(), [], { topics: ['revenue'] });
  const [payout, setPayout] = useState<{ studioId: string; method: PayoutMethod; reference: string }>({ studioId: '', method: 'bank', reference: '' });

  const fail = (err: unknown) => toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });

  const preview = async () => {
    const parsed = parseRevenueCsv(csv);
    setErrors(parsed.errors);
    if (parsed.errors.length || parsed.rows.length === 0) return setRun(null);
    try {
      const repo = await getRepo();
      const inputs = await repo.revenue.inputs(month);
      setRun(computeRevenue({ month, currency, rows: parsed.rows, games: inputs.games, countryWeights: inputs.weights, carry: inputs.carry }));
    } catch (err) {
      fail(err);
    }
  };

  const finalise = async () => {
    if (!run) return;
    try {
      await (await getRepo()).revenue.finalise(run, parseRevenueCsv(csv).rows, fx ? Number(fx) : null);
      toast(t('finalised'), { tone: 'success' });
      setRun(null);
    } catch (err) {
      fail(err);
    }
  };

  const due = useMemo(() => (months.data ?? []).filter((m) => m.status === 'finalised'), [months.data]);
  const studios = [...new Map(due.map((m) => [m.studioId, m.studioName])).entries()];

  return (
    <div className="flex flex-col gap-6" data-testid="revenue-admin">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('upload')}</h2>
        <p className="text-sm text-fg-muted">{t('uploadHint')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label={t('month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <SelectField label={t('currency')} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={[{ value: 'USD', label: 'USD' }, { value: 'INR', label: 'INR' }]} />
          <TextField label={t('fx')} inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-bold text-link">
          <Upload aria-hidden="true" className="size-4" />
          {t('chooseCsv')}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void e.target.files?.[0]?.text().then(setCsv)} />
        </label>
        <TextAreaField label="CSV" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono" data-testid="revenue-csv" />
        {errors.length ? (
          <ul role="alert" className="list-disc pl-5 text-sm text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <Button className="self-start" onClick={() => void preview()} data-testid="revenue-preview">
          {t('preview')}
        </Button>
      </Card>

      {run ? (
        <Card className="flex flex-col gap-3 p-4" data-testid="revenue-run">
          <h2 className="text-xl font-semibold">{t('previewTitle', { month: run.month })}</h2>
          <p className="text-sm">
            {t('totals', {
              gross: formatMoney(run.totals.gross, run.currency),
              net: formatMoney(run.totals.net, run.currency),
              unattributed: formatMoney(run.totals.unattributed, run.currency),
            })}
          </p>
          {run.statements.length === 0 ? <EmptyState title={t('noImpressions')} size="sm" /> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  {['studio', 'net', 'share', 'earned', 'carry', 'due'].map((h) => (
                    <th key={h} scope="col" className="px-2 py-1 font-display">
                      {t(`cols.${h}` as 'cols.studio')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.statements.map((s) => (
                  <tr key={s.studioId} className="border-t border-border" data-testid="revenue-statement">
                    <td className="px-2 py-1 font-bold">{s.studioName}</td>
                    <td className="px-2 py-1">{formatMoney(s.net, s.currency)}</td>
                    <td className="px-2 py-1">{s.sharePct}%</td>
                    <td className="px-2 py-1">{formatMoney(s.earned, s.currency)}</td>
                    <td className="px-2 py-1">{formatMoney(s.carryIn, s.currency)}</td>
                    <td className="px-2 py-1 font-bold">
                      {formatMoney(s.payoutDue, s.currency)} {s.belowThreshold ? <Badge tone="warning">{t('rollsOver')}</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button className="self-start" onClick={() => void finalise()} data-testid="revenue-finalise">
            {t('finalise')}
          </Button>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('statements')}</h2>
        {months.loading && !months.data ? (
          <Skeleton className="h-32 w-full" />
        ) : (months.data ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">{t('none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(months.data ?? []).map((m) => (
              <li key={`${m.studioId}-${m.month}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-bold">{m.month}</span>
                <span>{m.studioName}</span>
                <span>{formatMoney(m.payoutDue, m.currency)}</span>
                <Badge tone={m.status === 'paid' ? 'success' : m.status === 'rolled_over' ? 'warning' : 'primary'}>{t(`status.${m.status}`)}</Badge>
                <Button size="sm" variant="ghost" icon={<FileDown aria-hidden="true" className="size-4" />} onClick={() => void download(m)}>
                  PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('recordPayout')}</h2>
        {studios.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('nothingDue')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            <SelectField label={t('cols.studio')} placeholder="…" value={payout.studioId} onChange={(e) => setPayout({ ...payout, studioId: e.target.value })} options={studios.map(([id, name]) => ({ value: id, label: name }))} />
            <SelectField
              label={t('method')}
              value={payout.method}
              onChange={(e) => setPayout({ ...payout, method: e.target.value as PayoutMethod })}
              options={(['bank', 'paypal', 'wise', 'payoneer'] as const).map((m) => ({ value: m, label: t(`methods.${m}`) }))}
            />
            <TextField label={t('reference')} value={payout.reference} onChange={(e) => setPayout({ ...payout, reference: e.target.value })} />
            <Button
              className="self-end"
              disabled={!payout.studioId}
              onClick={() =>
                void getRepo()
                  .then((repo) => repo.revenue.recordPayout(payout.studioId, due.filter((m) => m.studioId === payout.studioId).map((m) => m.month), payout.method, payout.reference))
                  .then(() => toast(t('paid'), { tone: 'success' }))
                  .catch(fail)
              }
            >
              {t('markPaid')}
            </Button>
          </div>
        )}
        {(payouts.data ?? []).length ? (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {(payouts.data ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap gap-3 py-2">
                <span className="font-bold">{p.studioName}</span>
                <span>{formatMoney(p.amount, p.currency)}</span>
                <span>{t(`methods.${p.method}`)}</span>
                <span className="text-fg-muted">{p.reference}</span>
                <span className="text-fg-muted">{p.months.join(', ')}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
