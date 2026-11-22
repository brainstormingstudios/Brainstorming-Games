// Cloudflare Worker for the game origins: https://g-<game id>.<games domain>/<version>/<file>.
//
// Every game gets its own origin, so games cannot read each other's saves, cookies or storage,
// and none of them shares an origin with the site. The Worker reads the game's files from storage
// and serves only that game's own folder, with headers that:
// - let only our sites frame a game page (sitelock: nobody can put our games on their site);
// - stop forms posting to other sites and switch off camera, microphone, location and payments;
// - serve each file with the type of its extension (a ".js" can never act as a web page).
// Builds are write-once (presign-upload), so files are cached for a long time.
//
// Storage, either:
// - Supabase Storage (free launch): the private "builds" bucket, read with the secret key
//   SUPABASE_STORAGE_KEY (`wrangler secret put`) from SUPABASE_URL (migration 0025);
// - Cloudflare R2: the binding BUILDS, when wrangler.toml has an [[r2_buckets]] entry.
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

/**
 * The storage key for a request, or null. Two modes:
 * - games domain (GAMES_DOMAIN): g-<id>.<domain>/<path> → <id>/<path>, every game its own origin;
 * - shared address (free launch, SHARED_HOST, e.g. bg-play.<account>.workers.dev):
 *   /<game folder>/<path> → <game folder>/<path>, all games on one origin.
 */
function keyFor(url, env) {
  const host = url.hostname.toLowerCase();
  const domain = String(env.GAMES_DOMAIN ?? '').toLowerCase();
  if (domain && host.endsWith(`.${domain}`)) {
    const label = host.slice(0, -domain.length - 1);
    return label.includes('.') ? null : gameKey(label, url.pathname);
  }
  const shared = String(env.SHARED_HOST ?? '').toLowerCase();
  if (shared && host === shared) {
    // The first folder must be a game folder (a game id, or originals/<slug>); map it to a label so
    // the same path rules apply.
    const m = /^\/(originals\/)?([a-z0-9-]{1,64})(\/.*)$/.exec(url.pathname);
    if (!m) return null;
    const id = m[2];
    const label = m[1] ? `o-${id}` : `g-${/^[0-9a-f-]{36}$/.test(id) ? id.replace(/-/g, '') : id}`;
    return gameKey(label, m[3]);
  }
  return null;
}

const encodeKey = (key) => key.split('/').map((s) => encodeURIComponent(s)).join('/');

/** One stored file as { body, size, etag }, or null when it does not exist. */
async function readObject(env, key, html) {
  if (env.BUILDS) {
    const o = await env.BUILDS.get(key);
    return o ? { body: o.body, size: o.size, etag: o.httpEtag ?? `"${o.etag ?? ''}"` } : null;
  }
  const base = String(env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const secret = String(env.SUPABASE_STORAGE_KEY ?? '');
  if (!base || !secret) throw new Error('storage is not configured');
  const bucket = String(env.STORAGE_BUCKET || 'builds');
  // New secret keys (sb_secret_...) go in `apikey` only; an older service-role JWT also as bearer.
  const headers = { apikey: secret };
  if (secret.startsWith('eyJ')) headers.authorization = `Bearer ${secret}`;
  const ttl = html ? 3600 : 31536000;
  const res = await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${encodeKey(key)}`, {
    headers,
    // Keep copies at Cloudflare where it can, to spare the Supabase download allowance.
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '300-599': 0 } },
  });
  // Supabase answers 400 (older) or 404 for a missing file.
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`storage answered ${res.status}`);
  const length = res.headers.get('content-length');
  return { body: res.body, size: length === null ? null : Number(length), etag: res.headers.get('etag') ?? '' };
}

/** Handles one request. Exported for tests. */
export async function handle(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed', { allow: 'GET, HEAD' });
  const url = new URL(request.url);
  const key = keyFor(url, env);
  if (!key) return text(404, 'Not found');
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const type = TYPES[ext];
  if (!type) return text(404, 'Not found');

  const object = await readObject(env, key, ext === 'html' || ext === 'htm');
  if (!object) return text(404, 'Not found');
  const etag = object.etag;
  const siteOrigins = String(env.SITE_ORIGINS ?? '').split(/\s+/).filter(Boolean);
  const headers = {
    'content-type': type,
    ...(etag ? { etag } : {}),
    // Files never change after upload; the game page itself is re-checked every hour.
    'cache-control': ext === 'html' || ext === 'htm' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
    ...gameHeaders(type, siteOrigins),
  };
  if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  if (Number.isFinite(object.size)) headers['content-length'] = String(object.size);
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

export default {
  fetch(request, env) {
    return handle(request, env).catch(() => text(500, 'Something went wrong'));
  },
};
