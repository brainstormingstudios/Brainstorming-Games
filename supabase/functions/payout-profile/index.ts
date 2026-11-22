// POST /functions/v1/payout-profile
//   { action: 'get' }                → the caller's masked payout summary (and any change on hold)
//   { action: 'save', profile }      → encrypts the caller's new payout details; they wait 48 hours
//   { action: 'cancel' }             → drops a change that is still on hold
//   { action: 'reveal', studioId }   → admin only: the details in use, to send a payout
//   scope: 'creator'                 → the same for the caller's creator account (reveal: creatorId)
// Details are encrypted with AES-GCM (key in the PAYOUT_ENCRYPTION_KEY secret) and stored in
// studio_payout_profiles or creator_payout_profiles, tables with no client policies at all.
//
// Account takeover defence (Security Phase 3): a change needs a sign-in from the last 15 minutes,
// is e-mailed to the account's address, raises a staff alert, and only takes effect after 48
// hours. Until then payouts keep going to the old details, and the owner can cancel.
import { adminClient, hasOwnerCode, json, preflight, requireUser, userClient } from '../_shared/http.ts';

const HOLD_HOURS = 48;
const REAUTH_SECONDS = 15 * 60;

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
  // Indian bank accounts only for now (earnings are open in India only).
  if (p.method !== 'bank' || p.currency !== 'INR') return 'invalid method';
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

async function open(cipher: string | null, iv: string | null): Promise<Profile | null> {
  if (!cipher || !iv) return null;
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(cipher)))) as Profile;
}

/** Seconds since the caller last proved who they are (the newest sign-in method in the token). */
function secondsSinceSignIn(req: Request): number {
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const claims = JSON.parse(atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')));
    const times = (Array.isArray(claims?.amr) ? claims.amr : []).map((a: { timestamp?: number }) => Number(a?.timestamp) || 0);
    const last = Math.max(0, ...times);
    return last ? Math.floor(Date.now() / 1000) - last : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = await requireUser(req);
  if (!user) return json(req, 401, { error: 'login_required' });
  const body = (await req.json().catch(() => ({}))) as { action?: string; profile?: Profile; studioId?: string; creatorId?: string; scope?: 'studio' | 'creator' };
  const db = adminClient();
  const creatorScope = body.scope === 'creator';
  const table = creatorScope ? 'creator_payout_profiles' : 'studio_payout_profiles';
  const keyColumn = creatorScope ? 'creator_id' : 'studio_id';
  // Changes whose 48 hours are over move into use before anything is read.
  await db.rpc('promote_payout_profiles');

  if (body.action === 'reveal') {
    const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin' || !hasOwnerCode(req)) return json(req, 403, { error: 'not_allowed' });
    const target = (creatorScope ? body.creatorId : body.studioId) ?? '';
    const { data: row } = await db.from(table).select('*').eq(keyColumn, target).maybeSingle();
    const profile = row ? await open(row.ciphertext, row.iv) : null;
    if (!profile) return json(req, 404, { error: 'not_found', pendingUntil: row?.pending_effective_at ?? null });
    await db.from('admin_audit_log').insert({ actor_id: user.id, action: 'payout_profile_reveal', target_type: creatorScope ? 'creator' : 'studio', target_id: target, detail: {} });
    return json(req, 200, { profile, pendingUntil: row.pending_effective_at ?? null });
  }

  // The caller's own studio or approved creator account (RLS: only their own row is visible).
  const owner = creatorScope
    ? (await userClient(req).from('creators').select('id').eq('user_id', user.id).eq('status', 'approved').maybeSingle()).data
    : (await userClient(req).from('studios').select('id').eq('owner_id', user.id).maybeSingle()).data;
  if (!owner) return json(req, 403, { error: 'not_allowed' });

  if (body.action === 'get') {
    const { data: row } = await db.from(table).select('*').eq(keyColumn, owner.id).maybeSingle();
    if (!row) return json(req, 200, { profile: null });
    const current = await open(row.ciphertext, row.iv);
    const pending = await open(row.pending_ciphertext, row.pending_iv);
    return json(req, 200, {
      profile: {
        method: current?.method ?? null,
        currency: current?.currency ?? null,
        summary: current ? mask(current) : null,
        updatedAt: row.updated_at,
        pending: pending ? { method: pending.method, currency: pending.currency, summary: mask(pending), effectiveAt: row.pending_effective_at } : null,
      },
    });
  }

  if (body.action === 'cancel') {
    await db.from(table).update({
      pending_ciphertext: null, pending_iv: null, pending_key_version: null, pending_method: null,
      pending_currency: null, pending_requested_at: null, pending_effective_at: null,
    }).eq(keyColumn, owner.id);
    await db.rpc('raise_security_alert', {
      p_kind: 'payout_change_cancelled', p_severity: 'warn', p_title: 'A payout-details change was cancelled by its owner',
      p_detail: { scope: creatorScope ? 'creator' : 'studio', id: owner.id }, p_dedupe: null,
    });
    return json(req, 200, { cancelled: true });
  }

  if (body.action === 'save' && body.profile) {
    if (secondsSinceSignIn(req) > REAUTH_SECONDS) return json(req, 401, { error: 'reauth_required' });
    const error = validate(body.profile);
    if (error) return json(req, 400, { error });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(JSON.stringify(body.profile))));
    const effectiveAt = new Date(Date.now() + HOLD_HOURS * 3_600_000).toISOString();
    const { error: dbError } = await db.from(table).upsert({
      [keyColumn]: owner.id,
      pending_ciphertext: b64(cipher),
      pending_iv: b64(iv),
      pending_key_version: 1,
      pending_method: body.profile.method,
      pending_currency: body.profile.currency,
      pending_requested_at: new Date().toISOString(),
      pending_effective_at: effectiveAt,
    });
    if (dbError) return json(req, 500, { error: 'could not save' });
    const summary = mask(body.profile);
    if (user.email) {
      await db.from('email_outbox').insert({
        to_email: user.email.toLowerCase(),
        template: 'payout_details_changed',
        data: { summary, effectiveAt: `${effectiveAt.slice(0, 16).replace('T', ' ')} UTC`, scope: creatorScope ? 'creator' : 'studio' },
      });
    }
    await db.rpc('raise_security_alert', {
      p_kind: 'payout_change', p_severity: 'info', p_title: 'Payout details changed (on hold for 48 hours)',
      p_detail: { scope: creatorScope ? 'creator' : 'studio', id: owner.id, summary }, p_dedupe: null,
    });
    return json(req, 200, { saved: true, effectiveAt });
  }
  return json(req, 400, { error: 'invalid action' });
});
