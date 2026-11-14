/**
 * Local stand-in for the services a static site cannot provide. No dependencies.
 *
 *   - The play origin: serves game builds from .local/play on another port, so games run on a
 *     different origin from the site exactly as they do in production (R2 at play.<domain>).
 *   - Mock presigned uploads: PUT /__mock/upload/<key> stores a file under .local/play.
 *   - Mock pre-QA: POST /__mock/pre-qa runs scripts/pre-qa.ts against an uploaded build.
 *   - The local database: /__mock/db/* keeps the mock tables in one place, so the player site,
 *     the developer portal and the management portal (three origins) all see the same data.
 *     It is saved to .local/mock-db.json and survives restarts.
 *   - First-party games: /originals/<slug>/* serves the games in /games, and the database is
 *     seeded with them the first time it is empty (skip with --no-seed).
 *
 * Mock mode only. It binds to 127.0.0.1 and refuses anything that is not a web game file.
 *
 *   node scripts/dev-services.mjs [--port 4100] [--site http://localhost:3000]
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { ROOT, TSX, WEB } from './lib/run.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.PLAY_PORT || 4100));
const DEFAULT_SITES = [
  process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  process.env.NEXT_PUBLIC_DEVELOPERS_URL || 'http://localhost:3001',
  process.env.NEXT_PUBLIC_MANAGE_URL || 'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
].join(',');
const SITE_ORIGINS = arg('site', DEFAULT_SITES)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''));
const SEED = !process.argv.includes('--no-seed');
const GAMES = join(ROOT, 'games');
const DB_FILE = join(ROOT, '.local', 'mock-db.json');
const SDK_FILE = join(WEB, 'public', 'sdk', 'v1', 'bg-sdk.js');
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

// ---------------------------------------------------------------------------------------------
// The local database: named tables of JSON rows, each with a version that goes up on every write.
// ---------------------------------------------------------------------------------------------
/** @type {Map<string, { version: number, text: string }>} */
const tables = new Map();
let clock = 1;
let saveTimer = null;

function loadDb() {
  try {
    const saved = JSON.parse(readFileSync(DB_FILE, 'utf8'));
    for (const [name, text] of Object.entries(saved.tables ?? {})) tables.set(name, { version: clock++, text: String(text) });
  } catch {
    // no saved database yet
  }
}

function saveDbSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(DB_FILE), { recursive: true });
      writeFileSync(DB_FILE, JSON.stringify({ tables: Object.fromEntries([...tables].map(([k, v]) => [k, v.text])) }));
    } catch (err) {
      console.error('[dev-services] could not save the local database:', String(err));
    }
  }, 400);
}

function setTable(name, rows) {
  tables.set(name, { version: clock++, text: typeof rows === 'string' ? rows : JSON.stringify(rows) });
  saveDbSoon();
}

const getRows = (name) => {
  try {
    const rows = JSON.parse(tables.get(name)?.text ?? '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

function dirBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    total += st.isDirectory() ? dirBytes(full) : st.size;
  }
  return total;
}

/**
 * Adds the first-party games from /games/originals.json to an empty catalogue, published by the
 * first-party studio. Runs once; after that the games are ordinary rows the portals can manage.
 */
function seedOriginals() {
  const manifestFile = join(GAMES, 'originals.json');
  if (!existsSync(manifestFile)) return 0;
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const base = `http://localhost:${PORT}/originals`;
  const now = new Date().toISOString();
  const studios = getRows('studios');
  const games = getRows('games');
  const versions = getRows('versions');
  const media = getRows('media');
  let studio = studios.find((x) => x.slug === manifest.studio.slug);
  if (!studio) {
    studio = {
      id: randomUUID(),
      ownerId: null,
      slug: manifest.studio.slug,
      name: manifest.studio.name,
      bio: manifest.studio.bio ?? '',
      avatarUrl: null,
      country: manifest.studio.country ?? null,
      contactEmail: null,
      links: [],
      verified: true,
      isFirstParty: true,
      level: 'partner',
      suspendedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
      guardianName: null,
      createdAt: now,
    };
    studios.push(studio);
  }
  let added = 0;
  for (const g of manifest.games) {
    const dir = join(GAMES, g.slug);
    if (!existsSync(join(dir, 'index.html')) || games.some((x) => x.slug === g.slug)) continue;
    const id = randomUUID();
    const versionId = randomUUID();
    const bytes = dirBytes(dir);
    games.push({
      id,
      studioId: studio.id,
      slug: g.slug,
      title: g.title,
      shortDescription: g.shortDescription ?? '',
      descriptionMd: g.descriptionMd ?? '',
      howToPlayMd: g.howToPlayMd ?? '',
      controls: g.controls ?? [],
      faq: g.faq ?? [],
      featuresMd: g.featuresMd ?? '',
      tipsMd: g.tipsMd ?? '',
      category: g.category,
      tags: g.tags ?? [],
      orientation: g.orientation ?? 'landscape',
      platforms: g.platforms ?? ['desktop', 'mobile', 'tablet'],
      engine: g.engine ?? null,
      isMultiplayer: Boolean(g.isMultiplayer),
      hasProgress: Boolean(g.hasProgress),
      schoolSafe: g.schoolSafe !== false,
      sizeBytes: bytes,
      initialLoadBytes: g.initialLoadBytes ?? null,
      status: g.status ?? 'rise',
      sparkStartedAt: null,
      riseStartedAt: now,
      exclusiveUntil: null,
      currentVersionId: versionId,
      maxScorePerSec: g.maxScorePerSec ?? null,
      createdAt: now,
      releasedAt: now,
      updatedAt: now,
    });
    versions.push({
      id: versionId,
      gameId: id,
      version: String(g.version ?? '1'),
      storagePrefix: `originals/${g.slug}`,
      fileCount: 1,
      totalBytes: bytes,
      entryFile: 'index.html',
      usesSdk: true,
      preQaReport: null,
      qaStatus: 'approved',
      qaNotes: null,
      previewToken: randomUUID(),
      createdAt: now,
    });
    for (const m of g.media ?? []) {
      media.push({
        id: randomUUID(),
        gameId: id,
        kind: m.kind,
        url: `${base}/${g.slug}/${m.file}`,
        widths: [],
        width: m.width,
        height: m.height,
        placeholder: null,
        variantLabel: null,
        isActive: true,
        createdAt: now,
      });
    }
    added++;
  }
  if (added) {
    setTable('studios', studios);
    setTable('games', games);
    setTable('versions', versions);
    setTable('media', media);
  }
  return added;
}

loadDb();
if (SEED && getRows('games').length === 0) {
  const n = seedOriginals();
  if (n) console.log(`[dev-services] added ${n} first-party game(s) to the empty catalogue`);
}

/** A file of a first-party game (or the SDK every one of them loads from its own folder). */
function resolveOriginal(key) {
  const m = /^originals\/([a-z0-9-]+)\/(.*)$/.exec(key);
  if (!m) return undefined;
  if (m[2] === 'bg-sdk.js') return existsSync(SDK_FILE) ? SDK_FILE : null;
  let decoded;
  try {
    decoded = decodeURIComponent(m[2] || 'index.html');
  } catch {
    return null;
  }
  if (decoded.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(decoded)) return null;
  const root = join(GAMES, m[1]);
  const full = normalize(join(root, decoded));
  if (!full.startsWith(root + sep) || !(extname(full).toLowerCase() in MIME)) return null;
  return full;
}

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

    if (path.startsWith('/__mock/db/')) {
      const rest = path.slice('/__mock/db/'.length);
      res.setHeader('cache-control', 'no-store');
      if (rest === 'versions' && req.method === 'GET') {
        return json(res, 200, Object.fromEntries([...tables].map(([k, v]) => [k, v.version])));
      }
      if (rest === 'stats' && req.method === 'GET') {
        const list = [...tables]
          .map(([name, t]) => ({ name, rows: getRows(name).length, bytes: Buffer.byteLength(t.text) }))
          .sort((a, b) => b.bytes - a.bytes);
        return json(res, 200, { file: DB_FILE, tables: list, totalBytes: list.reduce((n, t) => n + t.bytes, 0) });
      }
      if (rest === 'reset' && req.method === 'POST') {
        if ([...tables.values()].some((t) => t.text.length > 2)) {
          try {
            writeFileSync(
              DB_FILE.replace(/\.json$/, '.backup.json'),
              JSON.stringify({ tables: Object.fromEntries([...tables].map(([k, v]) => [k, v.text])) }),
            );
          } catch {
            // a backup is best effort
          }
        }
        tables.clear();
        clock += 1;
        // An emptied table still needs a new version so open pages notice.
        setTable('games', []);
        const seeded = url.searchParams.get('seed') === '1' ? seedOriginals() : 0;
        return json(res, 200, { ok: true, seeded });
      }
      const name = /^table\/([A-Za-z]{1,40})$/.exec(rest)?.[1];
      if (name && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(tables.get(name)?.text ?? '[]');
      }
      if (name && req.method === 'POST') {
        const text = await readBody(req, 32 * 1024 * 1024);
        JSON.parse(text); // refuse anything that is not JSON
        setTable(name, text);
        return json(res, 200, { version: tables.get(name).version });
      }
      return json(res, 404, { error: 'not_found' });
    }

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
      const key = path.replace(/^\/+/, '') || 'index.html';
      const original = resolveOriginal(key.endsWith('/') ? `${key}index.html` : key);
      const file = original === undefined ? resolveKey(key) : original;
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

// A browser tab closing mid-request must never take the local database down with it.
const crashLog = join(ROOT, '.local', 'dev-services.log');
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    const line = `${new Date().toISOString()} ${event}: ${err?.stack ?? err}\n`;
    console.error(`[dev-services] ${line}`);
    try {
      writeFileSync(crashLog, line, { flag: 'a' });
    } catch {
      // logging is best effort
    }
  });
}
server.on('clientError', (_err, socket) => socket.destroy());

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-services] play origin http://localhost:${PORT} (store: ${STORE})`);
});
