import { GAME_ORIGIN_PATTERN, PLAY_ORIGIN } from '@/lib/config';
import { gamePlayUrl } from '@/lib/play/gameOrigin';
import type { GameSummary, MediaAsset } from '@/lib/data/types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** 1234 becomes "1.2K", 3400000 becomes "3.4M". */
export function formatCount(n: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Date and time in the viewer's own time zone, e.g. "24 Nov 2026, 3:15 pm" (deadlines). */
export function formatDateTime(iso: string | null, locale = 'en'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(iso: string | null, locale = 'en'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

/**
 * Rough seconds to download a game's first load. Uses the browser's own bandwidth estimate when
 * it has one, otherwise assumes a typical 4G link (5 Mbps).
 */
export function estimateLoadSeconds(bytes: number): number {
  let mbps = 5;
  if (typeof navigator !== 'undefined') {
    const downlink = (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink;
    if (downlink && downlink > 0) mbps = downlink;
  }
  return Math.max(1, Math.round((bytes * 8) / (mbps * 1_000_000) + 1));
}

/** URL of one width of a responsive image. Variants share a name and differ by `-<width>.webp`. */
export function variantUrl(asset: MediaAsset, width: number): string {
  if (!asset.widths.includes(width)) return asset.url;
  return asset.url.replace(/-\d+\.webp(\?.*)?$/, `-${width}.webp$1`);
}

export function srcSetFor(asset: MediaAsset, maxWidth = Infinity): string | undefined {
  const widths = asset.widths.filter((w) => w <= maxWidth);
  if (widths.length < 2) return undefined;
  return widths.map((w) => `${variantUrl(asset, w)} ${w}w`).join(', ');
}

/** Absolute URL of a game build, on that game's own origin. */
export function playUrl(game: Pick<GameSummary, 'playPath'>): string | null {
  return game.playPath ? buildUrl(game.playPath) : null;
}

/** Absolute URL of a stored build path (`<game id>/<version>/<file>`), on the game's own origin. */
export function buildUrl(playPath: string): string {
  return gamePlayUrl(playPath, GAME_ORIGIN_PATTERN, PLAY_ORIGIN);
}

/** A stable two-colour gradient for games without a cover, derived from the slug. */
export function fallbackGradient(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  const angle = 120 + (h % 90);
  const stops = [
    ['#ff7a59', '#ffb020'],
    ['#7c5cff', '#19b8e6'],
    ['#12a37a', '#b6e24a'],
    ['#e8467c', '#7c5cff'],
  ][h % 4]!;
  return `linear-gradient(${angle}deg, ${stops[0]}, ${stops[1]})`;
}

export function gameHref(slug: string): string {
  return `/game/${slug}`;
}
