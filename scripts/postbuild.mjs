/**
 * Finishes the static export of one site (`--site play|developers|manage`, default play).
 * Every site gets _headers (CSP, caching) and robots.txt. The player site also gets:
 *   - 404.html (and /<locale>/404.html) become the client fallback page, so pages that are not
 *     pre-rendered yet (a game approved after this build, profiles, parties) still resolve.
 *   - _redirects serves the purely dynamic shells with a 200.
 *   - _headers carries the CSP and caching rules for Cloudflare Pages.
 *   - sitemap.xml (index) + one sitemap per page type, with hreflang alternates; robots.txt.
 *   - sw.js with this build's id.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { gameOriginPattern, validPattern } from './lib/game-origin.mjs';
import { ROOT, SITES, loadEnv, sitesFromArgs } from './lib/run.mjs';

loadEnv();

const SITE = process.argv.includes('--site') ? sitesFromArgs()[0] : 'play';
const OUT = SITES[SITE].out;
const IS_PLAY = SITE === 'play';
const SITE_URL = (process.env[SITES[SITE].urlEnv] || `http://localhost:${SITES[SITE].port}`).replace(/\/+$/, '');
const PLAY_ORIGIN = (process.env.NEXT_PUBLIC_PLAY_ORIGIN || 'http://localhost:4100').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const ADSENSE = Boolean(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
const CF_ANALYTICS = Boolean(process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN);
const LOCALES = ['en'];
const DEFAULT_LOCALE = 'en';
const PREFIXED = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

// A shared sign-in cookie on the parent domain would be readable by game code if games were served
// from that domain too. Refuse to build such a setup.
const cookieDomain = (process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || '').trim().replace(/^\./, '');
if (cookieDomain && new URL(PLAY_ORIGIN).hostname.endsWith(cookieDomain)) {
  console.error(
    `[postbuild] NEXT_PUBLIC_AUTH_COOKIE_DOMAIN (.${cookieDomain}) covers the game origin (${PLAY_ORIGIN}). Serve games from a different domain, or unset the cookie domain.`,
  );
  process.exit(1);
}

// A build for a real domain must never run in mock mode: mock mode keeps everyone's data in the
// browser, signs anyone in without checks and shows test payments.
const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(u);
if (!isLocalUrl(SITE_URL) && !SUPABASE_URL && !process.env.BG_CATALOGUE_FIXTURE) {
  console.error(`[postbuild] ${SITE_URL} is a live address but NEXT_PUBLIC_SUPABASE_URL is empty, so this build would run in mock (test) mode. Set the Supabase settings.`);
  process.exit(1);
}
// Each game on its own origin, on a domain that is not the site's (see lib/play/gameOrigin.ts).
const GAME_PATTERN = gameOriginPattern();
// Free launch (docs/GO-LIVE-FREE.md): all games on one free address, chosen on purpose with
// BG_SHARED_GAME_ORIGIN=1 until a games domain is bought. Games are still apart from the sites.
const SHARED_GAMES = !validPattern(GAME_PATTERN) && process.env.BG_SHARED_GAME_ORIGIN === '1';
if (!isLocalUrl(SITE_URL) && SHARED_GAMES) {
  const playHost = new URL(PLAY_ORIGIN).hostname;
  const siteHosts = [SITE_URL, process.env.NEXT_PUBLIC_DEVELOPERS_URL, process.env.NEXT_PUBLIC_MANAGE_URL].filter(Boolean).map((u) => new URL(u).hostname);
  if (!PLAY_ORIGIN.startsWith('https://') || siteHosts.includes(playHost) || isLocalUrl(PLAY_ORIGIN)) {
    console.error(`[postbuild] NEXT_PUBLIC_PLAY_ORIGIN (${PLAY_ORIGIN}) must be the games Worker's own https address, not a site's.`);
    process.exit(1);
  }
  console.warn('[postbuild] WARNING: games share one address (free launch). Buy a games domain and set NEXT_PUBLIC_GAME_ORIGIN_PATTERN to seal games off from each other.');
}
if (!isLocalUrl(SITE_URL) && !SHARED_GAMES) {
  if (!validPattern(GAME_PATTERN)) {
    console.error('[postbuild] NEXT_PUBLIC_GAME_ORIGIN_PATTERN must be set for a live build, e.g. https://{game}.bgplay.net (docs/DEPLOY.md, "Game origins"). Without it every game would share one origin. For a free launch on one shared address, set BG_SHARED_GAME_ORIGIN=1 instead.');
    process.exit(1);
  }
  // Same registrable domain = same site: cookies and some storage could cross. Compared on the
  // last two labels, which refuses some safe setups (e.g. two .co.in names) rather than allow a bad one.
  const base = (host) => host.split('.').slice(-2).join('.');
  const gamesHost = new URL(GAME_PATTERN.replace('{game}', 'g-x')).hostname;
  const siteHosts = [SITE_URL, process.env.NEXT_PUBLIC_DEVELOPERS_URL, process.env.NEXT_PUBLIC_MANAGE_URL]
    .filter(Boolean)
    .map((u) => new URL(u).hostname);
  if (siteHosts.some((h) => base(h) === base(gamesHost)) || (cookieDomain && gamesHost.endsWith(cookieDomain))) {
    console.error(`[postbuild] Games (${gamesHost.replace(/^g-x\./, '')}) must be on a different domain from the sites (${siteHosts.join(', ')}).`);
    process.exit(1);
  }
}
if (!isLocalUrl(SITE_URL) && process.env.NEXT_PUBLIC_INGAME_ADS === 'mock' && ADSENSE) {
  console.error('[postbuild] NEXT_PUBLIC_INGAME_ADS=mock on a live build with AdSense on. Use adsense-h5 or none.');
  process.exit(1);
}

if (!existsSync(OUT)) {
  console.error(`[postbuild] ${OUT} does not exist. Run the Next build first.`);
  process.exit(1);
}

// ---- 1. Client fallback as 404.html -----------------------------------------------------------
let fallbacks = 0;
for (const prefix of IS_PLAY ? ['', ...PREFIXED] : []) {
  const from = join(OUT, prefix, 'fallback', 'index.html');
  if (!existsSync(from)) continue;
  copyFileSync(from, join(OUT, prefix, '404.html'));
  fallbacks++;
}

// ---- 2. _redirects ------------------------------------------------------------------------------
// Namespaces that are never pre-rendered get their shell with a 200 instead of the 404 fallback.
// Profiles (/u/<name>) and party rooms (/party/<code>) are never pre-rendered: they are served by
// the client fallback page with a 200. One path segment only, so /party/ keeps its own page.
const redirects = [];
for (const ns of IS_PLAY ? ['u', 'party'] : []) {
  for (const prefix of ['', ...PREFIXED.map((l) => `/${l}`)]) {
    if (!existsSync(join(OUT, prefix, 'fallback', 'index.html'))) continue;
    redirects.push(`${prefix}/${ns}/:id ${prefix}/fallback/ 200`, `${prefix}/${ns}/:id/ ${prefix}/fallback/ 200`);
  }
}
if (IS_PLAY) writeFileSync(join(OUT, '_redirects'), redirects.length ? `${redirects.join('\n')}\n` : '');

// ---- 3. _headers --------------------------------------------------------------------------------
const supabaseHost = SUPABASE_URL ? new URL(SUPABASE_URL).host : '';
const src = {
  // 'wasm-unsafe-eval' lets the statement PDF renderer compile its layout engine (WebAssembly).
  script: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
  style: ["'self'", "'unsafe-inline'"],
  img: ["'self'", 'data:', 'blob:', PLAY_ORIGIN],
  media: ["'self'", 'blob:', PLAY_ORIGIN],
  connect: ["'self'", PLAY_ORIGIN],
  frame: [PLAY_ORIGIN],
  font: ["'self'"],
};
// Game frames: every game origin (a wildcard such as https://*.bgplay.net).
if (validPattern(GAME_PATTERN)) src.frame.push(GAME_PATTERN.replace('{game}', '*'));
if (supabaseHost) {
  src.img.push(`https://${supabaseHost}`);
  src.media.push(`https://${supabaseHost}`);
  src.connect.push(`https://${supabaseHost}`, `wss://${supabaseHost}`);
}
if (ADSENSE && IS_PLAY) {
  const google = [
    'https://pagead2.googlesyndication.com',
    'https://*.googlesyndication.com',
    'https://*.doubleclick.net',
    'https://*.google.com',
    'https://*.adtrafficquality.google',
    'https://www.googletagservices.com',
    'https://imasdk.googleapis.com',
  ];
  src.script.push(...google);
  src.img.push('https:');
  src.connect.push(...google);
  src.frame.push(...google);
}
// Google sign-in (its own button) and Razorpay Checkout, only when their keys are configured.
if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
  src.script.push('https://accounts.google.com/gsi/client');
  src.style.push('https://accounts.google.com/gsi/style');
  src.frame.push('https://accounts.google.com/gsi/');
  src.connect.push('https://accounts.google.com/gsi/');
}
if (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID && SITE !== 'manage') {
  src.script.push('https://checkout.razorpay.com');
  src.frame.push('https://api.razorpay.com', 'https://checkout.razorpay.com');
  src.connect.push('https://api.razorpay.com', 'https://lumberjack.razorpay.com');
  src.img.push('https://cdn.razorpay.com');
}
// Cloudflare Turnstile, the bot check on sign-in, only when its site key is configured.
if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
  src.script.push('https://challenges.cloudflare.com');
  src.frame.push('https://challenges.cloudflare.com');
}
if (CF_ANALYTICS) {
  src.script.push('https://static.cloudflareinsights.com');
  src.connect.push('https://cloudflareinsights.com');
}
const csp = [
  "default-src 'self'",
  `script-src ${src.script.join(' ')}`,
  `style-src ${src.style.join(' ')}`,
  `img-src ${src.img.join(' ')}`,
  `media-src ${src.media.join(' ')}`,
  `font-src ${src.font.join(' ')}`,
  `connect-src ${src.connect.join(' ')}`,
  `frame-src ${src.frame.join(' ')}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
// HTTPS only, for a year, on these sites and their subdomains (live https builds only).
const HTTPS = SITE_URL.startsWith('https://');
const hsts = HTTPS ? '\n  Strict-Transport-Security: max-age=31536000; includeSubDomains' : '';
// The management portal is private: never indexed or cached by anyone in between.
const privateSite = SITE === 'manage' ? '\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: no-store' : '';
const headers = `# Generated by scripts/postbuild.mjs
/*
  Content-Security-Policy: ${csp}${hsts}${privateSite}
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/brand/*
  Cache-Control: public, max-age=604800

/sdk/*
  Cache-Control: public, max-age=3600
  Access-Control-Allow-Origin: *
  Cross-Origin-Resource-Policy: cross-origin

/sw.js
  Cache-Control: no-cache
`;
writeFileSync(join(OUT, '_headers'), headers);

// ---- 3b. Strict scripts on every page ---------------------------------------------------------
// The header above has to allow inline scripts (Next.js writes some into each page). Each page
// also gets its own policy listing the SHA-256 of exactly those scripts, so an injected script
// (an XSS) cannot run even if one got into a page. Both policies apply; a script must pass both.
// AdSense adds inline scripts of its own, so the player site skips this while AdSense is on.
function allHtml(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '_next') allHtml(full, found);
    } else if (name.endsWith('.html')) found.push(full);
  }
  return found;
}
const strictScripts = !(IS_PLAY && ADSENSE);
let hardened = 0;
if (strictScripts) {
  const hosts = src.script.filter((s) => s.startsWith('https://'));
  for (const file of allHtml(OUT)) {
    let html = readFileSync(file, 'utf8');
    if (html.includes('data-bg-csp')) continue;
    const hashes = new Set();
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/type=["']?application\/(ld\+)?json/i.test(m[1])) continue;
      hashes.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
    }
    const policy = [
      `script-src 'self' 'wasm-unsafe-eval' ${[...hosts, ...hashes].join(' ')}`.trim(),
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');
    const meta = `<meta http-equiv="Content-Security-Policy" data-bg-csp="" content="${policy}"/>`;
    const charset = /<meta charSet="utf-8"\/?>/i.exec(html);
    const head = /<head[^>]*>/i.exec(html);
    const at = charset ? charset.index + charset[0].length : head ? head.index + head[0].length : -1;
    if (at < 0) continue;
    html = html.slice(0, at) + meta + html.slice(at);
    writeFileSync(file, html);
    hardened++;
  }
}

// ---- 3b2. The management portal's address never appears in the public sites -------------------
if (SITE !== 'manage') {
  const manageUrl = (process.env.NEXT_PUBLIC_MANAGE_URL || 'http://localhost:3002').replace(/\/+$/, '');
  const manageHost = new URL(manageUrl).host;
  const leaks = [];
  const scan = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) scan(full);
      else if (/\.(html|js|txt|json|xml)$/.test(name) && readFileSync(full, 'utf8').includes(manageHost)) leaks.push(relative(OUT, full));
    }
  };
  scan(OUT);
  if (leaks.length) {
    console.error(`[postbuild] The management portal's address (${manageHost}) appears in the ${SITES[SITE].label}: ${leaks.slice(0, 5).join(', ')}. It must stay private.`);
    process.exit(1);
  }
}

// ---- 3c. security.txt (RFC 9116): how to report a vulnerability --------------------------------
const contact = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'brainstormingstudios26@gmail.com').trim();
const expires = new Date(Date.now() + 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
mkdirSync(join(OUT, '.well-known'), { recursive: true });
writeFileSync(
  join(OUT, '.well-known', 'security.txt'),
  [
    `Contact: mailto:${contact}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    '',
  ].join('\n'),
);
console.log(`[postbuild] ${SITES[SITE].label}: strict script policy on ${hardened} pages${strictScripts ? '' : ' (off: AdSense)'}; security.txt written`);

if (!IS_PLAY) {
  // The portals are tools, not content: the management portal is never crawled, and the
  // developer portal only exposes its public docs.
  writeFileSync(
    join(OUT, 'robots.txt'),
    SITE === 'manage' ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /docs/\nDisallow: /\n',
  );
  console.log(`[postbuild] ${SITES[SITE].label}: headers and robots.txt written to ${OUT}`);
  process.exit(0);
}

// ---- 4. Sitemaps and robots ---------------------------------------------------------------------
// Private or duplicate-content paths never go in a sitemap (they also carry noindex).
const EXCLUDE = [
  /^\/(fallback|offline|404|search|recent|favourites|settings|login|signup|notifications|friends|locker)(\/|$)/,
  /^\/(dev|admin|u|party|og)(\/|$)/,
  /^\/parents\/consent(\/|$)/,
  /\/_\/$/,
];
function walkHtml(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '_next') continue;
      walkHtml(full, found);
    } else if (name === 'index.html') found.push(full);
  }
  return found;
}
const paths = new Set();
for (const file of walkHtml(OUT)) {
  let p = `/${relative(OUT, dirname(file)).split(sep).join('/')}/`.replace(/\/+/g, '/');
  // Collapse locale copies onto the canonical English path; alternates are emitted per URL.
  const m = /^\/([a-z]{2})(\/.*)$/.exec(p);
  if (m && PREFIXED.includes(m[1])) p = m[2];
  if (!EXCLUDE.some((re) => re.test(p))) paths.add(p);
}
const groups = { games: [], categories: [], tags: [], studios: [], pages: [] };
for (const p of [...paths].sort()) {
  if (p.startsWith('/game/')) groups.games.push(p);
  else if (p.startsWith('/c/')) groups.categories.push(p);
  else if (p.startsWith('/t/')) groups.tags.push(p);
  else if (p.startsWith('/studio/')) groups.studios.push(p);
  else groups.pages.push(p);
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const loc = (p, locale) => `${SITE_URL}${locale === DEFAULT_LOCALE ? '' : `/${locale}`}${p}`;
const today = new Date().toISOString().slice(0, 10);
mkdirSync(join(OUT, 'sitemaps'), { recursive: true });
const written = [];
for (const [name, list] of Object.entries(groups)) {
  if (list.length === 0) continue;
  const urls = list
    .flatMap((p) =>
      LOCALES.map((locale) => {
        const alternates = LOCALES.map(
          (l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(loc(p, l))}"/>`,
        ).join('\n');
        return `  <url>\n    <loc>${esc(loc(p, locale))}</loc>\n    <lastmod>${today}</lastmod>\n${alternates}\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(loc(p, DEFAULT_LOCALE))}"/>\n  </url>`;
      }),
    )
    .join('\n');
  writeFileSync(
    join(OUT, 'sitemaps', `${name}.xml`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`,
  );
  written.push(name);
}
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${written
    .map((n) => `  <sitemap><loc>${SITE_URL}/sitemaps/${n}.xml</loc><lastmod>${today}</lastmod></sitemap>`)
    .join('\n')}\n</sitemapindex>\n`,
);
writeFileSync(
  join(OUT, 'robots.txt'),
  [
    'User-agent: *',
    'Allow: /',
    ...['fallback', 'search', 'settings', 'login', 'signup', 'u', 'party'].flatMap((p) => [
      `Disallow: /${p}/`,
      ...PREFIXED.map((l) => `Disallow: /${l}/${p}/`),
    ]),
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n'),
);

// ---- 5. Public key for game user tokens -----------------------------------------------------------
if (process.env.GAME_JWT_PUBLIC_JWK) {
  try {
    const key = JSON.parse(process.env.GAME_JWT_PUBLIC_JWK);
    delete key.d; // never publish a private key by mistake
    mkdirSync(join(OUT, '.well-known'), { recursive: true });
    writeFileSync(join(OUT, '.well-known', 'bg-game-jwks.json'), JSON.stringify({ keys: [key] }));
  } catch {
    console.warn('[postbuild] GAME_JWT_PUBLIC_JWK is not valid JSON; JWKS not written');
  }
}

// ---- 6. Service worker ----------------------------------------------------------------------------
const buildId = existsSync(join(ROOT, 'apps', 'web', '.next', 'BUILD_ID'))
  ? readFileSync(join(ROOT, 'apps', 'web', '.next', 'BUILD_ID'), 'utf8').trim()
  : String(Date.now());
const swTemplate = readFileSync(join(ROOT, 'scripts', 'lib', 'sw.template.js'), 'utf8');
writeFileSync(
  join(OUT, 'sw.js'),
  swTemplate
    .replace('__BUILD_ID__', buildId)
    .replace('__OFFLINE_URLS__', JSON.stringify(['/offline/', ...PREFIXED.map((l) => `/${l}/offline/`)])),
);

console.log(
  `[postbuild] ${fallbacks} fallback page(s), ${redirects.length} redirect rule(s), ${paths.size} sitemap paths in ${written.length} file(s), sw ${buildId}`,
);
