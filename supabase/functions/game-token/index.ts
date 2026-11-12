// POST /functions/v1/game-token { gameId } → { token }
// A short-lived ES256 JWT { sub, gameId, iat, exp, iss } that a game's own server can verify with
// the public JWKS published at /.well-known/bg-game-jwks.json (see docs/SDK.md).
import { json, preflight, requireUser, userClient } from '../_shared/http.ts';

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let key: CryptoKey | null = null;
let kid = 'bg-1';

async function signingKey(): Promise<CryptoKey> {
  if (key) return key;
  const jwk = JSON.parse(Deno.env.get('GAME_JWT_PRIVATE_JWK') ?? '{}') as JsonWebKey & { kid?: string };
  kid = jwk.kid ?? kid;
  key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return key;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = await requireUser(req);
  if (!user) return json(req, 401, { error: 'login_required' });
  const { gameId } = (await req.json().catch(() => ({}))) as { gameId?: string };
  if (!gameId) return json(req, 400, { error: 'invalid' });
  const { data: game } = await userClient(req).from('game_cards').select('id').eq('id', gameId).maybeSingle();
  if (!game) return json(req, 404, { error: 'not_found' });
  const now = Math.floor(Date.now() / 1000);
  const k = await signingKey();
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify({ sub: user.id, gameId, iat: now, exp: now + 3600, iss: 'brainstorming-games' }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, new TextEncoder().encode(`${header}.${payload}`)));
  return json(req, 200, { token: `${header}.${payload}.${b64url(sig)}` });
});
