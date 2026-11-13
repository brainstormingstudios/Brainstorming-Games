'use client';

import { getRepo } from '@/lib/data';
import type { VariantHit } from '@/lib/data/growthTypes';

/**
 * Counts tile impressions and clicks for covers in a thumbnail A/B test and sends them in small
 * batches. Loaded only when a tile on the page is part of a test.
 *
 * A click usually leaves the page, which can cancel the request that reports it. So the batch is
 * also kept in sessionStorage until it is delivered, and the next page sends what is left.
 */
export const AB_PENDING_KEY = 'bg.ab.pending';

const pending = new Map<string, VariantHit>();
const seen = new Set<string>();
let timer: number | null = null;

function persist(): void {
  try {
    if (pending.size === 0) window.sessionStorage.removeItem(AB_PENDING_KEY);
    else window.sessionStorage.setItem(AB_PENDING_KEY, JSON.stringify([...pending.values()]));
  } catch {
    // storage unavailable: the batch is still sent from memory
  }
}

function flush(): void {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  if (pending.size === 0) return;
  const hits = [...pending.values()];
  void getRepo()
    .then((repo) => repo.growth.recordVariantHits(hits))
    .then(() => {
      // Delivered: drop exactly what was sent, keep anything counted since.
      for (const sent of hits) {
        const key = `${sent.gameId}:${sent.variant}`;
        const now = pending.get(key);
        if (!now) continue;
        now.impressions -= sent.impressions;
        now.clicks -= sent.clicks;
        if (now.impressions <= 0 && now.clicks <= 0) pending.delete(key);
      }
      persist();
    })
    .catch(() => {});
}

function add(gameId: string, variant: string, field: 'impressions' | 'clicks'): void {
  const key = `${gameId}:${variant}`;
  const hit = pending.get(key) ?? { gameId, variant, impressions: 0, clicks: 0 };
  hit[field] += 1;
  pending.set(key, { ...hit });
  persist();
  if (field === 'clicks') flush();
  else timer ??= window.setTimeout(flush, 4000);
}

if (typeof window !== 'undefined') {
  try {
    const left = JSON.parse(window.sessionStorage.getItem(AB_PENDING_KEY) ?? '[]') as VariantHit[];
    for (const h of Array.isArray(left) ? left.slice(0, 100) : []) {
      if (typeof h?.gameId === 'string' && typeof h.variant === 'string') {
        pending.set(`${h.gameId}:${h.variant}`, { gameId: h.gameId, variant: h.variant, impressions: Number(h.impressions) || 0, clicks: Number(h.clicks) || 0 });
      }
    }
  } catch {
    // nothing left over
  }
  if (pending.size > 0) timer = window.setTimeout(flush, 500);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** One impression per cover and page view, however many rails show the game. */
export function recordImpression(gameId: string, variant: string): void {
  const key = `${gameId}:${variant}`;
  if (seen.has(key)) return;
  seen.add(key);
  add(gameId, variant, 'impressions');
}

export function recordClick(gameId: string, variant: string): void {
  add(gameId, variant, 'clicks');
}
