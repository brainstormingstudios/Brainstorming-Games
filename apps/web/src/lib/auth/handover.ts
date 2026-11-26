'use client';

import { IS_MOCK } from '@/lib/config';
import { emitTopic } from '@/lib/data/bus';

const KEY = 'bg-handover';

/**
 * One-click sign-in between our three sites (they are separate pages.dev addresses, so they
 * cannot share a sign-in). Opens `url` on another of our sites, signed in as the same account:
 * a single-use, 60-second code travels in the address's #fragment (never sent to any server's
 * logs) and the other site exchanges it once. Falls back to a plain link when not signed in.
 */
export async function openSignedIn(url: string): Promise<void> {
  if (IS_MOCK) {
    window.location.assign(url);
    return;
  }
  try {
    const { getSupabase } = await import('@/lib/data/supabase/client');
    const db = getSupabase();
    const { data } = await db.auth.getSession();
    if (!data.session) {
      window.location.assign(url);
      return;
    }
    const target = new URL(url, window.location.href);
    const { data: code, error } = await db.rpc('create_signin_handover', { p_target: target.origin });
    if (error || typeof code !== 'string') {
      window.location.assign(url);
      return;
    }
    target.hash = `${KEY}=${code}`;
    window.location.assign(target.toString());
  } catch {
    window.location.assign(url);
  }
}

/** On page load: spends a hand-over code in the address, if there is one. */
export async function consumeHandover(): Promise<void> {
  if (IS_MOCK || typeof window === 'undefined') return;
  const match = new RegExp(`(?:^#|&)${KEY}=([0-9a-f]{64})`).exec(window.location.hash);
  if (!match) return;
  // Remove the code from the address straight away (history, screenshots, sharing).
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    const [{ getSupabase }, { callFunction }] = await Promise.all([import('@/lib/data/supabase/client'), import('@/lib/data/supabase/account')]);
    const db = getSupabase();
    const { data: current } = await db.auth.getSession();
    if (current.session) return; // already signed in here
    const { tokenHash } = await callFunction<{ tokenHash: string }>('signin-handover', { code: match[1] });
    const { error } = await db.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    if (!error) emitTopic('session');
  } catch {
    // The visitor can still sign in normally.
  }
}
