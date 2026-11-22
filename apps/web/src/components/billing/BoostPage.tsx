'use client';

import { useTranslations } from 'next-intl';
import { Camera, Check, Gift, Rocket, SquarePlay } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, SelectField, Skeleton, cn, useToast, type BadgeTone } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { getRepo, RepoError } from '@/lib/data';
import type { BoostOrder } from '@/lib/data/billingTypes';
import { PUBLIC_STATUSES } from '@/lib/data/types';
import { BOOSTS, formatInr, type BoostPackage } from '@/lib/domain/premium';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useCountry } from '@/lib/hooks/useCountry';
import { canBuyIn } from '@/lib/domain/market';
import { useCheckout } from './Checkout';

export const BOOST_TONE: Record<BoostOrder['status'], BadgeTone> = {
  pending_payment: 'neutral',
  paid: 'primary',
  live: 'success',
  done: 'neutral',
  cancelled: 'danger',
};

/** Links to the posted Shorts and Reels of a Boost. */
export function BoostLinks({ order }: { order: BoostOrder }) {
  const t = useTranslations('boost');
  if (!order.shortUrls.length && !order.reelUrls.length) return <p className="text-sm text-fg-muted">{t('videosSoon')}</p>;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {order.shortUrls.map((url, i) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-link underline underline-offset-4">
            <SquarePlay aria-hidden="true" className="size-4" />
            {t('short', { n: i + 1 })}
          </a>
        </li>
      ))}
      {order.reelUrls.map((url, i) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-link underline underline-offset-4">
            <Camera aria-hidden="true" className="size-4" />
            {t('reel', { n: i + 1 })}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Boost, in the developer portal: pay for us to make YouTube Shorts and Instagram Reels of your
 * game and post them on the official channels, plus a sponsored slot on the site. Sponsored
 * placement is always labelled, and it never changes the game's Brain Rank.
 */
/** Free Spotlight Boosts earned when a review took longer than 72 hours. */
function FreeBoostCredit({ gameId, onUsed }: { gameId: string; onUsed: () => void }) {
  const t = useTranslations('boost');
  const tc = useTranslations('common');
  const toast = useToast();
  const credits = useRepoQuery((repo) => repo.billing.myBoostCredits(), [], { topics: ['revenue', 'notifications'] });
  const [busy, setBusy] = useState(false);
  if (!credits.data) return null;
  const use = async () => {
    setBusy(true);
    try {
      await (await getRepo()).billing.redeemBoostCredit(gameId);
      toast(t('creditUsed'), { tone: 'success' });
      credits.refresh();
      onUsed();
    } catch (err) {
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-wrap items-center gap-3 border-primary p-4" data-testid="boost-credit">
      <Gift aria-hidden="true" className="size-6 text-primary" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="block font-bold">{t('creditTitle', { count: credits.data })}</span>
        {t('creditBody')}
      </p>
      <Button loading={busy} disabled={!gameId} onClick={() => void use()} data-testid="boost-credit-use">
        {t('creditUse')}
      </Button>
    </Card>
  );
}

export function BoostPage() {
  const t = useTranslations('boost');
  const locale = useLocale();
  const { pay, dialog } = useCheckout();
  const games = useRepoQuery((repo) => repo.dev.myGames(), [], { topics: ['dev-games'] });
  const orders = useRepoQuery((repo) => repo.billing.myBoosts(), [], { topics: ['revenue', 'catalogue'] });
  const live = (games.data ?? []).filter((g) => PUBLIC_STATUSES.includes(g.status));
  const [gameId, setGameId] = useState('');
  const [buying, setBuying] = useState<BoostPackage | null>(null);
  const selected = gameId || live[0]?.id || '';
  // Boosts are sold in India only for now (lib/domain/market.ts). Free credits work everywhere.
  const { country } = useCountry();
  const sellsHere = canBuyIn(country);

  const buy = async (pkg: BoostPackage) => {
    setBuying(pkg);
    await pay(async () => (await getRepo()).billing.orderBoost(selected, pkg));
    setBuying(null);
    orders.refresh();
  };

  return (
    <div className="flex flex-col gap-6" data-testid="boost-page">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Rocket aria-hidden="true" className="size-7 text-primary" />
          {t('title')}
        </h1>
        <p className="mt-1 max-w-3xl text-fg-muted">{t('intro')}</p>
      </div>

      {games.loading && !games.data ? (
        <Skeleton className="h-64 w-full" />
      ) : live.length === 0 ? (
        <EmptyState title={t('needLiveTitle')} description={t('needLiveBody')} size="sm" />
      ) : (
        <>
          <SelectField label={t('game')} className="max-w-sm" value={selected} onChange={(e) => setGameId(e.target.value)} options={live.map((g) => ({ value: g.id, label: g.title }))} data-testid="boost-game" />
          <FreeBoostCredit gameId={selected} onUsed={() => orders.refresh()} />
          {!sellsHere ? (
            <p className="text-sm font-bold" data-testid="india-only">
              {t('indiaOnly')}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            {(Object.keys(BOOSTS) as BoostPackage[]).map((pkg) => {
              const def = BOOSTS[pkg];
              const featured = pkg === 'push';
              return (
                <Card key={pkg} className={cn('relative flex flex-col gap-3 p-5', featured && 'border-primary')} data-testid={`boost-${pkg}`}>
                  {featured ? <Badge tone="primary" className="absolute -top-3 left-5">{t('popular')}</Badge> : null}
                  <h2 className="font-display text-xl font-extrabold">{t(`packages.${pkg}`)}</h2>
                  <p className="font-display text-3xl font-extrabold">{formatInr(def.price)}</p>
                  <ul className="flex flex-1 flex-col gap-1.5 text-sm">
                    <li className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                      {t('shorts', { count: def.shorts })}
                    </li>
                    <li className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                      {t('reels', { count: def.reels })}
                    </li>
                    <li className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                      {t('sponsored', { count: def.sponsoredDays })}
                    </li>
                    {def.heroDays ? (
                      <li className="flex gap-2">
                        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                        {t('hero', { count: def.heroDays })}
                      </li>
                    ) : null}
                  </ul>
                  <Button variant={featured ? 'primary' : 'secondary'} loading={buying === pkg} disabled={!selected || !sellsHere} onClick={() => void buy(pkg)} data-testid={`buy-boost-${pkg}`}>
                    {t('buy', { price: formatInr(def.price) })}
                  </Button>
                </Card>
              );
            })}
          </div>
          <p className="max-w-3xl text-xs text-fg-muted">{t('fineprint')}</p>
        </>
      )}

      <section aria-labelledby="my-boosts" className="flex flex-col gap-3">
        <h2 id="my-boosts" className="text-xl font-semibold">
          {t('yours')}
        </h2>
        {(orders.data ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">{t('none')}</p>
        ) : (
          (orders.data ?? []).map((o) => (
            <Card key={o.id} className="flex flex-col gap-2 p-4" data-testid="boost-order">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold">{o.gameTitle}</span>
                <Badge>{t(`packages.${o.package}`)}</Badge>
                <Badge tone={BOOST_TONE[o.status]}>{t(`status.${o.status}`)}</Badge>
                <span className="ml-auto text-sm text-fg-muted">{formatInr(o.amount)}</span>
              </div>
              {o.startsAt && o.endsAt ? <p className="text-sm text-fg-muted">{t('window', { from: formatDate(o.startsAt, locale), to: formatDate(o.endsAt, locale) })}</p> : null}
              <BoostLinks order={o} />
            </Card>
          ))
        )}
      </section>
      {dialog}
    </div>
  );
}
