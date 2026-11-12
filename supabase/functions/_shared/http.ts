// Shared helpers for the Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = SITE_URL && origin === SITE_URL ? origin : SITE_URL || '*';
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

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim();
}

/** A client that acts as the caller (their JWT), so RLS and auth.uid() apply. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: {
      headers: {
        authorization: req.headers.get('authorization') ?? '',
        'x-forwarded-for': clientIp(req),
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
  const { data } = await userClient(req).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
