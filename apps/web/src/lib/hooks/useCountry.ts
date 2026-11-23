'use client';

import { useEffect, useState } from 'react';
import { IS_MOCK, PLAY_ORIGIN } from '@/lib/config';

const KEY = 'bg.country';
let pending: Promise<string | null> | null = null;

/**
 * The visitor's country (ISO code) as Cloudflare sees it (the games server's /__geo), or null when
 * unknown. Asked once per
 * tab. Mock mode reads `bg.country` from localStorage (default IN) so tests can play a visitor
 * from abroad.
 */
export function loadCountry(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (IS_MOCK) {
    try {
      return Promise.resolve((window.localStorage.getItem(KEY) ?? 'IN').toUpperCase());
    } catch {
      return Promise.resolve('IN');
    }
  }
  try {
    const cached = window.sessionStorage.getItem(KEY);
    if (cached) return Promise.resolve(cached === '-' ? null : cached);
  } catch {
    // storage unavailable
  }
  pending ??= fetch(`${PLAY_ORIGIN}/__geo`)
    .then((r) => (r.ok ? (r.json() as Promise<{ country: string | null }>) : { country: null }))
    .then(({ country }) => {
      try {
        window.sessionStorage.setItem(KEY, country ?? '-');
      } catch {
        // storage unavailable
      }
      return country;
    })
    .catch(() => null);
  return pending;
}

export function useCountry(): { country: string | null; ready: boolean } {
  const [state, setState] = useState<{ country: string | null; ready: boolean }>({ country: null, ready: false });
  useEffect(() => {
    let live = true;
    void loadCountry().then((country) => live && setState({ country, ready: true }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
