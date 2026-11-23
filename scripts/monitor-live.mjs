/**
 * Live check of the three sites, the games server and the database API: everything answers, the
 * security headers are in place, private data stays private and the management portal stays
 * hidden. Exits 1 on any problem (the scheduled GitHub workflow then e-mails the owner).
 *
 *   SITE_URL=… DEVELOPERS_URL=… MANAGE_URL=… PLAY_ORIGIN=… SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/monitor-live.mjs
 */
const env = (k) => (process.env[k] ?? '').replace(/\/+$/, '');
const SITE = env('SITE_URL');
const DEV = env('DEVELOPERS_URL');
const MANAGE = env('MANAGE_URL');
const PLAY = env('PLAY_ORIGIN');
const SUPA = env('SUPABASE_URL');
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
const problems = [];
const ok = [];

async function get(url, init = {}) {
  try {
    return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init });
  } catch (err) {
    problems.push(`${url}: unreachable (${err.message})`);
    return null;
  }
}
const need = (cond, what) => (cond ? ok.push(what) : problems.push(what));

async function site(name, url, { hidden = false } = {}) {
  const res = await get(`${url}/`);
  if (!res) return '';
  need(res.status === 200, `${name}: answers 200 (got ${res.status})`);
  const h = (k) => res.headers.get(k) ?? '';
  need(/max-age=\d{7,}/.test(h('strict-transport-security')), `${name}: HSTS`);
  need(/default-src 'self'/.test(h('content-security-policy')), `${name}: content security policy`);
  need(h('x-frame-options').toUpperCase() === 'DENY', `${name}: cannot be framed`);
  need(h('x-content-type-options') === 'nosniff', `${name}: nosniff`);
  need(/camera=\(\)/.test(h('permissions-policy')), `${name}: camera and microphone off`);
  if (hidden) need(/noindex/.test(h('x-robots-tag')), `${name}: hidden from search engines`);
  return res.text();
}

const manageHost = MANAGE ? new URL(MANAGE).host : '';
for (const [name, url] of [['player site', SITE], ['developer portal', DEV]]) {
  if (!url) continue;
  const html = await site(name, url);
  if (manageHost) need(!html.includes(manageHost), `${name}: does not reveal the management portal`);
}
if (MANAGE) await site('management portal', MANAGE, { hidden: true });

if (PLAY) {
  const res = await get(`${PLAY}/no-such-game/1/index.html`);
  if (res) need(res.status === 404, `games server: answers and serves nothing outside a game (got ${res.status})`);
}

if (SUPA && KEY) {
  const headers = { apikey: KEY };
  const health = await get(`${SUPA}/functions/v1/health`, { headers });
  if (health) need(health.status === 200, `database: health check (got ${health.status})`);
  // Private tables must refuse the public key outright.
  for (const table of ['admin_audit_log', 'payout_profiles', 'studio_members', 'security_alerts']) {
    const res = await get(`${SUPA}/rest/v1/${table}?select=*&limit=1`, { headers });
    if (!res) continue;
    const body = await res.text();
    need(res.status >= 400 || body.trim() === '[]', `database: ${table} is private (got ${res.status})`);
  }
  // Game builds are private: only the games server reads them.
  const build = await get(`${SUPA}/storage/v1/object/public/builds/x/1/index.html`);
  if (build) need(build.status >= 400, `storage: builds are not public (got ${build.status})`);
}

for (const line of ok) console.log(`ok   ${line}`);
for (const line of problems) console.log(`FAIL ${line}`);
console.log(`${ok.length} passed, ${problems.length} failed`);
process.exit(problems.length ? 1 : 0);
