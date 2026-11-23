'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const EVENT = 'bg:navstart';

/** Called by links when the router starts moving to `href`. */
export function startNavProgress(href: string): void {
  if (typeof window === 'undefined') return;
  const target = new URL(href, window.location.href);
  if (target.pathname === window.location.pathname) return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * A thin bar at the top of the screen while the next page loads, so a click never feels frozen.
 * It appears only if loading takes longer than 120 ms and finishes when the address changes.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const safety = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const start = () => {
      clearTimeout(pending.current);
      clearTimeout(safety.current);
      pending.current = setTimeout(() => setState('loading'), 120);
      // Never stay up for good (a cancelled or failed navigation).
      safety.current = setTimeout(() => setState('idle'), 10_000);
    };
    window.addEventListener(EVENT, start);
    return () => {
      clearTimeout(pending.current);
      clearTimeout(safety.current);
      window.removeEventListener(EVENT, start);
    };
  }, []);

  useEffect(() => {
    // The new page is here: cancel a bar that has not appeared yet, finish one that has.
    clearTimeout(pending.current);
    clearTimeout(safety.current);
    setState((s) => (s === 'loading' ? 'done' : 'idle'));
    const hide = setTimeout(() => setState('idle'), 300);
    return () => clearTimeout(hide);
  }, [pathname]);

  if (state === 'idle') return null;
  return (
    <div
      aria-hidden="true"
      data-testid="nav-progress"
      className={`nav-progress fixed inset-x-0 top-0 z-[100] h-[3px] origin-left bg-glow ${state === 'loading' ? 'nav-progress--loading' : 'nav-progress--done'}`}
    />
  );
}
