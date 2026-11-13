// POST /functions/v1/payout-profile
//   { action: 'get' }                → the caller's masked payout summary
//   { action: 'save', profile }      → encrypts and stores the caller's payout details
//   { action: 'reveal', studioId }   → admin only: the decrypted details, to send a payout
// Details are encrypted with AES-GCM (key in the PAYOUT_ENCRYPTION_KEY secret) and stored in
// studio_payout_profiles, a table with no client policies at all.
import { adminClient, json, preflight, requireUser, userClient } from '../_shared/http.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(): Promise<CryptoKey> {
  const raw = unb64(Deno.env.get('PAYOUT_ENCRYPTION_KEY') ?? '');
  if (raw.length !== 32) throw new Error('PAYOUT_ENCRYPTION_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

interface Profile {
  method: 'bank' | 'paypal' | 'wise' | 'payoneer';
  currency: 'INR' | 'USD';
  accountName: string;
  details: Record<string, string>;
}

function validate(p: Profile): string | null {
  if (!['bank', 'paypal', 'wise', 'payoneer'].includes(p.method) || !['INR', 'USD'].includes(p.currency)) return 'invalid method';
  if (String(p.accountName ?? '').trim().length < 3) return 'invalid name';
  if (p.method === 'bank') {
    if (p.currency !== 'INR' || !/^\d{9,18}$/.test(p.details?.accountNumber ?? '') || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(p.details?.ifsc ?? '')) return 'invalid bank details';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.details?.email ?? '')) return 'invalid e-mail';
  return null;
}

function mask(p: Profile): string {
  if (p.method === 'bank') return `Bank ••••${p.details.accountNumber.slice(-4)} (${p.details.ifsc.toUpperCase()})`;
  const [u = '', d = ''] = p.details.email.split('@');
  return `${{ paypal: 'PayPal', wise: 'Wise', payoneer: 'Payoneer' }[p.method]} ${u.slice(0, 2)}•••@${d}`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = await requireUser(req);
  if (!user) return json(req, 401, { error: 'login_required' });
  const body = (await req.json().catch(() => ({}))) as { action?: string; profile?: Profile; studioId?: string };
  const db = adminClient();

  if (body.action === 'reveal') {
    const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') return json(req, 403, { error: 'not_allowed' });
    const { data: row } = await db.from('studio_payout_profiles').select('*').eq('studio_id', body.studioId ?? '').maybeSingle();
    if (!row) return json(req, 404, { error: 'not_found' });
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await key(), unb64(row.ciphertext));
    await db.from('admin_audit_log').insert({ actor_id: user.id, action: 'payout_profile_reveal', target_type: 'studio', target_id: body.studioId, detail: {} });
    return json(req, 200, { profile: JSON.parse(dec.decode(plain)) });
  }

  // The caller's own studio (RLS: only their own row is visible).
  const { data: studio } = await userClient(req).from('studios').select('id').eq('owner_id', user.id).maybeSingle();
  if (!studio) return json(req, 403, { error: 'not_allowed' });

  if (body.action === 'get') {
    const { data: row } = await db.from('studio_payout_profiles').select('method, currency, ciphertext, iv, updated_at').eq('studio_id', studio.id).maybeSingle();
    if (!row) return json(req, 200, { profile: null });
    const plain = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await key(), unb64(row.ciphertext)))) as Profile;
    return json(req, 200, { profile: { method: row.method, currency: row.currency, summary: mask(plain), updatedAt: row.updated_at } });
  }

  if (body.action === 'save' && body.profile) {
    const error = validate(body.profile);
    if (error) return json(req, 400, { error });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(JSON.stringify(body.profile))));
    const { error: dbError } = await db.from('studio_payout_profiles').upsert({
      studio_id: studio.id,
      ciphertext: b64(cipher),
      iv: b64(iv),
      key_version: 1,
      method: body.profile.method,
      currency: body.profile.currency,
      updated_at: new Date().toISOString(),
    });
    if (dbError) return json(req, 500, { error: 'could not save' });
    return json(req, 200, { saved: true });
  }
  return json(req, 400, { error: 'invalid action' });
});
