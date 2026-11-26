'use client';

import { useTranslations } from 'next-intl';
import { Gamepad2, Hand, Keyboard } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@brainstorming/ui';
import type { ControlRow } from '@/lib/data/types';

/** Splits "Arrow keys / WASD, Space or click" into key caps; keeps phrases like "Arrow keys" whole. */
export function keyCaps(text: string): string[] {
  return text
    .split(/\s*(?:\/|,|\bor\b|\+|\|)\s*/i)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * "Controls" in the game toolbar: a premium card with every control, so players never scroll
 * down the page to find them. Opens on hover or keyboard focus (desktop) and on tap (phones,
 * where it is a sheet above the tab bar). Escape or a tap outside closes it.
 */
export function ControlsPanel({ controls, className }: { controls: ControlRow[]; className?: string }) {
  const t = useTranslations('game');
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rows = controls.filter((c) => c.action.trim());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (rows.length === 0) return null;
  const hover = (on: boolean) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(on), on ? 120 : 220);
  };

  return (
    <div
      ref={wrap}
      className={cn('relative', className)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && hover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && hover(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        data-testid="controls-button"
        className={cn(
          'flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-sm font-bold transition-colors hover:bg-surface-2 sm:px-3',
          open && 'bg-surface-2 text-glow',
        )}
      >
        <Gamepad2 aria-hidden="true" className="size-5" />
        <span className="hidden md:inline">{t('controlsButton')}</span>
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={t('controlsTitle')}
          data-testid="controls-panel"
          className={cn(
            'z-[60] animate-pop-in overflow-hidden rounded-card border border-glow/40 bg-surface-3/95 shadow-glow backdrop-blur-xl',
            // Phones: a sheet above the tab bar. Larger screens: a card above the button.
            'fixed inset-x-3 bottom-[calc(var(--tabs-h)+12px)] sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-[calc(100%+10px)] sm:w-[22rem]',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-glow/15 to-transparent px-4 py-3">
            <Gamepad2 aria-hidden="true" className="size-5 text-glow" />
            <p className="font-display text-base font-bold">{t('controlsTitle')}</p>
          </div>
          <ul className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto">
            {rows.map((c, i) => (
              <li key={`${c.action}-${i}`} className="flex flex-col gap-1.5 px-4 py-2.5">
                <span className="text-sm font-bold">{c.action}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {c.keyboard.trim() ? (
                    <>
                      <Keyboard aria-label={t('controlsKeyboard')} className="size-4 text-fg-muted" />
                      {keyCaps(c.keyboard).map((k) => (
                        <kbd key={k} className="rounded-md border border-border border-b-2 bg-surface px-1.5 py-0.5 font-mono text-xs font-bold">
                          {k}
                        </kbd>
                      ))}
                    </>
                  ) : null}
                  {c.touch.trim() ? (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-glow/10 px-2 py-0.5 text-xs font-bold text-glow">
                      <Hand aria-label={t('controlsTouch')} className="size-3.5" />
                      {c.touch}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
