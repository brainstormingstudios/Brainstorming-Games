'use client';

import { useTranslations } from 'next-intl';
import { Check, Delete, Flame, Route, Share2, Snowflake, Type, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, ConfettiBurst, cn, useToast } from '@brainstorming/ui';
import { useAction } from '@/components/player/common';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import type { PuzzleKind } from '@/lib/data/repo';
import { local } from '@/lib/data/local';
import {
  WORD_TRIES,
  canExtend,
  dayKey,
  markGuess,
  pathOfDay,
  pathSolved,
  puzzleNumber,
  sharePath,
  shareWord,
  wordOfDay,
  type LetterMark,
} from '@/lib/domain/puzzles';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';

/** Copies the share text (or opens the phone's share sheet). */
async function share(text: string): Promise<boolean> {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Saves a solve: points and streak for signed-in players; guests are asked to sign in to keep it. */
function useFinish(kind: PuzzleKind, day: string, onDone: () => void) {
  const t = useTranslations('puzzles');
  const toast = useToast();
  const { user } = useSession();
  return useCallback(
    async (score: number) => {
      if (!user?.username) return;
      try {
        const r = await (await getRepo()).quests.completePuzzle(kind, day, score);
        if (r.points > 0) toast(t('earned', { points: r.points, streak: r.streak }), { tone: 'success' });
        if (r.freezeUsed) toast(t('freezeUsed'));
        onDone();
      } catch {
        // The solve still shows; points can be claimed on the next visit.
      }
    },
    [user?.username, kind, day, toast, t, onDone],
  );
}

// ---------------------------------------------------------------------------------------------
// Brain Word
// ---------------------------------------------------------------------------------------------

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const markClass: Record<LetterMark | 'empty' | 'typing', string> = {
  correct: 'border-success bg-success text-white',
  present: 'border-warning bg-warning text-navy-950',
  absent: 'border-surface-2 bg-surface-2 text-fg-muted',
  empty: 'border-border',
  typing: 'border-fg-muted',
};

function WordGame({ day, onSolved }: { day: string; onSolved: () => void }) {
  const t = useTranslations('puzzles');
  const toast = useToast();
  const answer = useMemo(() => wordOfDay(day), [day]);
  const store = `bg.puzzle.word.${day}`;
  const [guesses, setGuesses] = useState<string[]>([]);
  const [typing, setTyping] = useState('');
  const [shake, setShake] = useState(false);
  const [burst, setBurst] = useState(0);
  const finish = useFinish('word', day, onSolved);
  useEffect(() => setGuesses(local.get<string[]>(store, [])), [store]);
  const won = guesses.includes(answer);
  const over = won || guesses.length >= WORD_TRIES;

  const keyMarks = useMemo(() => {
    const m = new Map<string, LetterMark>();
    const rank = { absent: 0, present: 1, correct: 2 };
    for (const g of guesses) {
      markGuess(g, answer).forEach((mark, i) => {
        const ch = g[i]!;
        const was = m.get(ch);
        if (!was || rank[mark] > rank[was]) m.set(ch, mark);
      });
    }
    return m;
  }, [guesses, answer]);

  const press = useCallback(
    (key: string) => {
      if (over) return;
      if (key === 'enter') {
        if (typing.length !== 5) {
          setShake(true);
          window.setTimeout(() => setShake(false), 400);
          toast(t('fiveLetters'));
          return;
        }
        const next = [...guesses, typing];
        setGuesses(next);
        local.set(store, next);
        setTyping('');
        if (typing === answer) {
          setBurst((b) => b + 1);
          void finish(WORD_TRIES + 1 - next.length);
        }
        return;
      }
      if (key === 'back') return setTyping((v) => v.slice(0, -1));
      if (/^[a-z]$/.test(key) && typing.length < 5) setTyping((v) => v + key);
    },
    [over, typing, guesses, store, answer, finish, toast, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === 'Enter') press('enter');
      else if (e.key === 'Backspace') press('back');
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const rows = Array.from({ length: WORD_TRIES }, (_, r) => {
    if (r < guesses.length) return { letters: guesses[r]!.split(''), marks: markGuess(guesses[r]!, answer) as (LetterMark | 'empty' | 'typing')[] };
    if (r === guesses.length && !over) return { letters: typing.padEnd(5).split(''), marks: typing.padEnd(5).split('').map((ch) => (ch === ' ' ? 'empty' : 'typing')) as (LetterMark | 'empty' | 'typing')[] };
    return { letters: '     '.split(''), marks: Array(5).fill('empty') as 'empty'[] };
  });

  return (
    <div className="relative flex flex-col items-center gap-4" data-testid="word-game">
      {burst ? <ConfettiBurst key={burst} /> : null}
      <div className="grid gap-1.5" role="grid" aria-label={t('word.title')}>
        {rows.map((row, r) => (
          <div key={r} role="row" className={cn('grid grid-cols-5 gap-1.5', shake && r === guesses.length && 'animate-[shake_0.4s]')}>
            {row.letters.map((ch, i) => (
              <span
                key={i}
                role="gridcell"
                aria-label={ch.trim() ? `${ch} ${row.marks[i] === 'empty' || row.marks[i] === 'typing' ? '' : t(`mark.${row.marks[i]}`)}` : undefined}
                className={cn(
                  'flex size-12 items-center justify-center rounded-md border-2 font-display text-2xl font-bold uppercase transition-colors duration-300 sm:size-14',
                  markClass[row.marks[i]!],
                )}
              >
                {ch.trim()}
              </span>
            ))}
          </div>
        ))}
      </div>
      {over ? (
        <div className="flex flex-col items-center gap-2 text-center" data-testid="word-result">
          <p className="font-display text-xl font-bold">{won ? t('word.won', { tries: guesses.length }) : t('word.lost', { word: answer.toUpperCase() })}</p>
          <Button
            size="sm"
            variant="secondary"
            icon={<Share2 aria-hidden="true" className="size-4" />}
            onClick={async () => (await share(shareWord(day, guesses, answer, won))) && toast(t('copied'))}
          >
            {t('share')}
          </Button>
        </div>
      ) : null}
      <div className="flex w-full max-w-md flex-col gap-1.5" aria-label={t('keyboard')}>
        {KEY_ROWS.map((row, i) => (
          <div key={row} className="flex justify-center gap-1">
            {i === 2 ? (
              <button type="button" onClick={() => press('enter')} className="h-12 rounded-md bg-primary px-2.5 text-xs font-bold text-primary-fg" data-testid="word-enter">
                {t('enter')}
              </button>
            ) : null}
            {row.split('').map((k) => {
              const m = keyMarks.get(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className={cn('h-12 min-w-0 flex-1 rounded-md font-bold uppercase', m ? markClass[m] : 'bg-surface-2 text-fg')}
                >
                  {k}
                </button>
              );
            })}
            {i === 2 ? (
              <button type="button" onClick={() => press('back')} aria-label={t('back')} className="flex h-12 items-center rounded-md bg-surface-2 px-2.5">
                <Delete aria-hidden="true" className="size-5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Brain Path
// ---------------------------------------------------------------------------------------------

function PathGame({ day, onSolved }: { day: string; onSolved: () => void }) {
  const t = useTranslations('puzzles');
  const toast = useToast();
  const p = useMemo(() => pathOfDay(day), [day]);
  const store = `bg.puzzle.path.${day}`;
  const [line, setLine] = useState<number[]>([]);
  const [done, setDone] = useState<{ seconds: number } | null>(null);
  const [burst, setBurst] = useState(0);
  const started = useRef<number | null>(null);
  const drawing = useRef(false);
  const finish = useFinish('path', day, onSolved);
  useEffect(() => {
    const saved = local.get<{ seconds: number } | null>(store, null);
    if (saved) {
      setDone(saved);
      setLine(p.solution);
    }
  }, [store, p]);

  const visit = useCallback(
    (cell: number) => {
      if (done) return;
      setLine((cur) => {
        const at = cur.indexOf(cell);
        // Going back over the line rubs it out to that square.
        if (at >= 0) return cur.slice(0, at + 1);
        if (!canExtend(p, cur, cell)) return cur;
        started.current ??= Date.now();
        const next = [...cur, cell];
        if (pathSolved(p, next)) {
          const seconds = Math.min(999, Math.round((Date.now() - (started.current ?? Date.now())) / 1000));
          setDone({ seconds });
          local.set(store, { seconds });
          setBurst((b) => b + 1);
          void finish(Math.max(1, 1000 - seconds));
        }
        return next;
      });
    },
    [done, p, store, finish],
  );

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]');
    return el ? Number(el.dataset.cell) : null;
  };
  const pos = new Map(line.map((c, i) => [c, i]));
  const end = line[line.length - 1];

  return (
    <div className="relative flex flex-col items-center gap-4" data-testid="path-game">
      {burst ? <ConfettiBurst key={burst} /> : null}
      <div
        className="grid touch-none select-none gap-1 rounded-card bg-surface-2 p-1.5"
        style={{ gridTemplateColumns: `repeat(${p.size}, minmax(0, 1fr))`, width: 'min(92vw, 26rem)' }}
        onPointerDown={(e) => {
          const c = cellAt(e.clientX, e.clientY);
          if (c == null) return;
          drawing.current = true;
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
          visit(c);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const c = cellAt(e.clientX, e.clientY);
          if (c != null && c !== end) visit(c);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      >
        {Array.from({ length: p.size * p.size }, (_, cell) => {
          const n = p.clues.get(cell);
          const i = pos.get(cell);
          const on = i != null;
          return (
            <div
              key={cell}
              data-cell={cell}
              className={cn(
                'relative flex aspect-square items-center justify-center rounded-md transition-colors',
                on ? (done ? 'bg-success/80' : 'bg-primary/70') : 'bg-surface',
                cell === end && !done && 'ring-2 ring-glow',
              )}
            >
              {n != null ? (
                <span className={cn('flex size-[70%] items-center justify-center rounded-full font-display text-lg font-bold', on ? 'bg-navy-950 text-white' : 'bg-fg text-bg')}>{n}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      {done ? (
        <div className="flex flex-col items-center gap-2 text-center" data-testid="path-result">
          <p className="font-display text-xl font-bold">{t('path.won', { time: `${Math.floor(done.seconds / 60)}:${String(done.seconds % 60).padStart(2, '0')}` })}</p>
          <Button size="sm" variant="secondary" icon={<Share2 aria-hidden="true" className="size-4" />} onClick={async () => (await share(sharePath(day, done.seconds))) && toast(t('copied'))}>
            {t('share')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<Undo2 aria-hidden="true" className="size-4" />} onClick={() => setLine((cur) => cur.slice(0, -1))} disabled={!line.length}>
            {t('undo')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLine([])} disabled={!line.length}>
            {t('reset')}
          </Button>
        </div>
      )}
      <p className="max-w-sm text-center text-sm text-fg-muted">{t('path.how')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The hub at the top of the Daily page
// ---------------------------------------------------------------------------------------------

/** Brain Word and Brain Path, with streaks, Brain Points and streak freezes. */
export function DailyPuzzles() {
  const t = useTranslations('puzzles');
  const act = useAction();
  const { user } = useSession();
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<PuzzleKind>('word');
  useEffect(() => setDay(dayKey()), []);
  const state = useRepoQuery((repo) => (day ? repo.quests.dailyPuzzles(day) : Promise.resolve(null)), [day, user?.id], { topics: ['points', 'session'] });
  if (!day) return null;
  const s = state.data;
  const cards: { kind: PuzzleKind; icon: typeof Type }[] = [
    { kind: 'word', icon: Type },
    { kind: 'path', icon: Route },
  ];
  return (
    <section className="flex flex-col gap-4" aria-labelledby="puzzles-title" data-testid="daily-puzzles">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="puzzles-title" className="text-2xl font-bold">
            {t('title', { number: puzzleNumber(day) })}
          </h2>
          <p className="text-sm text-fg-muted">{user?.username ? t('intro') : t('introGuest')}</p>
        </div>
        {user?.username ? (
          <div className="flex items-center gap-2 text-sm font-bold">
            <Snowflake aria-hidden="true" className="size-4 text-glow" />
            <span data-testid="freezes">{t('freezes', { count: s?.freezes ?? 0 })}</span>
            <Button size="sm" variant="secondary" disabled={(s?.freezes ?? 0) >= 3} onClick={() => void act(async () => (await getRepo()).quests.buyStreakFreeze(), t('freezeBought'))} data-testid="buy-freeze">
              {t('buyFreeze')}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void requestLogin()}>
            {t('signInToSave')}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cards.map(({ kind, icon: Icon }) => {
          const solved = s?.done[kind] != null;
          const streak = s?.streaks[kind]?.streak ?? 0;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={open === kind}
              onClick={() => setOpen(kind)}
              data-testid={`puzzle-${kind}`}
              className={cn(
                'flex flex-col items-start gap-1 rounded-card border-2 p-3 text-left transition-colors sm:p-4',
                open === kind ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:border-fg-muted',
              )}
            >
              <span className="flex w-full items-center justify-between">
                <Icon aria-hidden="true" className="size-6 text-primary" />
                {solved ? <Check aria-label={t('solved')} className="size-5 text-success" /> : null}
              </span>
              <span className="font-display text-lg font-bold">{t(`${kind}.title`)}</span>
              <span className="text-xs text-fg-muted">{t(`${kind}.short`)}</span>
              {streak > 0 ? (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-bold text-warning">
                  <Flame aria-hidden="true" className="size-3.5" />
                  {t('streak', { count: streak })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <Card className="p-4 sm:p-6">
        {open === 'word' ? <WordGame key={`w-${day}`} day={day} onSolved={state.refresh} /> : <PathGame key={`p-${day}`} day={day} onSolved={state.refresh} />}
      </Card>
    </section>
  );
}
