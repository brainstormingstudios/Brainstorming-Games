'use client';

import { useTranslations } from 'next-intl';
import { Badge, Card } from '@brainstorming/ui';
import { AB_MIN_IMPRESSIONS, clickRate } from '@/lib/domain/abTest';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

const pct = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const score = (v: number | null) => (v == null ? '–' : v.toFixed(1));

/** A game's thumbnail A/B test and playtest panel results, on its manage page. */
export function GrowthPanel({ gameId }: { gameId: string }) {
  const t = useTranslations('dev.growth');
  const stats = useRepoQuery((repo) => repo.growth.variantStats(gameId), [gameId], { topics: ['dev-games', 'catalogue'] });
  const playtest = useRepoQuery((repo) => repo.growth.playtestSummary(gameId), [gameId], { topics: ['dev-games'] });
  const rows = stats.data ?? [];
  const p = playtest.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4" data-testid="ab-panel">
        <h2 className="font-display text-lg font-semibold">{t('abTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('abIntro', { count: AB_MIN_IMPRESSIONS })}</p>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm">{t('abNone')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  {(['abCover', 'abImpressions', 'abClicks', 'abCtr'] as const).map((h) => (
                    <th key={h} scope="col" className="py-1 pr-3 font-display">
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-border" data-testid="ab-row">
                    <th scope="row" className="py-1.5 pr-3 text-left font-bold">
                      {r.label} {r.winner ? <Badge tone="success">{t('abWinner')}</Badge> : null}
                    </th>
                    <td className="py-1.5 pr-3">{r.impressions.toLocaleString('en-IN')}</td>
                    <td className="py-1.5 pr-3">{r.clicks.toLocaleString('en-IN')}</td>
                    <td className="py-1.5 pr-3">{pct(clickRate(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-fg-muted">{rows.some((r) => r.decided) ? t('abDone') : t('abRunning')}</p>
          </div>
        )}
      </Card>
      <Card className="p-4" data-testid="playtest-panel">
        <h2 className="font-display text-lg font-semibold">{t('playtestTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('playtestIntro')}</p>
        {!p || p.responses === 0 ? (
          <p className="mt-3 text-sm">{t('playtestNone')}</p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [t('playtestResponses'), String(p.responses)],
              [t('playtestFun'), `${score(p.fun)} / 5`],
              [t('playtestClarity'), `${score(p.clarity)} / 5`],
              [t('playtestAgain'), pct(p.playAgain)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-bold tracking-wide text-fg-muted uppercase">{label}</dt>
                <dd className="font-display text-xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
