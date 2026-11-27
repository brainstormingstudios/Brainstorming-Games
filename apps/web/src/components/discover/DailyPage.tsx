'use client';

import { useTranslations } from 'next-intl';
import { CalendarCheck, Play, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Skeleton, buttonClass, cn } from '@brainstorming/ui';
import { GameCover } from '@/components/catalogue/GameCover';
import { Link } from '@/i18n/navigation';
import { msUntilNextDay } from '@/lib/domain/discover';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { DailyPuzzles } from './DailyPuzzles';

function Countdown() {
  const t = useTranslations('daily');
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(msUntilNextDay());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  if (left == null) return null;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return <span className="font-display tabular-nums">{t('next', { time: `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` })}</span>;
}

/** One game a day, the same for everyone, with today's leaderboard. */
export function DailyPage() {
  const t = useTranslations('daily');
  const { user } = useSession();
  const today = useRepoQuery(async (repo) => {
    const d = await repo.discover.daily();
    if (!d) return null;
    const [game] = await repo.catalogue.byIds([d.gameId]);
    if (!game) return null;
    const board = d.board ? await repo.scores.top(d.gameId, d.board, { limit: 10, friends: false, period: 'day' }) : null;
    return { ...d, game, board };
  }, [user?.id], { topics: ['catalogue', 'leaderboards'] });

  const puzzles = <DailyPuzzles />;
  if (today.loading && today.data === undefined) return <div className="page flex flex-col gap-6"><h1 className="sr-only">{t('title')}</h1>{puzzles}<Skeleton className="h-96 w-full" /></div>;
  const d = today.data;
  if (!d) return <div className="page flex flex-col gap-6"><h1 className="sr-only">{t('title')}</h1>{puzzles}<EmptyState title={t('none')} /></div>;

  return (
    <div className="page flex flex-col gap-5" data-testid="daily-page">
      {puzzles}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge tone="glow" className="mb-2">
            <CalendarCheck aria-hidden="true" className="mr-1 inline size-3.5" />
            {t('kicker', { day: d.day })}
          </Badge>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <span className="text-sm font-bold text-fg-muted">
          <Countdown />
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="flex flex-col overflow-hidden" data-testid="daily-game">
          <div className="aspect-video bg-surface-3">
            <GameCover game={d.game} sizes="(min-width: 1024px) 60vw, 100vw" priority />
          </div>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-bold">{d.game.title}</h2>
              {d.game.shortDescription ? <p className="text-sm text-fg-muted">{d.game.shortDescription}</p> : null}
            </div>
            <Link href={`/game/${d.game.slug}`} className={buttonClass({ size: 'lg' })} data-testid="daily-play">
              <Play aria-hidden="true" className="size-5" />
              {t('play')}
            </Link>
          </div>
        </Card>
        <Card className="flex flex-col gap-2 p-4" data-testid="daily-board">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Trophy aria-hidden="true" className="size-5 text-primary" />
            {t('boardTitle')}
          </h2>
          {!d.board ? (
            <p className="text-sm text-fg-muted">{t('noBoard')}</p>
          ) : d.board.entries.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('boardEmpty')}</p>
          ) : (
            <ol className="flex flex-col">
              {d.board.entries.map((e) => (
                <li key={`${e.rank}-${e.name}`} className={cn('flex items-center gap-3 border-b border-border py-1.5 text-sm', e.isMe && 'font-bold text-primary')}>
                  <span className="w-6 text-right font-display tabular-nums">{e.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="font-display tabular-nums">{e.score.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
          {d.board?.me && !d.board.entries.some((e) => e.isMe) ? <p className="text-sm font-bold">{t('yourRank', { rank: d.board.me.rank })}</p> : null}
          {!user?.username && d.board ? <p className="text-xs text-fg-muted">{t('signInToRank')}</p> : null}
        </Card>
      </div>
    </div>
  );
}
