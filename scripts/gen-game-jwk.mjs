/**
 * Generates the ES256 key pair for game user tokens.
 *   node scripts/gen-game-jwk.mjs
 * Put the private JWK in the Edge Function secret GAME_JWT_PRIVATE_JWK
 * (`supabase secrets set GAME_JWT_PRIVATE_JWK='...'`) and the public JWK in the build variable
 * GAME_JWT_PUBLIC_JWK. The build publishes the public key at /.well-known/bg-game-jwks.json.
 */
import { webcrypto } from 'node:crypto';

const kid = `bg-${new Date().toISOString().slice(0, 10)}`;
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = { ...(await webcrypto.subtle.exportKey('jwk', pair.privateKey)), kid, alg: 'ES256', use: 'sig' };
const pub = { ...(await webcrypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'ES256', use: 'sig' };
delete pub.key_ops;
delete pub.ext;
console.log('GAME_JWT_PRIVATE_JWK (secret, Edge Functions only):');
console.log(JSON.stringify(priv));
console.log('\nGAME_JWT_PUBLIC_JWK (public, build variable):');
console.log(JSON.stringify(pub));
