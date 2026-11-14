import { SITE_URL, SUPABASE_ANON_KEY } from '@/lib/config';
import { emitTopic } from '../bus';
import { local } from '../local';
import { RepoError, type AuthRepo, type QuestsRepo, type SavesRepo, type ScoresRepo, type SessionUser } from '../repo';
import { functionsUrl, getSupabase } from './client';
import { toRepoError } from './errors';

interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  role: SessionUser['role'];
  is_minor: boolean;
  parental_consent_status: SessionUser['consent'];
  brain_points: number;
  level: number;
  streak_days: number;
  avatar_cosmetics: Record<string, string>;
  profile_public: boolean;
  playtest_opt_in: boolean;
  premium_plan: 'plus' | 'max' | null;
  premium_until: string | null;
  premium_auto_renew: boolean | null;
  premium_from_pass: boolean | null;
  created_at: string;
}

export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const res = await fetch(functionsUrl(name), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${data.session?.access_token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    if (res.status === 429) throw new RepoError('rate_limited');
    if (res.status === 401) throw new RepoError('login_required');
    if (res.status === 403) throw new RepoError('not_allowed');
    throw new RepoError('unavailable', json.error ?? `${name} ${res.status}`);
  }
  return json;
}

const redirect = (next?: string) => `${SITE_URL}/login/?next=${encodeURIComponent(next ?? '/')}`;

export const supabaseAuth: AuthRepo = {
  async session() {
    const db = getSupabase();
    const { data } = await db.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle<ProfileRow>();
    if (error) throw toRepoError(error);
    return {
      id: user.id,
      email: user.email ?? '',
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? '',
      role: profile?.role ?? 'player',
      isMinor: profile?.is_minor ?? true,
      consent: profile?.parental_consent_status ?? 'pending',
      brainPoints: profile?.brain_points ?? 0,
      level: profile?.level ?? 1,
      streakDays: profile?.streak_days ?? 0,
      avatar: profile?.avatar_cosmetics ?? {},
      profilePublic: profile?.profile_public ?? true,
      playtestOptIn: profile?.playtest_opt_in ?? false,
      premium:
        profile?.premium_plan && profile.premium_until
          ? { plan: profile.premium_plan, until: profile.premium_until, autoRenew: Boolean(profile.premium_auto_renew), fromPass: Boolean(profile.premium_from_pass) }
          : null,
      createdAt: profile?.created_at ?? user.created_at,
    };
  },
  async signInWithEmail(email, next) {
    const { error } = await getSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect(next) } });
    if (error) throw new RepoError(error.status === 429 ? 'rate_limited' : 'invalid', error.message);
    // The e-mail carries a 6-digit code ({{ .Token }} in the Supabase e-mail template).
    return { status: 'code_sent' };
  },
  async verifyEmailCode(email, code) {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: code.replace(/\D/g, ''), type: 'email' });
    if (error) throw new RepoError('invalid', 'That code is not right, or it has expired.');
    emitTopic('session', { local: true });
  },
  async signInWithProvider(provider, next) {
    const { error } = await getSupabase().auth.signInWithOAuth({ provider, options: { redirectTo: redirect(next) } });
    if (error) throw new RepoError('unavailable', error.message);
  },
  async signInWithGoogleIdToken(idToken) {
    // Supabase checks Google's signature and the audience before it trusts the e-mail.
    const { error } = await getSupabase().auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw new RepoError('invalid', error.message);
    emitTopic('session', { local: true });
  },
  async completeSignup(username, birthYear, locale) {
    const { error } = await getSupabase().rpc('complete_signup', { p_username: username, p_birth_year: birthYear, p_locale: locale });
    if (error) throw toRepoError(error);
    emitTopic('session', { local: true });
    const user = await supabaseAuth.session();
    if (!user) throw new RepoError('login_required');
    return user;
  },
  async usernameAvailable(username) {
    const { data, error } = await getSupabase().rpc('username_available', { p_username: username });
    if (error) throw toRepoError(error);
    return Boolean(data);
  },
  async signOut() {
    await getSupabase().auth.signOut();
    emitTopic('session', { local: true });
  },
  async updateProfile(patch) {
    const { error } = await getSupabase().rpc('update_profile', {
      p_patch: {
        display_name: patch.displayName,
        locale: patch.locale,
        low_data: patch.lowData,
        school_safe: patch.schoolSafe,
        profile_public: patch.profilePublic,
        playtest_opt_in: patch.playtestOptIn,
      },
    });
    if (error) throw toRepoError(error);
    emitTopic('session', { local: true });
    emitTopic('profile');
  },
  async requestParentalConsent(parentEmail) {
    await callFunction('parental-consent', { parentEmail });
    return {};
  },
  async consentView(token) {
    const { data, error } = await getSupabase().rpc('parental_consent_view', { p_token: token });
    if (error) throw toRepoError(error);
    return (data as { username: string; status: SessionUser['consent']; expired: boolean } | null) ?? null;
  },
  async consentResolve(token, approve) {
    const { data, error } = await getSupabase().rpc('parental_consent_resolve', { p_token: token, p_approve: approve });
    if (error) throw toRepoError(error);
    return data as SessionUser['consent'];
  },
  async exportData() {
    const { data, error } = await getSupabase().rpc('export_my_data');
    if (error) throw toRepoError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
  async deleteAccount() {
    const { error } = await getSupabase().rpc('delete_my_account');
    if (error) throw toRepoError(error);
    await getSupabase().auth.signOut();
    emitTopic('session', { local: true });
  },
  async gameToken(gameId) {
    const { token } = await callFunction<{ token: string | null }>('game-token', { gameId });
    return token;
  },
  async ownerCodeStatus() {
    const mfa = getSupabase().auth.mfa;
    const [factors, level] = await Promise.all([mfa.listFactors(), mfa.getAuthenticatorAssuranceLevel()]);
    return {
      enrolled: (factors.data?.totp ?? []).some((f) => f.status === 'verified'),
      // aal2 means this session has passed the code. The database checks the same claim.
      unlocked: level.data?.currentLevel === 'aal2',
    };
  },
  async ownerCodeEnroll() {
    const mfa = getSupabase().auth.mfa;
    // Half-finished set-ups are removed so there is only ever one pending secret.
    const existing = await mfa.listFactors();
    for (const f of existing.data?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await mfa.unenroll({ factorId: f.id });
    const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: `Owner code ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) throw toRepoError(error ?? { message: 'enroll failed' });
    return { secret: data.totp.secret, uri: data.totp.uri };
  },
  async ownerCodeVerify(code) {
    const mfa = getSupabase().auth.mfa;
    const factors = await mfa.listFactors();
    const all = (factors.data?.all ?? []).filter((f) => f.factor_type === 'totp');
    const factor = all.find((f) => f.status === 'verified') ?? all[0];
    if (!factor) return false;
    const { error } = await mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\D/g, '') });
    if (error) {
      if (/rate|too many/i.test(error.message)) throw new RepoError('rate_limited');
      return false;
    }
    emitTopic('session', { local: true });
    return true;
  },
  async ownerCodeLock() {
    // A session cannot step back down from aal2: locking means signing out.
    await getSupabase().auth.signOut();
  },
};

const guestKey = (gameId: string, key: string) => `bg.saves.${gameId}.${key}`;

async function userId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}

export const supabaseSaves: SavesRepo = {
  async get(gameId, key) {
    const uid = await userId();
    if (!uid) return local.get(guestKey(gameId, key), null);
    const { data, error } = await getSupabase()
      .from('cloud_saves')
      .select('value')
      .eq('game_id', gameId)
      .eq('key', key)
      .maybeSingle<{ value: unknown }>();
    if (error) throw toRepoError(error);
    return data?.value ?? null;
  },
  async set(gameId, key, value) {
    const uid = await userId();
    if (!uid) {
      local.set(guestKey(gameId, key), value);
      return;
    }
    const { error } = await getSupabase()
      .from('cloud_saves')
      .upsert({ user_id: uid, game_id: gameId, key, value, updated_at: new Date().toISOString() });
    if (error) throw toRepoError(error);
  },
  async remove(gameId, key) {
    const uid = await userId();
    if (!uid) {
      local.remove(guestKey(gameId, key));
      return;
    }
    const { error } = await getSupabase().from('cloud_saves').delete().eq('game_id', gameId).eq('key', key);
    if (error) throw toRepoError(error);
  },
};

export const supabaseScores: ScoresRepo = {
  async startSession(gameId, versionId) {
    const { data, error } = await getSupabase().rpc('start_play_session', {
      p_game_id: gameId,
      p_version_id: versionId,
      p_anon_id: null,
    });
    if (error) throw toRepoError(error);
    return (data as string | null) ?? null;
  },
  async submit(gameId, board, score, sessionId) {
    const { data, error } = await getSupabase().rpc('submit_score', {
      p_game_id: gameId,
      p_board: board,
      p_score: score,
      p_session_id: sessionId,
    });
    if (error) throw toRepoError(error);
    return { accepted: Boolean((data as { accepted?: boolean } | null)?.accepted) };
  },
  async top(gameId, board, { limit, friends, period }) {
    const { data, error } = await getSupabase().rpc('leaderboard_top', {
      p_game_id: gameId,
      p_board: board,
      p_period: period,
      p_friends: friends,
      p_limit: limit,
    });
    if (error) throw toRepoError(error);
    type Row = { rank: number; name: string; score: number; is_me: boolean; cosmetics: Record<string, string> };
    const result = (data ?? { entries: [], me: null }) as { entries: Row[]; me: Row | null };
    const map = (r: Row) => ({ rank: Number(r.rank), name: r.name, score: Number(r.score), isMe: r.is_me, cosmetics: r.cosmetics });
    return { entries: result.entries.map(map), me: result.me ? map(result.me) : null };
  },
};

export const supabaseQuests: Pick<QuestsRepo, 'track'> = {
  async track(event, value) {
    const { error } = await getSupabase().rpc('track_quest_event', { p_event: event, p_value: value });
    if (error) throw toRepoError(error);
  },
};
