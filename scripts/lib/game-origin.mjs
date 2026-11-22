// Mirror of apps/web/src/lib/play/gameOrigin.ts for the Node scripts (dev-services, postbuild).
// tests/unit/gameOrigin.test.ts checks that both agree.

const HEX32 = /^[0-9a-f]{32}$/;
const PART = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** The storage folder a game-origin label stands for, or null. */
export function labelToFolder(label) {
  const o = /^o-(.+)$/.exec(label);
  if (o) return PART.test(o[1]) ? `originals/${o[1]}` : null;
  const g = /^g-(.+)$/.exec(label);
  if (!g) return null;
  const id = g[1];
  if (HEX32.test(id)) return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  return PART.test(id) && id !== 'originals' && id !== 'media' ? id : null;
}

/** True when a pattern such as `https://{game}.bgplay.net` is usable. */
export function validPattern(pattern) {
  return /^https?:\/\/\{game\}\.[a-z0-9.-]+(:\d+)?$/.test(pattern ?? '');
}

/** The local default: every game on its own *.localhost origin (browsers resolve these locally). */
export function defaultPattern(playOrigin) {
  const m = /^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)$/.exec(playOrigin);
  return m ? `http://{game}.localhost:${m[1]}` : '';
}

/**
 * The storage key a request on a game origin may read, or null. Only files inside the game's own
 * folder: no "..", ".", empty segments, backslashes or control characters.
 */
export function gameKey(label, pathname) {
  const folder = labelToFolder(label);
  if (!folder) return null;
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!path.startsWith('/')) return null;
  if (path.endsWith('/')) path += 'index.html';
  const segs = path.slice(1).split('/');
  // eslint-disable-next-line no-control-regex
  if (segs.some((s) => s === '' || s === '.' || s === '..' || /[\\\u0000-\u001f\u007f]/.test(s))) return null;
  return `${folder}/${segs.join('/')}`;
}

/**
 * Headers for every file on a game origin. Game documents may only be framed by our sites
 * (sitelock), cannot post forms to other sites, and get no camera, microphone or location.
 */
export function gameHeaders(contentType, siteOrigins) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-resource-policy': 'cross-origin',
    'origin-agent-cluster': '?1',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=()',
  };
  if (/^text\/html/.test(contentType)) {
    headers['content-security-policy'] = [
      `frame-ancestors ${siteOrigins.join(' ')}`,
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ');
  }
  return headers;
}

/** The game-origin pattern in effect for these settings. */
export function gameOriginPattern(env = process.env) {
  const playOrigin = (env.NEXT_PUBLIC_PLAY_ORIGIN || 'http://localhost:4100').replace(/\/+$/, '');
  const set = (env.NEXT_PUBLIC_GAME_ORIGIN_PATTERN || '').trim().replace(/\/+$/, '');
  return set || defaultPattern(playOrigin);
}
