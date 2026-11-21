'use client';

import { useTranslations } from 'next-intl';
import { BrainCircuit } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, useToast } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo, RepoError } from '@/lib/data';
import { MAX_POINT_DAYS_PER_MONTH, POINTS_OPTIONS, redeemCheck, type PointsOptionId } from '@/lib/domain/discover';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';

/** Swap Brain Points for Premium days (no money involved). */
export function PointsSwap() {
  const t = useTranslations('premium.points');
  const tc = useTranslations('common');
  const toast = useToast();
  const locale = useLocale();
  const { user } = useSession();
  const days = useRepoQuery((repo) => repo.discover.pointDaysThisMonth(), [user?.id], { topics: ['points', 'session'] });
  const [busy, setBusy] = useState<PointsOptionId | null>(null);

  const swap = async (id: PointsOptionId) => {
    if (!user?.username) return void requestLogin();
    setBusy(id);
    try {
      const r = await (await getRepo()).discover.redeemPoints(id);
      toast(t('done', { plan: t(`plan.${r.plan}`), date: formatDate(r.until, locale) }), { tone: 'success' });
      days.refresh();
    } catch (err) {
      const reason = err instanceof RepoError ? err.message : '';
      toast(['insufficient_points', 'monthly_limit', 'other_plan'].includes(reason) ? t(`problem.${reason}`, { max: MAX_POINT_DAYS_PER_MONTH }) : tc('errorBody'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const state = {
    points: user?.brainPoints ?? 0,
    daysThisMonth: days.data ?? 0,
    plan: user?.premium?.plan ?? null,
    until: user?.premium?.until ?? null,
  };

  return (
    <section className="mt-10 flex flex-col gap-3" aria-labelledby="points-swap" data-testid="points-swap">
      <div>
        <h2 id="points-swap" className="flex items-center gap-2 text-2xl font-bold">
          <BrainCircuit aria-hidden="true" className="size-6 text-primary" />
          {t('title')}
        </h2>
        <p className="text-sm text-fg-muted">
          {user?.username ? t('balance', { points: state.points, used: state.daysThisMonth, max: MAX_POINT_DAYS_PER_MONTH }) : t('signedOut')}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {POINTS_OPTIONS.map((o) => {
          const check = redeemCheck(o.id, state);
          return (
            <li key={o.id}>
              <Card className="flex h-full flex-col gap-2 p-4" data-testid={`points-${o.id}`}>
                <span className="font-display text-lg font-bold">{t(`option.${o.id}`)}</span>
                <span className="text-sm text-fg-muted">{t('cost', { points: o.cost.toLocaleString(locale) })}</span>
                {user?.username && !check.ok ? <span className="text-xs text-fg-muted">{t(`why.${check.problem}`, { max: MAX_POINT_DAYS_PER_MONTH })}</span> : null}
                <Button
                  className="mt-auto self-start"
                  size="sm"
                  disabled={Boolean(user?.username) && !check.ok}
                  loading={busy === o.id}
                  onClick={() => void swap(o.id)}
                  data-testid={`points-swap-${o.id}`}
                >
                  {t('swap')}
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-muted">{t('note', { max: MAX_POINT_DAYS_PER_MONTH })}</p>
    </section>
  );
}
