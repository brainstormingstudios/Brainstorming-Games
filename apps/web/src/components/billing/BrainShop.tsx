'use client';

import { useTranslations } from 'next-intl';
import { Brain, Gem, Lightbulb, Palette, Snowflake, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Tabs, buttonClass, cn } from '@brainstorming/ui';
import { useAction } from '@/components/player/common';
import { Link } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import { BP_PACKS, formatInr } from '@/lib/domain/premium';
import { useSession } from '@/lib/hooks/useSession';

/**
 * The Brain Shop: what Brain Points buy (streak freezes, puzzle hints, profile pictures and looks,
 * Premium days), and Brain Point packs for real money (shown as coming soon until payments start).
 */
export function BrainShop() {
  const t = useTranslations('shop');
  const act = useAction();
  const { user } = useSession();
  const [tab, setTab] = useState('spend');
  const items = [
    { key: 'freeze', icon: Snowflake, cost: 60, action: () => void act(async () => (await getRepo()).quests.buyStreakFreeze(), t('freezeBought')) },
    { key: 'hint', icon: Lightbulb, cost: 30, href: '/daily' },
    { key: 'pictures', icon: Sparkles, cost: null, href: '/locker' },
    { key: 'looks', icon: Palette, cost: null, href: '/locker' },
    { key: 'premiumDays', icon: Gem, cost: 400, href: '/premium' },
  ] as const;
  return (
    <div className="page flex flex-col gap-5" data-testid="brain-shop">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Brain aria-hidden="true" className="size-8 text-glow" />
            {t('title')}
          </h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        {user?.username ? (
          <p className="rounded-full bg-glow/10 px-4 py-2 font-display text-lg font-bold text-glow" data-testid="shop-balance">
            {t('balance', { points: user.brainPoints })}
          </p>
        ) : (
          <Button onClick={() => void requestLogin()}>{t('signIn')}</Button>
        )}
      </header>
      <Tabs
        label={t('title')}
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'spend',
            label: t('tabSpend'),
            content: (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => (
                  <li key={it.key}>
                    <Card className="flex h-full flex-col gap-2 p-4">
                      <it.icon aria-hidden="true" className="size-7 text-primary" />
                      <p className="font-display text-lg font-bold">{t(`items.${it.key}.name`)}</p>
                      <p className="flex-1 text-sm text-fg-muted">{t(`items.${it.key}.body`)}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold">{it.cost ? t('cost', { points: it.cost }) : t('variousCosts')}</span>
                        {'action' in it ? (
                          <Button size="sm" disabled={!user?.username} onClick={it.action} data-testid={`shop-${it.key}`}>
                            {t('buy')}
                          </Button>
                        ) : (
                          <Link href={it.href} className={buttonClass({ size: 'sm', variant: 'secondary' })}>
                            {t('open')}
                          </Link>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            id: 'buy',
            label: t('tabBuy'),
            content: (
              <div className="flex flex-col gap-4" data-testid="shop-packs">
                <p className="rounded-control border border-warning/60 bg-surface-3 px-3.5 py-2.5 text-sm font-bold">{t('packsSoon')}</p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {BP_PACKS.map((p) => (
                    <li key={p.id}>
                      <Card className={cn('relative flex h-full flex-col items-center gap-2 p-5 text-center', p.best && 'border-2 border-primary shadow-glow')}>
                        {p.best ? <Badge tone="primary" className="absolute -top-3">{t('bestValue')}</Badge> : null}
                        <Brain aria-hidden="true" className="size-9 text-glow" />
                        <p className="font-display text-3xl font-extrabold">{p.points.toLocaleString('en-IN')}</p>
                        <p className="text-sm text-fg-muted">{t('points')}</p>
                        <Button className="mt-auto w-full" disabled>
                          {formatInr(p.price)}
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-fg-muted">{t('packsFineprint')}</p>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
