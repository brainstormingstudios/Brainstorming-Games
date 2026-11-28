'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, Delete, Flame, Grid3x3, Hash, Lightbulb, Route, Share2, Snowflake, Type, Undo2 } from 'lucide-react';
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
import { CrosswordGame, SudokuGame } from './MorePuzzles';
import { useSession } from '@/lib/hooks/useSession';

/** Copies the share text (or opens the phone's share sheet). */
export async function share(text: string): Promise<boolean> {
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
export function useFinish(kind: PuzzleKind, day: string, onDone: () => void) {
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

/** "Hint · 30 BP": signed-in players spend Brain Points; guests are asked to sign in. */
export function HintButton({ kind, day, used, onHint, disabled }: { kind: PuzzleKind; day: string; used: number; onHint: (n: number) => void; disabled?: boolean }) {
  const t = useTranslations('puzzles');
  const act = useAction();
  const { user } = useSession();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Lightbulb aria-hidden="true" className="size-4" />}
      disabled={disabled || used >= 3}
      data-testid={`hint-${kind}`}
      onClick={() => {
        if (!user?.username) return void requestLogin();
        void act(async () => onHint(await (await getRepo()).quests.buyHint(kind, day)));
      }}
    >
      {t('hint', { used, max: 3 })}
    </Button>
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
  // The dictionary (about 76 KB) loads with the puzzle, not with the page.
  const dictionary = useRef<Set<string> | null>(null);
  useEffect(() => {
    void import('@/lib/domain/words5').then((m) => (dictionary.current = new Set(m.GUESSES.split(' '))));
  }, []);
  const won = guesses.includes(answer);
  const over = won || guesses.length >= WORD_TRIES;
  const hintKey = `bg.puzzle.word.hints.${day}`;
  const [hints, setHints] = useState(0);
  useEffect(() => setHints(local.get<number>(hintKey, 0)), [hintKey]);
  // Hints reveal letters in order, skipping places already found.
  const found = new Set(guesses.flatMap((g) => markGuess(g, answer).flatMap((m, i) => (m === 'correct' ? [i] : []))));
  const revealed = [0, 1, 2, 3, 4].filter((i) => !found.has(i)).slice(0, hints);

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
        if (dictionary.current && !dictionary.current.has(typing) && typing !== answer) {
          setShake(true);
          window.setTimeout(() => setShake(false), 400);
          toast(t('notAWord'));
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
      {revealed.length && !over ? (
        <p className="text-sm font-bold text-glow" data-testid="word-hints">
          {revealed.map((i) => t('letterHint', { place: i + 1, letter: answer[i]!.toUpperCase() })).join(' · ')}
        </p>
      ) : null}
      {!over ? (
        <HintButton
          kind="word"
          day={day}
          used={hints}
          onHint={(n) => {
            setHints(n);
            local.set(hintKey, n);
          }}
        />
      ) : null}
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
      <div className="flex w-full max-w-xl flex-col gap-2" aria-label={t('keyboard')}>
        {KEY_ROWS.map((row, i) => (
          <div key={row} className="flex justify-center gap-1.5">
            {i === 2 ? (
              <button type="button" onClick={() => press('enter')} className="h-14 rounded-lg bg-primary px-3 text-sm font-bold text-primary-fg sm:h-16" data-testid="word-enter">
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
                  className={cn('h-14 min-w-0 flex-1 rounded-lg text-lg font-bold uppercase active:scale-95 sm:h-16 sm:text-xl', m ? markClass[m] : 'bg-surface-2 text-fg')}
                >
                  {k}
                </button>
              );
            })}
            {i === 2 ? (
              <button type="button" onClick={() => press('back')} aria-label={t('back')} className="flex h-14 items-center rounded-lg bg-surface-2 px-3 sm:h-16">
                <Delete aria-hidden="true" className="size-6" />
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
  const [pathHints, setPathHints] = useState(0);
  useEffect(() => setPathHints(local.get<number>(`bg.puzzle.path.hints.${day}`, 0)), [day]);
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
        style={{ gridTemplateColumns: `repeat(${p.size}, minmax(0, 1fr))`, width: 'min(100%, 26rem)' }}
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
        <div className="flex flex-wrap justify-center gap-2">
          <HintButton
            kind="path"
            day={day}
            used={pathHints}
            onHint={(n) => {
              setPathHints(n);
              local.set(`bg.puzzle.path.hints.${day}`, n);
              // Keep the part of the line that matches a solution, then draw 4 more squares.
              setLine((cur) => {
                let keep = 0;
                while (keep < cur.length && cur[keep] === p.solution[keep]) keep += 1;
                return p.solution.slice(0, Math.min(p.solution.length - 1, keep + 4));
              });
              started.current ??= Date.now();
            }}
          />
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

/** The daily puzzles: one tile each (with its own streak); a tile opens its puzzle. */
const PUZZLES: { kind: PuzzleKind; icon: typeof Type }[] = [
  { kind: 'word', icon: Type },
  { kind: 'crossword', icon: Grid3x3 },
  { kind: 'sudoku', icon: Hash },
  { kind: 'path', icon: Route },
];

export function DailyPuzzles() {
  const t = useTranslations('puzzles');
  const act = useAction();
  const { user } = useSession();
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpenState] = useState<PuzzleKind | null>(null);
  useEffect(() => {
    setDay(dayKey());
    // ?p=word opens a puzzle directly; the browser's back button returns to the tiles.
    const read = () => {
      const q = new URLSearchParams(window.location.search).get('p');
      setOpenState(PUZZLES.some((x) => x.kind === q) ? (q as PuzzleKind) : null);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const setOpen = (kind: PuzzleKind | null) => {
    const url = new URL(window.location.href);
    if (kind) url.searchParams.set('p', kind);
    else url.searchParams.delete('p');
    window.history.pushState(null, '', url);
    setOpenState(kind);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const state = useRepoQuery((repo) => (day ? repo.quests.dailyPuzzles(day) : Promise.resolve(null)), [day, user?.id], { topics: ['points', 'session'] });
  if (!day) return null;
  const s = state.data;
  const solvedLocally = (kind: PuzzleKind) => {
    const saved = local.get<unknown>(`bg.puzzle.${kind}.${day}`, null);
    if (kind === 'word') return Array.isArray(saved) && saved.includes(wordOfDay(day));
    if (!saved || typeof saved !== 'object') return false;
    return 'seconds' in saved || ('done' in saved && (saved as { done: unknown }).done != null);
  };
  const game =
    open === 'word' ? <WordGame key={`w-${day}`} day={day} onSolved={state.refresh} />
    : open === 'path' ? <PathGame key={`p-${day}`} day={day} onSolved={state.refresh} />
    : open === 'sudoku' ? <SudokuGame key={`s-${day}`} day={day} onSolved={state.refresh} />
    : open === 'crossword' ? <CrosswordGame key={`c-${day}`} day={day} onSolved={state.refresh} />
    : null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="puzzles-title" data-testid="daily-puzzles">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="puzzles-title" className="text-2xl font-bold">
            {open ? t(`${open}.title`) : t('title', { number: puzzleNumber(day) })}
          </h2>
          <p className="text-sm text-fg-muted">{open ? t(`${open}.short`) : user?.username ? t('intro') : t('introGuest')}</p>
        </div>
        {user?.username ? (
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
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
      {open ? (
        <>
          <Button size="sm" variant="ghost" className="self-start" icon={<ArrowLeft aria-hidden="true" className="size-4" />} onClick={() => setOpen(null)} data-testid="puzzles-back">
            {t('allPuzzles')}
          </Button>
          <Card className="p-3 sm:p-6">{game}</Card>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PUZZLES.map(({ kind, icon: Icon }) => {
            const solved = s?.done[kind] != null || solvedLocally(kind);
            const streak = s?.streaks[kind]?.streak ?? 0;
            const best = s?.streaks[kind]?.best ?? 0;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setOpen(kind)}
                data-testid={`puzzle-${kind}`}
                className={cn(
                  'group flex min-h-40 flex-col items-start gap-1.5 rounded-card border-2 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-glow',
                  solved ? 'border-success/50 bg-success/5' : 'border-border bg-surface',
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15">
                    <Icon aria-hidden="true" className="size-6 text-primary" />
                  </span>
                  {solved ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-bold text-success">
                      <Check aria-hidden="true" className="size-3.5" />
                      {t('solved')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-fg">{t('play')}</span>
                  )}
                </span>
                <span className="font-display text-lg font-bold">{t(`${kind}.title`)}</span>
                <span className="text-xs text-fg-muted">{t(`${kind}.short`)}</span>
                <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs font-bold">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5', streak > 0 ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-fg-muted')}>
                    <Flame aria-hidden="true" className="size-3.5" />
                    {t('streak', { count: streak })}
                  </span>
                  {best > 0 ? <span className="text-fg-muted">{t('best', { count: best })}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
