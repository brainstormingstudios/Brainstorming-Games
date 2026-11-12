// POST /functions/v1/presign-upload { versionId, files: [{ path, size, type }] }
// Returns presigned PUT URLs (AWS SigV4, 15 minutes) so the browser uploads a build straight to
// Cloudflare R2. The caller must own the version (checked through RLS) and every path must be a
// safe, relative path with an allowed file type.
import { json, preflight, userClient } from '../_shared/http.ts';

const ALLOWED = new Set([
  'html', 'htm', 'js', 'mjs', 'css', 'json', 'txt', 'xml', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico',
  'woff', 'woff2', 'ttf', 'otf', 'wasm', 'data', 'bin', 'unityweb', 'pck', 'mem', 'br', 'gz', 'mp3', 'ogg', 'wav',
  'm4a', 'mp4', 'webm', 'atlas', 'fnt', 'glb', 'gltf', 'ktx2', 'basis', 'map',
]);
const MAX_FILE = 100 * 1024 * 1024;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const encodePath = (p: string) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

/** SigV4 query-string presign for an S3-compatible PUT (R2 uses region "auto"). */
async function presignPut(key: string, expires = 900): Promise<string> {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
  const bucket = Deno.env.get('R2_BUCKET')!;
  const accessKey = Deno.env.get('R2_ACCESS_KEY_ID')!;
  const secret = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const path = `/${bucket}/${encodePath(key)}`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });
  query.sort();
  const canonicalQuery = query.toString().replace(/\+/g, '%20');
  const canonical = ['PUT', path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
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
  // RLS: the select only returns the row if the caller owns the game.
  const { data: version } = await userClient(req)
    .from('game_versions')
    .select('id, storage_prefix, qa_status')
    .eq('id', body.versionId)
    .maybeSingle();
  if (!version) return json(req, 403, { error: 'not_allowed' });
  if (version.qa_status !== 'uploaded') return json(req, 409, { error: 'version is no longer accepting files' });

  const urls: Record<string, string> = {};
  for (const f of body.files) {
    const p = String(f.path).replace(/\\/g, '/');
    const ext = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!p || p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '') || !ALLOWED.has(ext)) {
      return json(req, 400, { error: `invalid path: ${p}` });
    }
    if (!(f.size > 0 && f.size <= MAX_FILE)) return json(req, 400, { error: `invalid size: ${p}` });
    urls[p] = await presignPut(`${version.storage_prefix}/${p}`);
  }
  return json(req, 200, { urls });
});
