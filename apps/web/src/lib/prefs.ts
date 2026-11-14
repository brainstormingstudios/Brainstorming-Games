'use client';

import { useSyncExternalStore } from 'react';
import { local } from '@/lib/data/local';
import { PREFS_KEY } from '@/lib/prefsBoot';

/** Per-browser preferences. Nothing here is personal data. */
export interface Prefs {
  theme: 'dark' | 'light';
  lowData: boolean;
  schoolSafe: boolean;
  /** SHA-256 of the PIN that turns school-safe mode off. */
  schoolSafePinHash: string | null;
  sidebarCollapsed: boolean;
  /** The mascot has already greeted this visitor. */
  greeted: boolean;
  theatre: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  lowData: false,
  schoolSafe: false,
  schoolSafePinHash: null,
  sidebarCollapsed: false,
  greeted: false,
  theatre: false,
};

const listeners = new Set<() => void>();
let cache: Prefs | null = null;

function read(): Prefs {
  if (cache) return cache;
  const stored = local.get<Partial<Prefs>>(PREFS_KEY, {});
  const saveData =
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  cache = { ...DEFAULT_PREFS, lowData: saveData, ...stored };
  return cache;
}

function apply(p: Prefs): void {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  d.setAttribute('data-theme', p.theme);
  if (p.lowData) d.setAttribute('data-low-data', 'true');
  else d.removeAttribute('data-low-data');
  if (p.sidebarCollapsed) d.setAttribute('data-sidebar', 'collapsed');
  else d.removeAttribute('data-sidebar');
  if (p.schoolSafe) d.setAttribute('data-school-safe', 'true');
  else d.removeAttribute('data-school-safe');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', p.theme === 'light' ? '#ffffff' : '#0d0e10');
}

export function getPrefs(): Prefs {
  return read();
}

export function setPrefs(patch: Partial<Prefs>): void {
  cache = { ...read(), ...patch };
  local.set(PREFS_KEY, cache);
  apply(cache);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PREFS_KEY) return;
    cache = null;
    apply(read());
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = () => DEFAULT_PREFS;

/** Current preferences. Renders the defaults on the server and during hydration. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}

export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`bg-school-safe:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
