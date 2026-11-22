/**
 * Every game runs on its own origin (`https://g-<game id>.<games domain>`), so one game can never
 * read another game's saves, cookies, IndexedDB or service worker, and never shares an origin with
 * the media or the local test tools. The games domain is separate from the site's domain too.
 *
 * A play path is how builds are stored: `<game id>/<version>/<file>` (or `originals/<slug>/<file>`
 * for the local BS Originals). The first folder becomes the subdomain label and the rest is the
 * path on that origin. The mapping is reversible, so the server (the Cloudflare Worker in
 * workers/play, or scripts/dev-services.mjs locally) can only ever serve a game's own folder.
 *
 * Keep scripts/lib/game-origin.mjs in step with this file (tests/unit/gameOrigin.test.ts checks).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32 = /^[0-9a-f]{32}$/;
/** A DNS-safe folder name: lower-case letters, digits and inner dashes, at most 50 characters. */
const PART = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** The subdomain label for a play path, and the path that remains on that origin. */
export function gameLabel(playPath: string): { label: string; rest: string } | null {
  const segs = playPath.replace(/^\/+/, '').split('/');
  if (segs[0] === 'originals' && segs[1] && PART.test(segs[1])) return { label: `o-${segs[1]}`, rest: segs.slice(2).join('/') };
  const first = segs[0] ?? '';
  if (UUID.test(first)) return { label: `g-${first.replace(/-/g, '')}`, rest: segs.slice(1).join('/') };
  if (PART.test(first) && first !== 'originals' && first !== 'media') return { label: `g-${first}`, rest: segs.slice(1).join('/') };
  return null;
}

/** The storage folder a label stands for (the inverse of gameLabel), or null for anything else. */
export function labelToFolder(label: string): string | null {
  const o = /^o-(.+)$/.exec(label);
  if (o) return PART.test(o[1]!) ? `originals/${o[1]}` : null;
  const g = /^g-(.+)$/.exec(label);
  if (!g) return null;
  const id = g[1]!;
  if (HEX32.test(id)) return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  return PART.test(id) && id !== 'originals' && id !== 'media' ? id : null;
}

/** True when a pattern such as `https://{game}.bgplay.net` is usable. */
export function validPattern(pattern: string): boolean {
  return /^https?:\/\/\{game\}\.[a-z0-9.-]+(:\d+)?$/.test(pattern);
}

/**
 * The URL a game build is framed from. With no pattern (or a path that cannot be mapped) it
 * falls back to the shared play origin; the live build refuses to start without a pattern.
 */
export function gamePlayUrl(playPath: string, pattern: string, fallbackOrigin: string): string {
  const path = playPath.replace(/^\/+/, '');
  const g = validPattern(pattern) ? gameLabel(path) : null;
  if (!g) return `${fallbackOrigin}/${path}`;
  return `${pattern.replace('{game}', g.label)}/${g.rest}`;
}

/** The CSP source for every game origin, e.g. `https://*.bgplay.net`. */
export function gameOriginSource(pattern: string): string | null {
  return validPattern(pattern) ? pattern.replace('{game}', '*') : null;
}

/** True when `origin` is one of the game origins of `pattern`. */
export function isGameOrigin(origin: string, pattern: string): boolean {
  if (!validPattern(pattern)) return false;
  const [scheme, rest] = pattern.split('{game}') as [string, string];
  if (!origin.startsWith(scheme) || !origin.endsWith(rest)) return false;
  const label = origin.slice(scheme.length, origin.length - rest.length);
  return labelToFolder(label) !== null;
}
