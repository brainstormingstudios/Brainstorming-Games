'use client';

import type { SessionUser } from '@/lib/data/repo';

/**
 * A promise-based login prompt. Anything (the SDK bridge, a "log in to save" button) can call
 * `requestLogin()`; the LoginDialog mounted in the app shell opens and resolves it with the
 * signed-in user, or null if the player closes it.
 */
type Resolver = (user: SessionUser | null) => void;

const waiting: Resolver[] = [];
const listeners = new Set<(open: boolean) => void>();

export function requestLogin(): Promise<SessionUser | null> {
  return new Promise((resolve) => {
    waiting.push(resolve);
    listeners.forEach((l) => l(true));
  });
}

export function settleLogin(user: SessionUser | null): void {
  waiting.splice(0).forEach((r) => r(user));
  listeners.forEach((l) => l(false));
}

export function onLoginRequest(listener: (open: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
