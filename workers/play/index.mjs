// Cloudflare Worker for the game origins: https://g-<game id>.<games domain>/<version>/<file>.
//
// Every game gets its own origin, so games cannot read each other's saves, cookies or storage,
// and none of them shares an origin with the site. The Worker reads the game's files from the R2
// bucket (binding BUILDS) and serves only that game's own folder, with headers that:
// - let only our sites frame a game page (sitelock: nobody can put our games on their site);
// - stop forms posting to other sites and switch off camera, microphone, location and payments;
// - serve each file with the type of its extension (a ".js" can never act as a web page).
// Builds are write-once (presign-upload), so files are cached for a long time.
//
// Setup: docs/DEPLOY.md, "Game origins". Local twin: scripts/dev-services.mjs.
import { gameHeaders, gameKey } from '../../scripts/lib/game-origin.mjs';

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
  txt: 'text/plain; charset=utf-8', xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', data: 'application/octet-stream', bin: 'application/octet-stream',
  unityweb: 'application/octet-stream', pck: 'application/octet-stream', mem: 'application/octet-stream',
  br: 'application/octet-stream', gz: 'application/gzip', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', atlas: 'text/plain; charset=utf-8',
  fnt: 'text/plain; charset=utf-8', glb: 'model/gltf-binary', gltf: 'model/gltf+json', ktx2: 'image/ktx2',
  basis: 'application/octet-stream', map: 'application/json',
};

const text = (status, body, extra = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra } });

/** Handles one request. Exported for tests. */
export async function handle(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed', { allow: 'GET, HEAD' });
  const url = new URL(request.url);
  const domain = String(env.GAMES_DOMAIN ?? '').toLowerCase();
  const host = url.hostname.toLowerCase();
  if (!domain || !host.endsWith(`.${domain}`)) return text(404, 'Not found');
  const label = host.slice(0, -domain.length - 1);
  if (label.includes('.')) return text(404, 'Not found');
  const key = gameKey(label, url.pathname);
  if (!key) return text(404, 'Not found');
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const type = TYPES[ext];
  if (!type) return text(404, 'Not found');

  const object = await env.BUILDS.get(key);
  if (!object) return text(404, 'Not found');
  const etag = object.httpEtag ?? `"${object.etag ?? ''}"`;
  const siteOrigins = String(env.SITE_ORIGINS ?? '').split(/\s+/).filter(Boolean);
  const headers = {
    'content-type': type,
    etag,
    // Files never change after upload; the game page itself is re-checked every hour.
    'cache-control': ext === 'html' || ext === 'htm' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
    ...gameHeaders(type, siteOrigins),
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers: { ...headers, 'content-length': String(object.size) } });
}

export default {
  fetch(request, env) {
    return handle(request, env).catch(() => text(500, 'Something went wrong'));
  },
};
