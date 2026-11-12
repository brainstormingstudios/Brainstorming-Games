'use client';

import { getRepo } from '@/lib/data';
import { getAnonId, getDeviceClass, referral } from '@/lib/data/local';
import type { EventContext } from '@/lib/data/repo';
import type { EventInput, EventType } from '@/lib/data/types';

/**
 * Client event queue. Events are first-party KPI signals keyed by a random anonymous id: no
 * names, no emails, no cross-site tracking. They are sent in batches to stay inside the free
 * tier, and flushed when the tab is hidden so a closed tab does not lose the session.
 */
const FLUSH_MS = 20_000;
const MAX_BATCH = 25;

let queue: EventInput[] = [];
let timer: number | null = null;
let installed = false;

function context(): EventContext {
  return { anonId: getAnonId(), device: getDeviceClass(), refStudio: referral.current() };
}

async function flush(): Promise<void> {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const repo = await getRepo();
    await repo.events.ingest(batch, context());
  } catch {
    // Analytics must never break play. Dropped batches are simply not counted.
  }
}

function flushOnUnload(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  void getRepo().then((repo) => repo.events.ingestOnUnload(batch, context()));
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnUnload();
  });
  window.addEventListener('pagehide', flushOnUnload);
}

export interface TrackOptions {
  gameId?: string | null;
  versionId?: string | null;
  sessionId?: string | null;
  payload?: Record<string, unknown>;
  /** Send right away instead of waiting for the batch timer. */
  immediate?: boolean;
}

export function track(type: EventType, options: TrackOptions = {}): void {
  if (typeof window === 'undefined') return;
  install();
  queue.push({
    type,
    ts: new Date().toISOString(),
    sessionId: options.sessionId ?? null,
    gameId: options.gameId ?? null,
    versionId: options.versionId ?? null,
    payload: options.payload ?? {},
  });
  if (options.immediate || queue.length >= MAX_BATCH) void flush();
  else if (timer == null) timer = window.setTimeout(() => void flush(), FLUSH_MS);
}

export const flushEvents = flush;
