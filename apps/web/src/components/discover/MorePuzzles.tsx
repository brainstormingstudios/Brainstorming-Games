'use client';

import { useTranslations } from 'next-intl';
import { Delete, Eraser, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ConfettiBurst, cn, useToast } from '@brainstorming/ui';
import { local } from '@/lib/data/local';
import { crosswordOfDay, crosswordSolved, type CrosswordEntry } from '@/lib/domain/crossword';
import { puzzleNumber } from '@/lib/domain/puzzles';
import { clashes, sudokuOfDay, sudokuSolved } from '@/lib/domain/sudoku';
import { HintButton, share, useFinish } from './DailyPuzzles';

const time = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------------------------------------
// Sudoku
// ---------------------------------------------------------------------------------------------

export function SudokuGame({ day, onSolved }: { day: string; onSolved: () => void }) {
  const t = useTranslations('puzzles');
  const toast = useToast();
  const p = useMemo(() => sudokuOfDay(day), [day]);
  const store = `bg.puzzle.sudoku.${day}`;
  const [grid, setGrid] = useState<number[]>(p.givens);
  const [sel, setSel] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [hints, setHints] = useState(0);
  const [burst, setBurst] = useState(0);
  const started = useRef<number | null>(null);
  const finish = useFinish('sudoku', day, onSolved);
  useEffect(() => {
    const saved = local.get<{ grid: number[]; done: number | null } | null>(store, null);
    if (saved?.grid?.length === 81) {
      setGrid(saved.grid);
      setDone(saved.done);
    }
    setHints(local.get<number>(`${store}.hints`, 0));
  }, [store]);
  const bad = clashes(grid);

  const put = (n: number) => {
    if (sel == null || p.givens[sel] || done != null) return;
    started.current ??= Date.now();
    const next = [...grid];
    next[sel] = n;
    setGrid(next);
    let solvedIn: number | null = null;
    if (sudokuSolved(next, p)) {
      solvedIn = Math.min(5999, Math.round((Date.now() - (started.current ?? Date.now())) / 1000));
      setDone(solvedIn);
      setBurst((b) => b + 1);
      void finish(Math.max(1, 1000 - Math.floor(solvedIn / 6)));
    }
    local.set(store, { grid: next, done: solvedIn });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) put(Number(e.key));
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') put(0);
      else if (sel != null && e.key.startsWith('Arrow')) {
        const d = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key] ?? 0;
        setSel(Math.min(80, Math.max(0, sel + d)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const same = sel != null && grid[sel] ? grid[sel] : 0;
  return (
    <div className="relative flex flex-col items-center gap-4" data-testid="sudoku-game">
      {burst ? <ConfettiBurst key={burst} /> : null}
      <div className="grid grid-cols-9 overflow-hidden rounded-card border-2 border-fg/70 bg-surface" style={{ width: 'min(100%, 30rem)' }} role="grid" aria-label={t('sudoku.title')}>
        {grid.map((n, i) => {
          const r = Math.floor(i / 9);
          const c = i % 9;
          const given = Boolean(p.givens[i]);
          const peer = sel != null && (Math.floor(sel / 9) === r || sel % 9 === c || (Math.floor(Math.floor(sel / 9) / 3) === Math.floor(r / 3) && Math.floor((sel % 9) / 3) === Math.floor(c / 3)));
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-label={t('sudoku.cell', { row: r + 1, col: c + 1, value: n || '' })}
              onClick={() => setSel(i)}
              className={cn(
                'flex aspect-square items-center justify-center border-border font-display text-lg font-bold sm:text-2xl',
                c % 3 === 2 && c < 8 ? 'border-r-2 border-r-fg/70' : 'border-r',
                r % 3 === 2 && r < 8 ? 'border-b-2 border-b-fg/70' : 'border-b',
                sel === i ? 'bg-primary/40' : peer ? 'bg-primary/10' : same && n === same ? 'bg-primary/20' : '',
                given ? 'text-fg' : 'text-primary',
                bad.has(i) && !given && 'text-danger',
                done != null && 'bg-success/15',
              )}
            >
              {n || ''}
            </button>
          );
        })}
      </div>
      {done != null ? (
        <div className="flex flex-col items-center gap-2 text-center" data-testid="sudoku-result">
          <p className="font-display text-xl font-bold">{t('sudoku.won', { time: time(done) })}</p>
          <Button size="sm" variant="secondary" icon={<Share2 aria-hidden="true" className="size-4" />} onClick={async () => (await share(`Brain Sudoku #${puzzleNumber(day)} solved in ${time(done)} 🧠`)) && toast(t('copied'))}>
            {t('share')}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid w-full max-w-md grid-cols-5 gap-2 sm:grid-cols-10">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} type="button" onClick={() => put(n)} className="h-14 rounded-lg bg-surface-2 font-display text-2xl font-bold active:scale-95" data-testid={`sudoku-${n}`}>
                {n}
              </button>
            ))}
            <button type="button" onClick={() => put(0)} aria-label={t('erase')} className="flex h-14 items-center justify-center rounded-lg bg-surface-2 active:scale-95">
              <Eraser aria-hidden="true" className="size-6" />
            </button>
          </div>
          <HintButton
            kind="sudoku"
            day={day}
            used={hints}
            onHint={(n) => {
              setHints(n);
              local.set(`${store}.hints`, n);
              // Fill one empty or wrong square with its answer.
              const i = grid.findIndex((v, k) => v !== p.solution[k]);
              if (i >= 0) {
                setSel(i);
                const next = [...grid];
                next[i] = p.solution[i]!;
                setGrid(next);
                local.set(store, { grid: next, done: null });
              }
            }}
          />
        </>
      )}
      <p className="max-w-sm text-center text-sm text-fg-muted">{t('sudoku.how')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Mini Crossword
// ---------------------------------------------------------------------------------------------

export function CrosswordGame({ day, onSolved }: { day: string; onSolved: () => void }) {
  const t = useTranslations('puzzles');
  const toast = useToast();
  const c = useMemo(() => crosswordOfDay(day), [day]);
  const store = `bg.puzzle.crossword.${day}`;
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [active, setActive] = useState<CrosswordEntry>(c.entries[0]!);
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [hints, setHints] = useState(0);
  const [burst, setBurst] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef<number | null>(null);
  const finish = useFinish('crossword', day, onSolved);
  useEffect(() => {
    const saved = local.get<{ letters: Record<string, string>; done: number | null } | null>(store, null);
    if (saved) {
      setLetters(saved.letters);
      setDone(saved.done);
    }
    setHints(local.get<number>(`${store}.hints`, 0));
  }, [store]);

  const cellOf = (e: CrosswordEntry, k: number) => `${e.row + (e.across ? 0 : k)},${e.col + (e.across ? k : 0)}`;
  const activeCells = new Set(active.word.split('').map((_, k) => cellOf(active, k)));
  const save = (next: Record<string, string>) => {
    setLetters(next);
    let solvedIn: number | null = null;
    if (crosswordSolved(c, next)) {
      solvedIn = Math.min(5999, Math.round((Date.now() - (started.current ?? Date.now())) / 1000));
      setDone(solvedIn);
      setBurst((b) => b + 1);
      void finish(Math.max(1, 1000 - Math.floor(solvedIn / 3)));
    }
    local.set(store, { letters: next, done: solvedIn });
  };
  const type = (ch: string) => {
    if (done != null) return;
    started.current ??= Date.now();
    setChecked(false);
    if (ch === 'back') {
      const key = cellOf(active, cursor);
      if (letters[key]) save({ ...letters, [key]: '' });
      else if (cursor > 0) {
        save({ ...letters, [cellOf(active, cursor - 1)]: '' });
        setCursor(cursor - 1);
      }
      return;
    }
    save({ ...letters, [cellOf(active, cursor)]: ch });
    if (cursor < active.word.length - 1) setCursor(cursor + 1);
  };
  const pick = (r: number, col: number) => {
    const key = `${r},${col}`;
    const options = c.entries.filter((e) => e.word.split('').some((_, k) => cellOf(e, k) === key));
    // Tapping the same square again switches between across and down.
    const next = options.find((e) => e !== active) && options.includes(active) && cellOf(active, cursor) === key ? options.find((e) => e !== active)! : (options.find((e) => e === active) ?? options[0]);
    if (!next) return;
    setActive(next);
    setCursor(next.word.split('').findIndex((_, k) => cellOf(next, k) === key));
    input.current?.focus();
  };

  return (
    <div className="relative flex flex-col items-center gap-4" data-testid="crossword-game">
      {burst ? <ConfettiBurst key={burst} /> : null}
      {/* A hidden field, so phones show their own keyboard. */}
      <input
        ref={input}
        aria-label={t('crossword.typeHere')}
        className="sr-only"
        autoCapitalize="characters"
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === 'Backspace') {
            e.preventDefault();
            type('back');
          } else if (/^[a-zA-Z]$/.test(e.key)) {
            e.preventDefault();
            type(e.key.toLowerCase());
          }
        }}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z]/g, '');
          if (v) type(v.slice(-1));
          (e.target as HTMLInputElement).value = '';
        }}
      />
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${c.cols}, minmax(0, 1fr))`, width: `min(100%, ${c.cols * 3.4}rem)` }}>
        {c.grid.flatMap((row, r) =>
          row.map((want, col) => {
            const key = `${r},${col}`;
            if (!want) return <span key={key} aria-hidden="true" />;
            const number = c.entries.find((e) => e.row === r && e.col === col)?.number;
            const got = letters[key] ?? '';
            const isCursor = cellOf(active, cursor) === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => pick(r, col)}
                className={cn(
                  'relative flex aspect-square items-center justify-center rounded-md border-2 font-display text-xl font-bold uppercase sm:text-2xl',
                  isCursor ? 'border-primary bg-primary/30' : activeCells.has(key) ? 'border-primary/50 bg-primary/10' : 'border-border bg-surface',
                  checked && got && got !== want && 'text-danger',
                  done != null && 'border-success bg-success/20',
                )}
              >
                {number ? <span className="absolute top-0.5 left-1 text-[10px] font-bold text-fg-muted">{number}</span> : null}
                {got}
              </button>
            );
          }),
        )}
      </div>
      {done == null ? (
        <p className="w-full max-w-md rounded-control bg-primary/10 px-3 py-2 text-center text-sm font-bold" data-testid="crossword-clue">
          {active.number} {active.across ? t('crossword.across') : t('crossword.down')}: {active.clue}
        </p>
      ) : null}
      {done != null ? (
        <div className="flex flex-col items-center gap-2 text-center" data-testid="crossword-result">
          <p className="font-display text-xl font-bold">{t('crossword.won', { time: time(done) })}</p>
          <Button size="sm" variant="secondary" icon={<Share2 aria-hidden="true" className="size-4" />} onClick={async () => (await share(`Brain Crossword #${puzzleNumber(day)} solved in ${time(done)} 🧠`)) && toast(t('copied'))}>
            {t('share')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => input.current?.focus()}>
            {t('crossword.keyboard')}
          </Button>
          <Button size="sm" variant="ghost" icon={<Delete aria-hidden="true" className="size-4" />} onClick={() => type('back')}>
            {t('back')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChecked(true)} data-testid="crossword-check">
            {t('crossword.check')}
          </Button>
          <HintButton
            kind="crossword"
            day={day}
            used={hints}
            onHint={(n) => {
              setHints(n);
              local.set(`${store}.hints`, n);
              // Fill the first wrong or empty square of the chosen word.
              const k = active.word.split('').findIndex((ch, i) => letters[cellOf(active, i)] !== ch);
              if (k >= 0) save({ ...letters, [cellOf(active, k)]: active.word[k]! });
            }}
          />
        </div>
      )}
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {[true, false].map((across) => (
          <div key={String(across)}>
            <p className="mb-1 font-display font-bold">{across ? t('crossword.across') : t('crossword.down')}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {c.entries
                .filter((e) => e.across === across)
                .map((e) => (
                  <li key={`${e.number}-${across}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setActive(e);
                        setCursor(0);
                        input.current?.focus();
                      }}
                      className={cn('w-full rounded-md px-2 py-1 text-left', e === active ? 'bg-primary/15 font-bold' : 'hover:bg-surface-2')}
                    >
                      <b>{e.number}.</b> {e.clue}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
