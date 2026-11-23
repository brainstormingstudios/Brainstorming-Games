'use client';

import { useTranslations } from 'next-intl';
import { BadgeCheck, Check } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Skeleton } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import { canBuyIn } from '@/lib/domain/market';
import { formatInr } from '@/lib/domain/premium';
import { FOUNDING_STUDIOS, VERIFIED_PLANS, type VerifiedPlan } from '@/lib/domain/verified';
import { formatDate } from '@/lib/format';
import { useCountry } from '@/lib/hooks/useCountry';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useCheckout } from './Checkout';
import { PAYMENTS_LIVE } from '@/lib/config';

const BENEFITS = ['benefitTick', 'benefitReview', 'benefitShelf', 'benefitBoost'] as const;

/** The developer's Verified tick: its state, its benefits, and buying or extending it. */
export function VerifiedPage() {
  const t = useTranslations('verified');
  const locale = useLocale();
  const { pay, dialog } = useCheckout();
  const status = useRepoQuery((repo) => repo.billing.verifiedStatus(), [], { topics: ['dev-games', 'revenue', 'notifications'] });
  const { country } = useCountry();
  // Buying needs payments switched on (Razorpay) and, for now, a visitor in India.
  const sellsHere = PAYMENTS_LIVE && canBuyIn(country);
  const tb = useTranslations('billing');
  const [buying, setBuying] = useState<VerifiedPlan | null>(null);

  const buy = async (plan: VerifiedPlan) => {
    setBuying(plan);
    await pay(async () => (await getRepo()).billing.orderVerified(plan));
    setBuying(null);
    status.refresh();
  };

  const s = status.data;
  const until = s?.until ? formatDate(s.until, locale) : '';
  const state = !s
    ? null
    : s.firstParty
      ? t('stateOfficial')
      : !s.verified
        ? t('stateOff')
        : s.source === 'founding'
          ? t('stateFounding', { number: s.foundingNumber ?? 0, until })
          : s.source === 'paid'
            ? t('statePaid', { until })
            : t('stateStaff');

  return (
    <div className="flex flex-col gap-6" data-testid="verified-page">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <BadgeCheck aria-hidden="true" className="size-7 text-glow" />
          {t('title')}
        </h1>
        <p className="mt-1 max-w-3xl text-fg-muted">{t('intro')}</p>
      </div>

      {status.loading && !s ? (
        <Skeleton className="h-24 w-full" />
      ) : s ? (
        <Card className="flex flex-wrap items-center gap-3 p-4" data-testid="verified-state" data-verified={s.verified} data-source={s.source ?? ''}>
          {s.firstParty ? <Badge tone="primary">{t('official')}</Badge> : s.verified ? <Badge tone="success">{t('on')}</Badge> : <Badge>{t('off')}</Badge>}
          <p className="font-bold">{state}</p>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-display text-xl font-bold">{t('benefitsTitle')}</h2>
        <ul className="flex flex-col gap-2">
          {BENEFITS.map((b) => (
            <li key={b} className="flex gap-2">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(b)}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-fg-muted">{t('founding', { count: FOUNDING_STUDIOS })}</p>
      </Card>

      {s?.firstParty ? null : (
        <>
          {!sellsHere ? (
            <p className="text-sm font-bold" data-testid={PAYMENTS_LIVE ? 'india-only' : 'payments-soon'}>
              {PAYMENTS_LIVE ? t('indiaOnly') : tb('paymentsSoon')}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(VERIFIED_PLANS) as VerifiedPlan[]).map((plan) => (
              <Card key={plan} className="flex flex-col gap-3 p-4" data-testid={`verified-plan-${plan}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-xl font-bold">{t(plan === 'year' ? 'yearTitle' : 'monthTitle')}</h2>
                  {plan === 'year' ? <Badge tone="glow">{t('yearSave')}</Badge> : null}
                </div>
                <p className="font-display text-3xl font-bold">{formatInr(VERIFIED_PLANS[plan].price)}</p>
                <p className="text-sm text-fg-muted">{t(plan === 'year' ? 'yearBody' : 'monthBody')}</p>
                <Button
                  className="mt-auto"
                  loading={buying === plan}
                  disabled={!sellsHere || buying !== null}
                  onClick={() => void buy(plan)}
                  data-testid={`verified-buy-${plan}`}
                >
                  {s?.verified ? t('extend') : t('buy')}
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
