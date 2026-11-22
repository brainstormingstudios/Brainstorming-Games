'use client';

import { useTranslations } from 'next-intl';
import { Copy, Share2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, SelectField, Skeleton, TextField, buttonClass, useToast } from '@brainstorming/ui';
import { Link, useLocale } from '@/i18n/navigation';
import { SITE_URL } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import { CREATOR_SHARE_PCT, type Creator } from '@/lib/data/creatorTypes';
import type { PayoutMethod, PayoutProfileInput } from '@/lib/data/repo';
import { formatMoney, THRESHOLD_MINOR, type Currency } from '@/lib/domain/revenue';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { TrailerButton } from './TrailerButton';
import { PendingPayoutChange, ReauthPrompt, needsReauth } from '@/components/account/PayoutSafety';
import { OPEN_PAYOUT_METHODS } from '@/lib/domain/payoutProfile';

/** `${SITE_URL}/game/slug/?cr=handle`: every link a creator shares carries their handle. */
export const creatorLink = (handle: string, slug?: string) => `${SITE_URL}${slug ? `/game/${slug}/` : '/'}?cr=${handle}`;

function CopyLink({ url, testId }: { url: string; testId?: string }) {
  const t = useTranslations('creators.dashboard');
  const toast = useToast();
  const share = async () => {
    if (navigator.share) await navigator.share({ url }).catch(() => {});
    else await navigator.clipboard.writeText(url).then(() => toast(t('copied'), { tone: 'success' }));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 rounded-control bg-surface-3 px-3 py-2 text-sm break-all" data-testid={testId}>
        {url}
      </code>
      <Button size="sm" variant="secondary" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void navigator.clipboard.writeText(url).then(() => toast(t('copied'), { tone: 'success' }))}>
        {t('copy')}
      </Button>
      <Button size="sm" variant="outline" icon={<Share2 aria-hidden="true" className="size-4" />} onClick={() => void share()}>
        {t('share')}
      </Button>
    </div>
  );
}

function PayoutDetails() {
  const t = useTranslations('dev.payouts');
  const tc = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const profile = useRepoQuery((repo) => repo.creators.payoutProfile(), [], { topics: ['creators'] });
  const [form, setForm] = useState<PayoutProfileInput>({ method: 'bank', currency: 'INR', accountName: '', details: {} });
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const save = async () => {
    setError(null);
    try {
      await (await getRepo()).creators.savePayoutProfile(form);
      toast(t('savedOnHold'), { tone: 'success' });
      setForm({ ...form, details: {} });
    } catch (err) {
      if (needsReauth(err)) setReauth(true);
      else setError(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'));
    }
  };
  const field = (key: string, label: string, props: Record<string, unknown> = {}) => (
    <TextField label={label} value={form.details[key] ?? ''} onChange={(e) => setForm({ ...form, details: { ...form.details, [key]: e.target.value } })} {...props} />
  );
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="creator-payout-profile">
      <h2 className="text-xl font-semibold">{t('profile')}</h2>
      {profile.data?.summary ? (
        <p className="text-sm">
          <span className="font-bold">{profile.data.summary}</span> · {profile.data.currency} · {formatDate(profile.data.updatedAt, locale)}
        </p>
      ) : (
        <p className="text-sm text-fg-muted">{t('noProfile')}</p>
      )}
      <PendingPayoutChange profile={profile.data} onCancel={async () => (await getRepo()).creators.cancelPayoutChange()} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t('method')}
          value={form.method}
          onChange={(e) => {
            const method = e.target.value as PayoutMethod;
            setForm({ ...form, method, currency: method === 'bank' ? 'INR' : form.currency, details: {} });
          }}
          options={OPEN_PAYOUT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
        />
        <SelectField
          label={t('currency')}
          value={form.currency}
          disabled={form.method === 'bank'}
          onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
          options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]}
        />
        <TextField label={t('accountName')} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
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
      {reauth ? (
        <ReauthPrompt
          onClose={() => setReauth(false)}
          onDone={() => {
            setReauth(false);
            void save();
          }}
        />
      ) : (
        <Button className="self-start" onClick={() => void save()} data-testid="payout-save">
          {t('save')}
        </Button>
      )}
    </Card>
  );
}

function Approved({ creator }: { creator: Creator }) {
  const t = useTranslations('creators.dashboard');
  const tp = useTranslations('dev.payouts');
  const locale = useLocale();
  const [days, setDays] = useState(30);
  const stats = useRepoQuery((repo) => repo.creators.stats(days), [days], { topics: ['creators'] });
  const games = useRepoQuery((repo) => repo.catalogue.list({ sort: 'popular', limit: 200 }).then((p) => p.items), [], { topics: ['catalogue'] });
  const statements = useRepoQuery((repo) => repo.creators.myStatements(), [], { topics: ['creators'] });
  const payouts = useRepoQuery((repo) => repo.creators.myPayouts(), [], { topics: ['creators'] });
  const [slug, setSlug] = useState('');
  const picked = useMemo(() => (games.data ?? []).find((g) => g.slug === slug) ?? (games.data ?? [])[0] ?? null, [games.data, slug]);

  const cards = [
    { key: 'visitors', value: stats.data?.visitors },
    { key: 'plays', value: stats.data?.plays },
    { key: 'adImpressions', value: stats.data?.adImpressions },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{t('linksTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('linksIntro', { pct: CREATOR_SHARE_PCT })}</p>
        <p className="text-sm font-bold">{t('homeLink')}</p>
        <CopyLink url={creatorLink(creator.handle)} testId="creator-home-link" />
        {games.data && games.data.length > 0 ? (
          <>
            <SelectField
              label={t('pickGame')}
              value={picked?.slug ?? ''}
              onChange={(e) => setSlug(e.target.value)}
              options={games.data.map((g) => ({ value: g.slug, label: g.title }))}
              data-testid="creator-game-pick"
            />
            {picked ? (
              <>
                <CopyLink url={creatorLink(creator.handle, picked.slug)} testId="creator-game-link" />
                <TrailerButton game={{ slug: picked.slug, title: picked.title, previewUrl: picked.preview?.url ?? null }} link={creatorLink(creator.handle, picked.slug)} />
              </>
            ) : null}
          </>
        ) : null}
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="creator-stats">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="creator-stats" className="text-xl font-semibold">
            {t('statsTitle')}
          </h2>
          <SelectField
            label={t('period')}
            hideLabel
            className="w-40"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            options={[7, 30, 90].map((d) => ({ value: String(d), label: t('lastDays', { days: d }) }))}
          />
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {cards.map((c) => (
            <Card key={c.key} className="p-3">
              <dt className="text-xs font-bold text-fg-muted uppercase">{t(c.key)}</dt>
              <dd className="font-display text-2xl font-bold" data-testid={`creator-stat-${c.key}`}>
                {c.value ?? '–'}
              </dd>
            </Card>
          ))}
        </dl>
        {stats.data && stats.data.games.length > 0 ? (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-3 text-left">
                <tr>
                  {(['game', 'visitors', 'plays', 'adImpressions'] as const).map((h) => (
                    <th key={h} scope="col" className="px-3 py-2">
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.data.games.map((g) => (
                  <tr key={g.gameId} className="border-t border-border">
                    <td className="px-3 py-2 font-bold">{g.title}</td>
                    <td className="px-3 py-2">{g.visitors}</td>
                    <td className="px-3 py-2">{g.plays}</td>
                    <td className="px-3 py-2">{g.adImpressions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : stats.data ? (
          <p className="text-sm text-fg-muted">{t('noStats')}</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
        <p className="text-xs text-fg-muted">{t('statsNote')}</p>
      </section>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-semibold">{tp('statements')}</h2>
        <p className="text-sm text-fg-muted">{tp('intro', { inr: formatMoney(THRESHOLD_MINOR.INR, 'INR'), usd: formatMoney(THRESHOLD_MINOR.USD, 'USD') })}</p>
        {(statements.data ?? []).length === 0 ? (
          <EmptyState title={t('noStatements')} size="sm" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(statements.data ?? []).map((s) => (
              <li key={s.month} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="creator-statement">
                <span className="font-bold">{s.month}</span>
                <span>{tp('earned', { amount: formatMoney(s.earned, s.currency) })}</span>
                <span className="font-bold">{tp('due', { amount: formatMoney(s.payoutDue, s.currency) })}</span>
                <Badge tone={s.status === 'paid' ? 'success' : s.status === 'rolled_over' ? 'warning' : 'primary'}>{tp(`status.${s.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
        {(payouts.data ?? []).length > 0 ? (
          <>
            <h3 className="font-semibold">{tp('payouts')}</h3>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {(payouts.data ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap gap-3 py-2">
                  <span className="font-bold">{formatMoney(p.amount, p.currency)}</span>
                  <span>{tp(`methods.${p.method}`)}</span>
                  <span className="text-fg-muted">{p.months.join(', ')}</span>
                  <span className="text-fg-muted">{formatDate(p.paidAt, locale)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
      <PayoutDetails />
    </div>
  );
}

/** The creator's own page: share links, numbers, statements and payout details. */
export function CreatorDashboard() {
  const t = useTranslations('creators.dashboard');
  const { user, ready } = useSession();
  const mine = useRepoQuery((repo) => (user?.username ? repo.creators.mine() : Promise.resolve(null)), [user?.id, user?.username], { topics: ['creators', 'session'] });
  if (!ready || (user?.username && mine.data === undefined)) return <div className="page"><Skeleton className="h-64 w-full" /></div>;
  const c = mine.data;
  return (
    <div className="page flex flex-col gap-5" data-testid="creator-dashboard">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{c ? t('title', { handle: c.handle }) : t('titleNone')}</h1>
        {c ? <Badge tone={c.status === 'approved' ? 'success' : 'warning'}>{c.status}</Badge> : null}
      </div>
      {c?.status === 'approved' ? (
        <Approved creator={c} />
      ) : (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-sm">{c ? t('notApproved') : t('notCreator')}</p>
          <Link href="/creators" className={buttonClass({})}>
            {t('toProgram')}
          </Link>
        </Card>
      )}
    </div>
  );
}
