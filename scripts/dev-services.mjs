/**
 * Local stand-in for the services a static site cannot provide. No dependencies.
 *
 *   - The play origin: serves game builds from .local/play on another port, so games run on a
 *     different origin from the site exactly as they do in production (R2 at play.<domain>).
 *   - Mock presigned uploads: PUT /__mock/upload/<key> stores a file under .local/play.
 *   - Mock pre-QA: POST /__mock/pre-qa runs scripts/pre-qa.ts against an uploaded build.
 *
 * Mock mode only. It binds to 127.0.0.1 and refuses anything that is not a web game file.
 *
 *   node scripts/dev-services.mjs [--port 4100] [--site http://localhost:3000]
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { ROOT, TSX, WEB } from './lib/run.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.PLAY_PORT || 4100));
const SITE_ORIGINS = arg('site', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''));
const STORE = join(ROOT, '.local', 'play');
const MAX_FILE = 260 * 1024 * 1024;

mkdirSync(STORE, { recursive: true });

/** Everything a web game build or its media can contain. Anything else is refused. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.unityweb': 'application/octet-stream',
  '.pck': 'application/octet-stream',
  '.mem': 'application/octet-stream',
  '.br': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.atlas': 'text/plain; charset=utf-8',
  '.fnt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.basis': 'application/octet-stream',
  '.map': 'application/json',
};

function resolveKey(key) {
  let decoded;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(decoded)) return null;
  const full = normalize(join(STORE, decoded));
  if (!full.startsWith(STORE + sep)) return null;
  if (!(extname(full).toLowerCase() in MIME)) return null;
  return full;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (SITE_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '600');
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function upload(req, res, key) {
  const file = resolveKey(key);
  if (!file) return json(res, 400, { error: 'invalid_path' });
  mkdirSync(dirname(file), { recursive: true });
  const out = createWriteStream(file);
  let size = 0;
  let failed = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_FILE && !failed) {
      failed = true;
      out.destroy();
      rmSync(file, { force: true });
      json(res, 413, { error: 'too_large' });
      req.destroy();
    }
  });
  req.pipe(out);
  out.on('finish', () => !failed && json(res, 200, { ok: true, bytes: size }));
  out.on('error', (err) => !failed && json(res, 500, { error: String(err) }));
}

function runPreQa(url) {
  return new Promise((resolve) => {
    const script = join(ROOT, 'scripts', 'pre-qa.ts');
    if (!existsSync(script)) return resolve({ status: 'skipped', reason: 'pre-qa script not present yet' });
    const child = spawn(process.execPath, [TSX, '--tsconfig', join(WEB, 'tsconfig.json'), script, url, '--json'], {
      cwd: ROOT,
      env: process.env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      const line = out.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ status: 'error', reason: (err || out).slice(-600) });
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (path === '/__mock/health') return json(res, 200, { ok: true, store: STORE });

    if (path.startsWith('/__mock/upload/') && req.method === 'PUT') {
      return upload(req, res, path.slice('/__mock/upload/'.length));
    }

    if (path.startsWith('/__mock/prefix/') && req.method === 'DELETE') {
      // Remove one uploaded build or media folder.
      const key = decodeURIComponent(path.slice('/__mock/prefix/'.length));
      const full = normalize(join(STORE, key));
      if (!key || !full.startsWith(STORE + sep)) return json(res, 400, { error: 'invalid_path' });
      rmSync(full, { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }

    if (path === '/__mock/pre-qa' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.url ?? '');
      if (!target.startsWith(`http://localhost:${PORT}/`) && !target.startsWith(`http://127.0.0.1:${PORT}/`)) {
        return json(res, 400, { error: 'url must be on this play origin' });
      }
      return json(res, 200, await runPreQa(target));
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const file = resolveKey(path.replace(/^\/+/, '') || 'index.html');
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not found');
      }
      const type = MIME[extname(file).toLowerCase()];
      const headers = {
        'content-type': type,
        'content-length': statSync(file).size,
        'cache-control': 'no-cache',
        'cross-origin-resource-policy': 'cross-origin',
        'x-content-type-options': 'nosniff',
      };
      // Sitelock: a game document may only be framed by our own site.
      if (type.startsWith('text/html')) {
        headers['content-security-policy'] = `frame-ancestors ${SITE_ORIGINS.join(' ')}`;
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file).pipe(res);
    }

    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('Method not allowed');
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-services] play origin http://localhost:${PORT} (store: ${STORE})`);
});
