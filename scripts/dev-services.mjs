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
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { gameHeaders, gameKey } from './lib/game-origin.mjs';
import { ROOT, TSX, WEB, loadEnv } from './lib/run.mjs';

loadEnv();

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
/** @type {Map<string, string> | null} */
let stashed = null;

/** While automated tests run, the real local data waits here (on disk, so a restart keeps it). */
const STASH_FILE = DB_FILE.replace(/\.json$/, '.stash.json');

function loadDb() {
  try {
    // A test run that never finished (services stopped mid-run): put the real data back first.
    const file = existsSync(STASH_FILE) ? STASH_FILE : DB_FILE;
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, text] of Object.entries(saved.tables ?? {})) tables.set(name, { version: clock++, text: String(text) });
    if (file === STASH_FILE) {
      console.log('[dev-services] restored the local data saved before an unfinished test run');
      saveDbNow();
      rmSync(STASH_FILE, { force: true });
    }
  } catch {
    // no saved database yet
  }
}

function saveDbNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    mkdirSync(dirname(DB_FILE), { recursive: true });
    writeFileSync(DB_FILE, JSON.stringify({ tables: Object.fromEntries([...tables].map(([k, v]) => [k, v.text])) }));
  } catch (err) {
    console.error('[dev-services] could not save the local database:', String(err));
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
      skills: g.skills ?? [],
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
  // Originals seeded before skills existed get the manifest's skills (once; later edits stay).
  let tagged = 0;
  for (const g of manifest.games) {
    const row = games.find((x) => x.slug === g.slug && x.studioId === studio.id);
    if (row && g.skills && !Array.isArray(row.skills)) {
      row.skills = g.skills;
      tagged++;
    }
  }
  if (tagged && !added) setTable('games', games);
  if (added) {
    setTable('studios', studios);
    setTable('games', games);
    setTable('versions', versions);
    setTable('media', media);
  }
  return added;
}

loadDb();
// The BS Originals are always in the catalogue: any that are missing (a fresh database, or one an
// automated test emptied) are added back on start. Games and accounts people created are untouched.
if (SEED) {
  const n = seedOriginals();
  if (n) console.log(`[dev-services] added ${n} BS Original(s) to the catalogue`);
}

// ---------------------------------------------------------------------------------------------
// Owner code: a time-based one-time password (RFC 6238, the kind every authenticator app makes).
// The secret never goes into the database tables a browser can read: it is kept in
// .local/owner-keys.json and checked here. A correct code unlocks the management portal for
// 12 hours through an HttpOnly cookie that page scripts cannot read.
// ---------------------------------------------------------------------------------------------
const OWNER_FILE = join(ROOT, '.local', 'owner-keys.json');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** @type {Record<string, { secret: string, confirmed: boolean }>} */
let ownerKeys = {};
try {
  ownerKeys = JSON.parse(readFileSync(OWNER_FILE, 'utf8'));
} catch {
  // nobody has set a code up yet
}
/** token -> { uid, expires } */
const ownerSessions = new Map();
/** uid -> { fails, until } */
const ownerLocks = new Map();

const saveOwnerKeys = () => {
  mkdirSync(dirname(OWNER_FILE), { recursive: true });
  writeFileSync(OWNER_FILE, JSON.stringify(ownerKeys, null, 2));
};
function base32(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function unbase32(text) {
  let bits = '';
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
function totpOk(secret, code) {
  const now = Math.floor(Date.now() / 30_000);
  const given = Buffer.from(String(code).replace(/\D/g, '').padStart(6, '0').slice(0, 6));
  // One step either side allows for a clock that is a little off.
  return [-1, 0, 1].some((d) => timingSafeEqual(Buffer.from(totpAt(secret, now + d)), given));
}
const cookieOf = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1] ?? null;
const isAdmin = (uid) => getRows('users').some((u) => u.id === uid && u.role === 'admin' && !u.bannedAt);
function ownerUnlocked(req, uid) {
  const token = cookieOf(req, 'bg_owner');
  const session = token ? ownerSessions.get(token) : null;
  return Boolean(session && session.uid === uid && session.expires > Date.now());
}

async function ownerApi(req, res, action) {
  const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
  const uid = String(req.method === 'GET' ? new URL(req.url, 'http://x').searchParams.get('uid') ?? '' : body.uid ?? '');
  res.setHeader('cache-control', 'no-store');
  if (!uid || !isAdmin(uid)) return json(res, 403, { error: 'not_allowed' });
  const key = ownerKeys[uid];
  if (action === 'status') {
    const devices = (key?.confirmed ? 1 : 0) + (key?.backups ?? []).filter((b) => b.confirmed).length;
    return json(res, 200, { enrolled: Boolean(key?.confirmed), unlocked: ownerUnlocked(req, uid), devices });
  }
  // A second authenticator (backup phone), added only from an unlocked session.
  if (action === 'add-backup') {
    if (!key?.confirmed || !ownerUnlocked(req, uid)) return json(res, 403, { error: 'not_allowed' });
    const secret = base32(randomBytes(20));
    key.backups = [...(key.backups ?? []).filter((b) => b.confirmed).slice(0, 4), { secret, confirmed: false }];
    saveOwnerKeys();
    const email = getRows('users').find((u) => u.id === uid)?.email ?? 'owner';
    const label = encodeURIComponent(`Brainstorming Games (backup):${email}`);
    return json(res, 200, { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Brainstorming%20Games&algorithm=SHA1&digits=6&period=30` });
  }
  if (action === 'confirm-backup') {
    if (!key?.confirmed || !ownerUnlocked(req, uid)) return json(res, 403, { error: 'not_allowed' });
    const pending = (key.backups ?? []).find((b) => !b.confirmed);
    if (!pending || !totpOk(pending.secret, body.code)) return json(res, 200, { ok: false });
    pending.confirmed = true;
    saveOwnerKeys();
    return json(res, 200, { ok: true });
  }
  if (action === 'enroll') {
    // A code that is already set up can only be replaced from an unlocked session.
    if (key?.confirmed && !ownerUnlocked(req, uid)) return json(res, 403, { error: 'not_allowed' });
    const secret = base32(randomBytes(20));
    ownerKeys[uid] = { secret, confirmed: false };
    saveOwnerKeys();
    const email = getRows('users').find((u) => u.id === uid)?.email ?? 'owner';
    const label = encodeURIComponent(`Brainstorming Games:${email}`);
    return json(res, 200, { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Brainstorming%20Games&algorithm=SHA1&digits=6&period=30` });
  }
  if (action === 'verify') {
    const lock = ownerLocks.get(uid);
    if (lock && lock.until > Date.now()) return json(res, 429, { error: 'rate_limited', retryInSeconds: Math.ceil((lock.until - Date.now()) / 1000) });
    const anyDevice = key && (totpOk(key.secret, body.code) || (key.backups ?? []).some((b) => b.confirmed && totpOk(b.secret, body.code)));
    if (!anyDevice) {
      // Five wrong codes lock the account for five minutes, then every further miss doubles it.
      const fails = (lock?.fails ?? 0) + 1;
      ownerLocks.set(uid, { fails, until: fails >= 5 ? Date.now() + 300_000 * 2 ** (fails - 5) : 0 });
      return json(res, 200, { ok: false });
    }
    ownerLocks.delete(uid);
    if (!key.confirmed) {
      key.confirmed = true;
      saveOwnerKeys();
    }
    const token = randomBytes(32).toString('hex');
    ownerSessions.set(token, { uid, expires: Date.now() + 12 * 3_600_000 });
    res.setHeader('set-cookie', `bg_owner=${token}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax`);
    return json(res, 200, { ok: true });
  }
  if (action === 'lock') {
    const token = cookieOf(req, 'bg_owner');
    if (token) ownerSessions.delete(token);
    res.setHeader('set-cookie', 'bg_owner=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not_found' });
}

// ---------------------------------------------------------------------------------------------
// Automated e-mails. Every message is rendered with the same templates as the live site, saved to
// .local/mail (open the .html file to see it) and listed in the management portal. With a Gmail
// app password in .env.local it is also really sent, from the official address, for free.
// ---------------------------------------------------------------------------------------------
const MAIL_DIR = join(ROOT, '.local', 'mail');
const CONTACT = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'brainstormingstudios26@gmail.com').trim();
const GMAIL_USER = (process.env.GMAIL_USER || CONTACT).trim();
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
let transport = null;
async function mailer() {
  if (!GMAIL_PASS) return null;
  if (!transport) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  }
  return transport;
}

async function sendMailNow(body) {
  const { renderMail } = await import('../supabase/functions/_shared/mailTemplates.ts');
  const to = String(body.to ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: 'invalid_address' };
  const ctx = {
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    developersUrl: (process.env.NEXT_PUBLIC_DEVELOPERS_URL || 'http://localhost:3001').replace(/\/+$/, ''),
    contactEmail: CONTACT,
  };
  const mail = renderMail(String(body.template), body.data ?? {}, ctx);
  const row = { id: randomUUID(), to, template: String(body.template), subject: mail.subject, status: 'saved', error: null, createdAt: new Date().toISOString() };
  mkdirSync(MAIL_DIR, { recursive: true });
  writeFileSync(join(MAIL_DIR, `${row.createdAt.replace(/[:.]/g, '-')}-${row.template}.html`), mail.html);
  // Addresses on the test domains never leave this machine.
  const testAddress = /@example\.(test|com)$/i.test(to) || /\.test$/i.test(to);
  const t = testAddress ? null : await mailer();
  if (t) {
    try {
      await t.sendMail({ from: { name: 'Brainstorming Games', address: GMAIL_USER }, replyTo: CONTACT, to, subject: mail.subject, html: mail.html, text: mail.text });
      row.status = 'sent';
    } catch (err) {
      row.status = 'failed';
      row.error = String(err?.message ?? err).slice(0, 300);
    }
  }
  setTable('emails', [...getRows('emails'), row].slice(-500));
  return row;
}

// ---------------------------------------------------------------------------------------------
// Sign-in codes. A 6-digit code is e-mailed to the address; only someone who can read that inbox
// can sign in as it. Codes last 10 minutes, are stored hashed, work once, and allow 5 tries.
// Until a Gmail app password is configured the code cannot be e-mailed, so it is returned to the
// page instead (and the page says so): fine on your own computer, never on a live site.
// ---------------------------------------------------------------------------------------------
/** email -> { hash, expires, tries } */
const signInCodes = new Map();
/** email -> recent send times, to stop a flood of e-mails */
const codeSends = new Map();
const hashCode = (email, code) => createHmac('sha256', 'bg-sign-in').update(`${email}:${code}`).digest('hex');

async function authApi(req, res, action) {
  const body = JSON.parse((await readBody(req)) || '{}');
  const email = String(body.email ?? '').trim().toLowerCase();
  res.setHeader('cache-control', 'no-store');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'invalid' });
  if (action === 'send-code') {
    // Reserved test addresses (automated tests sign the same admin in many times) are not limited.
    const testAddress = /@example\.(test|com)$/i.test(email) || /\.test$/i.test(email);
    const recent = (codeSends.get(email) ?? []).filter((t) => t > Date.now() - 600_000);
    if (recent.length >= 5 && !testAddress) return json(res, 429, { error: 'rate_limited' });
    codeSends.set(email, [...recent, Date.now()]);
    const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
    signInCodes.set(email, { hash: hashCode(email, code), expires: Date.now() + 600_000, tries: 0 });
    if (GMAIL_PASS && !testAddress) {
      const row = await sendMailNow({ to: email, template: 'sign_in_code', data: { code } });
      if (row.status === 'sent') return json(res, 200, { sent: true });
      return json(res, 502, { error: 'mail_failed', detail: row.error });
    }
    return json(res, 200, { sent: false, devCode: code });
  }
  if (action === 'verify-code') {
    const entry = signInCodes.get(email);
    if (!entry || entry.expires < Date.now()) return json(res, 200, { ok: false, reason: 'expired' });
    entry.tries++;
    if (entry.tries > 5) {
      signInCodes.delete(email);
      return json(res, 200, { ok: false, reason: 'expired' });
    }
    const given = hashCode(email, String(body.code ?? '').replace(/\D/g, ''));
    if (!timingSafeEqual(Buffer.from(given), Buffer.from(entry.hash))) return json(res, 200, { ok: false, reason: 'wrong' });
    signInCodes.delete(email);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not_found' });
}

/** A file of a first-party game (or the SDK every one of them loads from its own folder). */
function resolveOriginal(key) {
  const m = /^originals\/([a-z0-9-]+)\/(.*)$/.exec(key);
  if (!m) return undefined;
  if (m[2] === 'bg-sdk.js') return existsSync(SDK_FILE) ? SDK_FILE : null;
  // BS Kit, the shared toolkit of the newer originals, is served from games/_kit to every game.
  if (m[2] === 'bs-kit.js') return join(GAMES, '_kit', 'bs-kit.js');
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
  // The owner-code cookie is sent with these requests, so credentials are allowed for our own sites.
  if (origin) res.setHeader('access-control-allow-credentials', 'true');
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

/** Sends one stored file (a build file or media) with the game-origin headers. */
function sendFile(req, res, file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const type = MIME[extname(file).toLowerCase()];
  res.writeHead(200, {
    'content-type': type,
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
    ...gameHeaders(type, SITE_ORIGINS),
  });
  if (req.method === 'HEAD') return res.end();
  return createReadStream(file).pipe(res);
}

/**
 * A game's own origin, http://g-<id>.localhost:<port> (the local twin of workers/play): it serves
 * that game's folder and nothing else. No test tools, no database, no other game's files.
 */
function serveGameOrigin(req, res, label, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  const key = pathname.startsWith('/__mock') ? null : gameKey(label, pathname);
  if (!key) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const original = resolveOriginal(key);
  return sendFile(req, res, original === undefined ? resolveKey(key) : original);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const gameHost = /^([a-z0-9-]+)\.localhost(?::\d+)?$/.exec(String(req.headers.host ?? '').toLowerCase());
  if (gameHost) {
    try {
      return serveGameOrigin(req, res, gameHost[1], path);
    } catch (err) {
      return json(res, 500, { error: String(err) });
    }
  }
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (path === '/__mock/health') return json(res, 200, { ok: true, store: STORE });

    if (path.startsWith('/__mock/owner/')) return await ownerApi(req, res, path.slice('/__mock/owner/'.length));
    if (path.startsWith('/__mock/auth/') && req.method === 'POST') return await authApi(req, res, path.slice('/__mock/auth/'.length));

    if (path === '/__mock/mail' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 256 * 1024)) || '{}');
      return json(res, 200, await sendMailNow(body));
    }

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
      if (rest === 'seed' && req.method === 'POST') {
        // Puts back any BS Original that is missing, without touching anything else.
        return json(res, 200, { ok: true, added: seedOriginals() });
      }
      if (rest === 'stash' && req.method === 'POST') {
        // Automated tests empty the database. They stash it first and restore it afterwards.
        // A second stash (nested runs) must not replace the real data with test data.
        if (!stashed) {
          stashed = new Map([...tables].map(([k, v]) => [k, v.text]));
          mkdirSync(dirname(STASH_FILE), { recursive: true });
          writeFileSync(STASH_FILE, JSON.stringify({ tables: Object.fromEntries(stashed) }));
        }
        return json(res, 200, { ok: true, tables: stashed.size });
      }
      if (rest === 'restore' && req.method === 'POST') {
        if (!stashed) return json(res, 200, { ok: true, restored: 0 });
        tables.clear();
        for (const [name, text] of stashed) setTable(name, text);
        const restored = stashed.size;
        stashed = null;
        saveDbNow();
        rmSync(STASH_FILE, { force: true });
        return json(res, 200, { ok: true, restored });
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
      // Append-only tables (events, visits): several tabs and sites write at once, so rows are
      // added here instead of each page writing back its own, possibly outdated, copy.
      const appendTo = /^append\/([A-Za-z]{1,40})$/.exec(rest)?.[1];
      if (appendTo && req.method === 'POST') {
        const rows = JSON.parse(await readBody(req, 4 * 1024 * 1024));
        if (!Array.isArray(rows)) return json(res, 400, { error: 'invalid' });
        const cap = Number(url.searchParams.get('cap')) || 20000;
        setTable(appendTo, [...getRows(appendTo), ...rows].slice(-cap));
        return json(res, 200, { version: tables.get(appendTo).version });
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
      if (!new RegExp(`^http://[a-z0-9-]+\\.localhost:${PORT}/`).test(target)) {
        return json(res, 400, { error: 'url must be on a local game origin' });
      }
      return json(res, 200, await runPreQa(target));
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const key = path.replace(/^\/+/, '') || 'index.html';
      // Game pages never run on this shared origin (it holds the local database and test
      // tools): they open on their own g-<id>.localhost origin. Media and scripts still load here.
      if (/\.html?$/i.test(key) || key.endsWith('/')) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Games open on their own origin');
      }
      const original = resolveOriginal(key);
      return sendFile(req, res, original === undefined ? resolveKey(key) : original);
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
