// POST /functions/v1/presign-upload { versionId, files: [{ path, size }] }
// Returns presigned PUT URLs (AWS SigV4) so the browser uploads a build straight to Cloudflare R2.
// The caller must own the version, and every path must be a safe, relative path with an allowed
// file type. Each link:
// - lasts 5 minutes;
// - is bound to the exact size (content-length) and to the content type we choose from the file
//   extension, so a ".js" cannot be stored as a web page and a 1 KB slot cannot take 5 GB;
// - is write-once (If-None-Match: *), so a file cannot be swapped after pre-QA has looked at it.
// The database records every path and size first (register_upload) and approves nothing while
// links may still be open.
import { json, preflight, userClient } from '../_shared/http.ts';

const TYPES: Record<string, string> = {
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
const MAX_FILE = 100 * 1024 * 1024;
const EXPIRES = 300;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const encodePath = (p: string) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

/** SigV4 query-string presign for an S3-compatible PUT (R2 uses region "auto"). */
async function presignPut(key: string, size: number, type: string): Promise<string> {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
  const bucket = Deno.env.get('R2_BUCKET')!;
  const accessKey = Deno.env.get('R2_ACCESS_KEY_ID')!;
  const secret = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const path = `/${bucket}/${encodePath(key)}`;
  // Canonical headers, lower-case and sorted. The browser must send exactly these values.
  const headers: [string, string][] = [
    ['content-length', String(size)],
    ['content-type', type],
    ['host', host],
    ['if-none-match', '*'],
  ];
  const signedHeaders = headers.map(([k]) => k).join(';');
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(EXPIRES),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  query.sort();
  const canonicalQuery = query.toString().replace(/\+/g, '%20');
  const canonicalHeaders = headers.map(([k, v]) => `${k}:${v}\n`).join('');
  const canonical = ['PUT', path, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac(enc.encode(`AWS4${secret}`), day);
  k = await hmac(k, 'auto');
  k = await hmac(k, 's3');
  k = await hmac(k, 'aws4_request');
  const signature = hex(await hmac(k, toSign));
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });
  const body = (await req.json().catch(() => null)) as { versionId?: string; files?: { path: string; size: number }[] } | null;
  if (!body?.versionId || !Array.isArray(body.files) || body.files.length === 0 || body.files.length > 100) {
    return json(req, 400, { error: 'invalid' });
  }
  const files: { path: string; size: number; type: string }[] = [];
  for (const f of body.files) {
    const p = String(f?.path ?? '');
    const ext = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!p || p.length > 300 || p.includes('\\') || p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '.' || s === '') || [...p].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) ||!TYPES[ext]) {
      return json(req, 400, { error: `invalid path: ${p.slice(0, 100)}` });
    }
    const size = Number(f.size);
    if (!(Number.isInteger(size) && size > 0 && size <= MAX_FILE)) return json(req, 400, { error: `invalid size: ${p}` });
    files.push({ path: p, size, type: TYPES[ext]! });
  }
  const db = userClient(req);
  // RLS: the select only returns the row if the caller owns the game.
  const { data: version } = await db.from('game_versions').select('id, storage_prefix, qa_status').eq('id', body.versionId).maybeSingle();
  if (!version) return json(req, 403, { error: 'not_allowed' });
  if (version.qa_status !== 'uploaded') return json(req, 409, { error: 'version is no longer accepting files' });
  // Recorded before anything is signed; refuses paths, sizes or totals the version did not declare.
  const { error } = await db.rpc('register_upload', { p_version: version.id, p_files: files.map(({ path, size }) => ({ path, size })) });
  if (error) {
    const limited = error.message.includes('rate_limited');
    return json(req, limited ? 429 : 400, { error: limited ? 'rate_limited' : 'invalid' });
  }
  const urls: Record<string, string> = {};
  const types: Record<string, string> = {};
  for (const f of files) {
    urls[f.path] = await presignPut(`${version.storage_prefix}/${f.path}`, f.size, f.type);
    types[f.path] = f.type;
  }
  return json(req, 200, { urls, types, expiresIn: EXPIRES });
});
