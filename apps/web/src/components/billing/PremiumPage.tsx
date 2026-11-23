'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Copy, Crown, Download, Gift, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Skeleton, cn, useToast } from '@brainstorming/ui';
import { useAction } from '@/components/player/common';
import { useLocale } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import { PLANS, activePlan, formatInr, type PremiumPlan } from '@/lib/domain/premium';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { useCountry } from '@/lib/hooks/useCountry';
import { canBuyIn } from '@/lib/domain/market';
import { useCheckout } from './Checkout';
import { PAYMENTS_LIVE } from '@/lib/config';
import { PointsSwap } from './PointsSwap';

const PERKS: Record<PremiumPlan, string[]> = {
  plus: ['fewerAds', 'shortBreaks', 'wallpapers', 'plusBadge'],
  max: ['noAds', 'instantRewards', 'doublePoints', 'wallpapers', 'guestPasses', 'maxBadge'],
};

function PlanCard({ plan, current, onBuy, busy, canBuy }: { plan: PremiumPlan; current: PremiumPlan | null; onBuy: () => void; busy: boolean; canBuy: boolean }) {
  const t = useTranslations('premium');
  const highlight = plan === 'max';
  const owned = current === plan;
  return (
    <Card className={cn('relative flex flex-col gap-4 p-5', highlight && 'border-primary')} data-testid={`plan-${plan}`}>
      {highlight ? <Badge tone="primary" className="absolute -top-3 left-5">{t('best')}</Badge> : null}
      <div>
        <h2 className="flex items-center gap-2 font-display text-2xl font-extrabold">
          {plan === 'max' ? <Crown aria-hidden="true" className="size-6 text-primary" /> : <Sparkles aria-hidden="true" className="size-6 text-primary" />}
          {t(`${plan}.name`)}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{t(`${plan}.tagline`)}</p>
      </div>
      <p>
        <span className="font-display text-4xl font-extrabold">{formatInr(PLANS[plan].price)}</span>
        <span className="text-fg-muted"> {t('perMonth')}</span>
      </p>
      <ul className="flex flex-1 flex-col gap-2 text-sm">
        {PERKS[plan].map((perk) => (
          <li key={perk} className="flex gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t(`perks.${perk}`)}
          </li>
        ))}
      </ul>
      <Button size="lg" variant={highlight ? 'primary' : 'secondary'} disabled={owned || !canBuy} loading={busy} onClick={onBuy} data-testid={`buy-${plan}`}>
        {owned ? t('yourPlan') : current ? t('switchTo', { plan: t(`${plan}.name`) }) : t('choose', { plan: t(`${plan}.name`) })}
      </Button>
    </Card>
  );
}

/** Brainstorming Premium: the two plans, your membership, the member wallpapers and guest passes. */
export function PremiumPage() {
  const t = useTranslations('premium');
  const locale = useLocale();
  const toast = useToast();
  const act = useAction();
  const { user, ready } = useSession();
  const { pay, dialog } = useCheckout();
  const status = useRepoQuery((repo) => repo.billing.premiumStatus(), [user?.id], { topics: ['session'] });
  const plan = activePlan(status.data?.premium);
  const wallpapers = useRepoQuery((repo) => (plan ? repo.billing.wallpapers() : Promise.resolve([])), [plan]);
  const [buying, setBuying] = useState<PremiumPlan | null>(null);
  const pass = useSearchParams().get('pass');
  // Memberships are sold in India only for now (lib/domain/market.ts).
  const { country } = useCountry();
  // Buying needs payments switched on (Razorpay) and, for now, a visitor in India.
  const sellsHere = PAYMENTS_LIVE && canBuyIn(country);
  const tb = useTranslations('billing');
  const redeemed = useRef(false);

  // A guest-pass link: redeem it once the visitor is signed in.
  useEffect(() => {
    if (!pass || !ready || redeemed.current) return;
    if (!user?.username) return;
    redeemed.current = true;
    void act(async () => (await getRepo()).billing.redeemGuestPass(pass), t('passRedeemed'));
  }, [pass, ready, user?.username, act, t]);

  const buy = async (p: PremiumPlan) => {
    if (!user?.username) return void requestLogin();
    setBuying(p);
    await pay(async () => (await getRepo()).billing.subscribe(p));
    setBuying(null);
    status.refresh();
  };

  const share = async () => {
    const result = await act(async () => (await getRepo()).billing.createGuestPass());
    if (!result) return;
    const link = `${window.location.origin}${window.location.pathname}?pass=${result.code}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast(t('passCopied'), { tone: 'success' });
    status.refresh();
  };

  const s = status.data;
  return (
    <div className="page" data-testid="premium-page">
      <header className="mx-auto max-w-3xl py-6 text-center">
        <p className="text-sm font-extrabold tracking-[0.14em] text-primary uppercase">{t('eyebrow')}</p>
        <h1 className="mt-2 text-4xl font-extrabold sm:text-5xl">{t('title')}</h1>
        <p className="mt-3 text-lg text-fg-muted">{t('intro')}</p>
        {pass && !user?.username && ready ? (
          <Button className="mt-4" onClick={() => void requestLogin()} icon={<Gift aria-hidden="true" className="size-4" />}>
            {t('passLogin')}
          </Button>
        ) : null}
      </header>

      {s?.premium && plan ? (
        <Card className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center gap-3 p-4" data-testid="membership">
          <Badge tone="primary">{t(`${plan}.name`)}</Badge>
          <span className="text-sm">
            {s.premium.fromPass
              ? t('passUntil', { date: formatDate(s.premium.until, locale) })
              : s.premium.autoRenew
                ? t('renews', { date: formatDate(s.premium.until, locale) })
                : t('endsOn', { date: formatDate(s.premium.until, locale) })}
          </span>
          {s.premium.autoRenew && !s.premium.fromPass ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void act(async () => (await getRepo()).billing.cancel(), t('cancelled'))} data-testid="cancel-premium">
              {t('cancel')}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {status.loading && !s ? (
        <Skeleton className="mx-auto h-96 max-w-4xl" />
      ) : (
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          {(['plus', 'max'] as const).map((p) => (
            <PlanCard key={p} plan={p} current={plan} busy={buying === p} canBuy={sellsHere && (!user?.username || Boolean(s?.canBuy))} onBuy={() => void buy(p)} />
          ))}
        </div>
      )}
      {!sellsHere ? (
        <p className="mx-auto mt-4 max-w-4xl text-center text-sm font-bold" data-testid={PAYMENTS_LIVE ? 'india-only' : 'payments-soon'}>
          {PAYMENTS_LIVE ? t('indiaOnly') : tb('paymentsSoon')}
        </p>
      ) : null}
      {user?.username && s && !s.canBuy ? <p className="mx-auto mt-4 max-w-4xl text-center text-sm text-fg-muted">{t('adultsOnly')}</p> : null}
      <p className="mx-auto mt-4 max-w-4xl text-center text-xs text-fg-muted">{t('fineprint')}</p>

      {plan && s && !s.premium?.fromPass && PLANS[plan].guestPasses > 0 ? (
        <section className="mx-auto mt-10 max-w-4xl" aria-labelledby="passes">
          <h2 id="passes" className="text-2xl font-bold">
            {t('passesTitle')}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t('passesIntro', { count: s.passesLeft })}</p>
          <Button className="mt-3" disabled={s.passesLeft < 1} icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void share()} data-testid="share-pass">
            {t('sharePass')}
          </Button>
          {s.passes.length ? (
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {s.passes.map((p) => (
                <li key={p.code}>
                  <Badge tone={p.redeemed ? 'success' : 'neutral'}>
                    {p.code} · {p.redeemed ? t('passUsed') : t('passOpen')}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {plan ? (
        <section className="mx-auto mt-10 max-w-5xl" aria-labelledby="wallpapers">
          <h2 id="wallpapers" className="text-2xl font-bold">
            {t('wallpapersTitle')}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t('wallpapersIntro')}</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="wallpapers">
            {(wallpapers.data ?? []).map((w) => (
              <li key={w.id}>
                <Card className="overflow-hidden">
                  <img src={w.desktop} alt={w.title} width={1920} height={1080} loading="lazy" className="aspect-video w-full object-cover" />
                  <div className="flex flex-wrap items-center gap-2 p-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">{w.title}</span>
                    <a href={w.desktop} download className="inline-flex items-center gap-1 text-sm font-bold text-link">
                      <Download aria-hidden="true" className="size-4" />
                      {t('desktop')}
                    </a>
                    <a href={w.phone} download className="inline-flex items-center gap-1 text-sm font-bold text-link">
                      <Download aria-hidden="true" className="size-4" />
                      {t('phone')}
                    </a>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PointsSwap />
      {dialog}
    </div>
  );
}
