import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_COOKIE_DOMAIN, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

let client: SupabaseClient | null = null;

/**
 * Keeps the session in cookies on the parent domain so the player site and the two portals share
 * one sign-in. A session is larger than one cookie may be, so it is split into numbered chunks.
 */
const CHUNK = 3000;
const YEAR = 365 * 24 * 60 * 60;
const cookieStorage = {
  getItem(key: string): string | null {
    const all = new Map(
      document.cookie.split('; ').map((c) => {
        const i = c.indexOf('=');
        return [c.slice(0, i), c.slice(i + 1)] as const;
      }),
    );
    let out = '';
    for (let i = 0; all.has(`${key}.${i}`); i++) out += all.get(`${key}.${i}`);
    return out ? decodeURIComponent(out) : null;
  },
  setItem(key: string, value: string): void {
    this.removeItem(key);
    const encoded = encodeURIComponent(value);
    for (let i = 0; i * CHUNK < encoded.length; i++) {
      document.cookie = `${key}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}; Domain=${AUTH_COOKIE_DOMAIN}; Path=/; Max-Age=${YEAR}; SameSite=Lax; Secure`;
    }
  },
  removeItem(key: string): void {
    for (const c of document.cookie.split('; ')) {
      const name = c.slice(0, c.indexOf('='));
      if (name.startsWith(`${key}.`)) document.cookie = `${name}=; Domain=${AUTH_COOKIE_DOMAIN}; Path=/; Max-Age=0; SameSite=Lax; Secure`;
    }
  },
};

/** Browser Supabase client. Only the anon key is ever present in the client bundle. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        ...(AUTH_COOKIE_DOMAIN && typeof document !== 'undefined' ? { storage: cookieStorage, storageKey: 'bg-auth' } : {}),
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export const functionsUrl = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
