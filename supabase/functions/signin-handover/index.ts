// POST /functions/v1/signin-handover { code }
// The second half of the one-click sign-in between our three sites (migration 0030). The site the
// player is already signed in on made a single-use code for this site; we spend it (60 seconds,
// once, only for the site it was made for) and return a one-time sign-in token for the same
// account, which the browser exchanges for a fresh session. The new session has not passed the
// owner code, so the management portal still asks for it.
import { adminClient, json, preflight } from '../_shared/http.ts';

const clean = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');
const SITES = [clean(Deno.env.get('SITE_URL')), clean(Deno.env.get('DEVELOPERS_URL')), clean(Deno.env.get('MANAGE_URL'))].filter(Boolean);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });
  const origin = clean(req.headers.get('origin') ?? '');
  if (!SITES.includes(origin)) return json(req, 403, { error: 'not_allowed' });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (typeof code !== 'string' || !/^[0-9a-f]{64}$/.test(code)) return json(req, 400, { error: 'invalid' });
  const db = adminClient();
  const { data: userId, error } = await db.rpc('redeem_signin_handover', { p_code: code, p_origin: origin });
  if (error || !userId) return json(req, 400, { error: 'invalid' });
  const { data: found } = await db.auth.admin.getUserById(String(userId));
  const email = found.user?.email;
  if (!email || found.user?.banned_until) return json(req, 403, { error: 'not_allowed' });
  // generateLink sends no e-mail: it only makes the one-time token the browser verifies.
  const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link?.properties?.hashed_token) return json(req, 502, { error: 'unavailable' });
  return json(req, 200, { tokenHash: link.properties.hashed_token });
});
