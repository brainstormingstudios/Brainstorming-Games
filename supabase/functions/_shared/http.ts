// Shared helpers for the Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const clean = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');
const SITE_URL = clean(Deno.env.get('SITE_URL'));
/** The three sites: player, developer portal and management portal. */
const ORIGINS = [SITE_URL, clean(Deno.env.get('DEVELOPERS_URL')), clean(Deno.env.get('MANAGE_URL'))].filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // Only our three sites; never "*", even if SITE_URL were missing.
  const allowed = ORIGINS.includes(origin) ? origin : SITE_URL || 'null';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    vary: 'origin',
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(req) },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: cors(req) }) : null;
}

/**
 * The player's IP. Cloudflare's header first (it replaces any copy the client sends); the first
 * X-Forwarded-For entry is written by the client and is never trusted.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] ?? '';
}

/** Compares secrets in constant time, so response timing reveals nothing about them. */
export function sameSecret(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A client that acts as the caller (their JWT), so RLS and auth.uid() apply. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: {
      headers: {
        authorization: req.headers.get('authorization') ?? '',
        'x-forwarded-for': clientIp(req),
        // The database trusts x-bg-client-ip (and a country the events function passes) only
        // with this key: see app.client_ip() in 0020_security_fraud.sql.
        'x-bg-client-ip': clientIp(req),
        'x-bg-edge-key': Deno.env.get('BG_EDGE_KEY') ?? '',
      },
    },
    auth: { persistSession: false },
  });
}

/** The service-role client. Only for work that has already been authorised. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export async function requireUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  // The token must be passed explicitly: with no stored session, auth.getUser() does not read the
  // client's authorization header and answers "session missing" for everyone.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await userClient(req).auth.getUser(token);
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}

/**
 * True when the caller's session has passed the owner code (Supabase multi-factor sign-in, `aal2`).
 * The token was already verified by `requireUser`; this only reads its claim.
 */
export function hasOwnerCode(req: Request): boolean {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    const part = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return claims?.aal === 'aal2';
  } catch {
    return false;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
