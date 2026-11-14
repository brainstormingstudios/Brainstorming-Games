/**
 * Serves the static export the way Cloudflare Pages does, for local previews and e2e tests:
 *   - a file if it exists (folders serve their index.html; `/x` redirects to `/x/`)
 *   - otherwise `_redirects` rules with status 200 (rewrites) or 30x
 *   - otherwise the nearest 404.html up the tree, with status 404
 *   - `_headers` rules are applied to every response
 *
 *   node scripts/serve-static.mjs [--site play|developers|manage] [--port 3000] [--dir apps/web/out]
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { ROOT, SITES } from './lib/run.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const SITE = SITES[arg('site', 'play')] ?? SITES.play;
const PORT = Number(arg('port', process.env.PORT || SITE.port));
const DIR = resolve(ROOT, arg('dir', SITE.out));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.map': 'application/json',
};

function parseRedirects() {
  const file = join(DIR, '_redirects');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [from, to, status = '302'] = l.split(/\s+/);
      return { from, to, status: Number(status) };
    });
}

function parseHeaders() {
  const file = join(DIR, '_headers');
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const i = raw.indexOf(':');
      if (i > 0) current.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
    }
  }
  return rules;
}

/** Cloudflare Pages patterns: a trailing `*` splat or `:name` placeholders (one segment each). */
const matches = (pattern, path) => {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  if (!pattern.includes(':')) return pattern === path;
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+')}$`);
  return re.test(path);
};

const redirects = parseRedirects();
const headerRules = parseHeaders();

function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const full = normalize(join(DIR, decoded));
  return full === DIR || full.startsWith(DIR + sep) ? full : null;
}

function fileFor(urlPath) {
  const full = safeJoin(urlPath);
  if (!full || !existsSync(full)) return null;
  const stat = statSync(full);
  if (stat.isFile()) return { file: full };
  if (stat.isDirectory()) {
    if (!urlPath.endsWith('/')) return { redirect: `${urlPath}/` };
    const index = join(full, 'index.html');
    if (existsSync(index)) return { file: index };
  }
  return null;
}

function nearest404(urlPath) {
  const parts = urlPath.split('/').filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const candidate = safeJoin(`/${parts.slice(0, i).join('/')}/404.html`);
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

// Cloudflare compresses text responses; do the same so local measurements are realistic.
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/;
const compressed = new Map();

function send(res, status, file, path, req) {
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers = { 'content-type': type, vary: 'accept-encoding' };
  for (const rule of headerRules) {
    if (matches(rule.pattern, path)) for (const [k, v] of rule.headers) headers[k.toLowerCase()] = v;
  }
  const accepts = String(req?.headers['accept-encoding'] ?? '');
  if (COMPRESSIBLE.test(type) && /\b(br|gzip)\b/.test(accepts)) {
    const useBr = /\bbr\b/.test(accepts);
    const { mtimeMs } = statSync(file);
    const key = `${file}:${mtimeMs}:${useBr ? 'br' : 'gz'}`;
    let body = compressed.get(key);
    if (!body) {
      const raw = readFileSync(file);
      body = useBr
        ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } })
        : gzipSync(raw, { level: 9 });
      compressed.set(key, body);
    }
    headers['content-encoding'] = useBr ? 'br' : 'gzip';
    headers['content-length'] = body.length;
    res.writeHead(status, headers);
    return res.end(body);
  }
  res.writeHead(status, headers);
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    const hit = fileFor(path);
    if (hit?.redirect) {
      res.writeHead(308, { location: hit.redirect + url.search });
      return res.end();
    }
    if (hit?.file) return send(res, 200, hit.file, path, req);

    for (const rule of redirects) {
      if (!matches(rule.from, path)) continue;
      if (rule.status === 200) {
        const target = fileFor(rule.to);
        if (target?.file) return send(res, 200, target.file, path, req);
      } else {
        res.writeHead(rule.status, { location: rule.to });
        return res.end();
      }
    }

    const notFound = nearest404(path);
    if (notFound) return send(res, 404, notFound, path, req);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve-static] ${DIR} at http://localhost:${PORT}`);
});
