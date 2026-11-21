'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Card, EmptyState, Skeleton, buttonClass, cn } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { SKILLS, computeBrainProfile } from '@/lib/domain/brain';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { RadarChart } from './RadarChart';
import { useSkillLabels } from './BrainPage';

/** Challenge a friend: their Brain Profile next to yours, skill by skill. */
export function ComparePage() {
  const t = useTranslations('brain');
  const name = (useSearchParams().get('u') ?? '').toLowerCase();
  const { user } = useSession();
  const labels = useSkillLabels();
  const them = useRepoQuery((repo) => (name ? repo.brain.of(name) : Promise.resolve(null)), [name]);
  const mine = useRepoQuery((repo) => repo.brain.mine(), [user?.id], { topics: ['history', 'session'] });
  const theirs = useMemo(() => (them.data ? computeBrainProfile(them.data.rows, them.data.skills) : null), [them.data]);
  const me = useMemo(() => (mine.data ? computeBrainProfile(mine.data.rows, mine.data.skills) : null), [mine.data]);

  if (them.loading && them.data === undefined) return <div className="page"><Skeleton className="h-96 w-full" /></div>;
  if (!theirs || !them.data) return <div className="page"><EmptyState title={t('compareMissing')} art="sad" /></div>;
  const display = them.data.displayName || them.data.username;
  const self = user?.username === them.data.username;
  const wins = me ? SKILLS.filter((s) => me.scores[s] > theirs.scores[s]).length : 0;

  return (
    <div className="page flex flex-col gap-5" data-testid="brain-compare">
      <div>
        <h1 className="text-3xl font-bold">{self ? t('compareSelf') : t('compareTitle', { name: display })}</h1>
        <p className="text-sm text-fg-muted">{t('compareIntro')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="flex flex-col items-center gap-3 p-4">
          <RadarChart
            labels={labels}
            series={[
              { label: display, values: theirs.scores, colorClass: 'text-[#f59e0b]', dashed: true },
              ...(me && !self ? [{ label: t('you'), values: me.scores, colorClass: 'text-primary' }] : []),
            ]}
          />
          <ul className="flex gap-4 text-xs font-bold">
            <li className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-5 border-t-2 border-dashed border-[#f59e0b]" />
              {display}
            </li>
            {me && !self ? (
              <li className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-primary" />
                {t('you')}
              </li>
            ) : null}
          </ul>
        </Card>
        <Card className="flex flex-col gap-2 p-4">
          {me && !self ? (
            <p className="flex items-center gap-2 text-lg font-bold" data-testid="brain-compare-result">
              <Trophy aria-hidden="true" className="size-5 text-primary" />
              {t('compareScore', { wins, total: SKILLS.length })}
            </p>
          ) : null}
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted uppercase">
              <tr>
                <th scope="col" className="py-1">{t('skill')}</th>
                <th scope="col" className="py-1 text-right">{display}</th>
                {me && !self ? <th scope="col" className="py-1 text-right">{t('you')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {SKILLS.map((s) => {
                const mineWins = me ? me.scores[s] > theirs.scores[s] : false;
                return (
                  <tr key={s} className="border-t border-border">
                    <td className="py-2 font-bold">{labels[s]}</td>
                    <td className={cn('py-2 text-right tabular-nums', !mineWins && 'font-bold')}>{theirs.scores[s]}</td>
                    {me && !self ? <td className={cn('py-2 text-right tabular-nums', mineWins && 'font-bold text-primary')}>{me.scores[s]}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Link href="/brain" className={cn(buttonClass({}), 'mt-2 self-start')}>
            {t('toMine')}
          </Link>
        </Card>
      </div>
    </div>
  );
}
