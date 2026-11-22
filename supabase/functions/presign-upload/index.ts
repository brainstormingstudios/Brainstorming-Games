// POST /functions/v1/presign-upload { versionId, files: [{ path, size }] }
// Opens the upload of a build into the private "builds" bucket in Supabase Storage. The caller
// must own the version, and every path must be a safe, relative path with an allowed file type.
// The database records every path and size first (register_upload); then, for 5 minutes, the
// developer's own sign-in may store exactly those files at exactly those sizes, once each
// (storage rules in migration 0025). Nothing is approved while uploads may still be open.
// The reply gives each file's storage key and the content type to send with it.
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
// 50 MB a file: the Supabase Storage free-plan limit (the "builds" bucket refuses bigger files).
const MAX_FILE = 50 * 1024 * 1024;
// How long the uploads stay open after this call (app.uploads_open allows 6 minutes).
const EXPIRES = 300;
const BUCKET = 'builds';

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
  const keys: Record<string, string> = {};
  const types: Record<string, string> = {};
  for (const f of files) {
    keys[f.path] = `${version.storage_prefix}/${f.path}`;
    types[f.path] = f.type;
  }
  return json(req, 200, { bucket: BUCKET, keys, types, expiresIn: EXPIRES });
});
