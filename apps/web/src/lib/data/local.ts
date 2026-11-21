/**
 * Guest-local storage. A guest's id, favourites, history and votes live in this browser only;
 * nothing personal is sent anywhere. Logging in merges them into the account (phase 3).
 */
import type { DeviceClass, HistoryEntry, MyRating } from './types';

const hasWindow = typeof window !== 'undefined';

function safeStorage(kind: 'local' | 'session'): Storage | null {
  if (!hasWindow) return null;
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = '__bg_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    // Private mode or blocked storage: fall back to memory for this page view.
    return null;
  }
}

const memory = new Map<string, string>();

function makeStore(kind: 'local' | 'session') {
  let cached: Storage | null | undefined;
  const backing = () => (cached === undefined ? (cached = safeStorage(kind)) : cached);
  return {
    getRaw(key: string): string | null {
      const s = backing();
      return s ? s.getItem(key) : (memory.get(`${kind}:${key}`) ?? null);
    },
    get<T>(key: string, fallback: T): T {
      const raw = this.getRaw(key);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown): void {
      const raw = JSON.stringify(value);
      const s = backing();
      if (!s) {
        memory.set(`${kind}:${key}`, raw);
        return;
      }
      try {
        s.setItem(key, raw);
      } catch (err) {
        console.warn(`[storage] could not write ${key}`, err);
      }
    },
    remove(key: string): void {
      const s = backing();
      if (s) s.removeItem(key);
      else memory.delete(`${kind}:${key}`);
    },
  };
}

export const local = makeStore('local');
export const session = makeStore('session');

export function uuid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // Insecure contexts have no randomUUID: build an RFC 4122 v4 id from getRandomValues.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const KEYS = {
  anon: 'bg.anon',
  favourites: 'bg.favourites',
  history: 'bg.history',
  ratings: 'bg.ratings',
  ref: 'bg.ref',
  creator: 'bg.creator',
} as const;

/** A random id for this browser. It carries no personal data. */
export function getAnonId(): string {
  let id = local.get<string | null>(KEYS.anon, null);
  if (!id || typeof id !== 'string') {
    id = uuid();
    local.set(KEYS.anon, id);
  }
  return id;
}

export const guestFavourites = {
  list: (): string[] => local.get<string[]>(KEYS.favourites, []),
  set(gameId: string, on: boolean): string[] {
    const current = new Set(this.list());
    if (on) current.add(gameId);
    else current.delete(gameId);
    const next = [...current];
    local.set(KEYS.favourites, next);
    return next;
  },
  clear: () => local.remove(KEYS.favourites),
};

const HISTORY_LIMIT = 60;

export const guestHistory = {
  list: (): HistoryEntry[] => local.get<HistoryEntry[]>(KEYS.history, []),
  record(game: { id: string; slug: string }, seconds: number, newSession: boolean): HistoryEntry[] {
    const list = this.list();
    const now = new Date().toISOString();
    const existing = list.find((h) => h.gameId === game.id);
    const entry: HistoryEntry = existing
      ? {
          ...existing,
          slug: game.slug,
          lastPlayedAt: now,
          playCount: existing.playCount + (newSession ? 1 : 0),
          secondsPlayed: existing.secondsPlayed + Math.max(0, Math.round(seconds)),
        }
      : { gameId: game.id, slug: game.slug, lastPlayedAt: now, playCount: 1, secondsPlayed: Math.max(0, Math.round(seconds)) };
    const next = [entry, ...list.filter((h) => h.gameId !== game.id)].slice(0, HISTORY_LIMIT);
    local.set(KEYS.history, next);
    return next;
  },
  clear: () => local.remove(KEYS.history),
};

export const guestRatings = {
  all: (): Record<string, MyRating> => local.get<Record<string, MyRating>>(KEYS.ratings, {}),
  get(gameId: string): MyRating | null {
    return this.all()[gameId] ?? null;
  },
  set(gameId: string, rating: MyRating | null): void {
    const all = this.all();
    if (rating) all[gameId] = rating;
    else delete all[gameId];
    local.set(KEYS.ratings, all);
  },
};

/** Referral attribution: `?ref=studioSlug` is remembered for 30 days. */
export const referral = {
  capture(search: string): void {
    const ref = new URLSearchParams(search).get('ref');
    if (ref && /^[a-z0-9-]{2,40}$/.test(ref)) local.set(KEYS.ref, { slug: ref, at: Date.now() });
  },
  current(): string | null {
    const value = local.get<{ slug: string; at: number } | null>(KEYS.ref, null);
    if (!value) return null;
    if (Date.now() - value.at > 30 * 86_400_000) {
      local.remove(KEYS.ref);
      return null;
    }
    return value.slug;
  },
};

/** Creator attribution: `?cr=handle` is remembered for 30 days (a newer link replaces it). */
export const creatorRef = {
  capture(search: string): string | null {
    const handle = new URLSearchParams(search).get('cr')?.toLowerCase() ?? null;
    if (handle && /^[a-z0-9_]{3,24}$/.test(handle)) {
      local.set(KEYS.creator, { handle, at: Date.now() });
      return handle;
    }
    return null;
  },
  current(): string | null {
    const value = local.get<{ handle: string; at: number } | null>(KEYS.creator, null);
    if (!value) return null;
    if (Date.now() - value.at > 30 * 86_400_000) {
      local.remove(KEYS.creator);
      return null;
    }
    return value.handle;
  },
};

export function getDeviceClass(): DeviceClass {
  if (!hasWindow) return 'desktop';
  const ua = navigator.userAgent;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const width = Math.min(window.screen?.width ?? window.innerWidth, window.screen?.height ?? window.innerHeight);
  if (/iPad|Tablet/i.test(ua) || (coarse && width >= 600 && !/Mobi/i.test(ua))) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua) || (coarse && width < 600)) return 'mobile';
  return 'desktop';
}
