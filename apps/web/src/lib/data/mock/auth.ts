import { AGE_GATE } from '@/lib/config';
import { GOOGLE_CLIENT_ID, OWNER_EMAILS, PLAY_ORIGIN } from '@/lib/config';
import { sendMail } from './mail';
import { isMinorByBirthYear } from '@/lib/domain/ageGate';
import { emitTopic } from '../bus';
import { getAnonId, guestFavourites, guestHistory, session as tabSession, uuid } from '../local';
import type { AuthRepo, SessionUser } from '../repo';
import { fail, mutateTable, newId, nowIso, readTable, takeToken, type MockUser } from './db';

/**
 * Mock accounts. The "database" (localStorage) is shared by every tab, but the signed-in user is
 * per tab (sessionStorage), so two tabs can be two different players.
 * Mock-mode convenience: an e-mail that starts with `admin@` gets the admin role.
 */
const SESSION_KEY = 'bg.mock.uid';
/** Cookie that carries the sign-in. Cookies ignore the port, so localhost:3000, :3001 and :3002 share it. */
const SESSION_COOKIE = 'bg_uid';
/** Set by automated tests so each tab can be a different person. */
const TAB_SCOPED = 'bg.session.tab';
const MONTH_SECONDS = 30 * 24 * 60 * 60;

const tabScoped = () => tabSession.get<string | null>(TAB_SCOPED, null) != null;

function readSessionId(): string | null {
  if (typeof document === 'undefined') return null;
  if (tabScoped()) return tabSession.get<string | null>(SESSION_KEY, null);
  const match = /(?:^|;\s*)bg_uid=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Signs this browser in (or out, with null) on every site of the product. */
function writeSessionId(id: string | null): void {
  if (typeof document === 'undefined') return;
  if (tabScoped()) {
    if (id) tabSession.set(SESSION_KEY, id);
    else writeSessionId(null);
    return;
  }
  document.cookie = `${SESSION_COOKIE}=${id ? encodeURIComponent(id) : ''}; Path=/; Max-Age=${id ? MONTH_SECONDS : 0}; SameSite=Lax`;
}

export function currentUserId(): string | null {
  return readSessionId();
}

export function currentMockUser(): MockUser | null {
  const id = currentUserId();
  if (!id) return null;
  const user = readTable('users').find((u) => u.id === id && !u.bannedAt) ?? null;
  return user;
}

export function requireUser(): MockUser {
  const user = currentMockUser();
  if (!user) fail('login_required');
  return user;
}

export function requireProfile(): MockUser & { username: string } {
  const user = requireUser();
  if (!user.username) fail('login_required');
  return user as MockUser & { username: string };
}

export function requireStaff(): MockUser {
  const user = requireUser();
  if (user.role !== 'admin' && user.role !== 'moderator') fail('not_allowed');
  return user;
}

export function toSessionUser(u: MockUser): SessionUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isMinor: u.isMinor,
    consent: u.consent,
    brainPoints: u.brainPoints,
    level: u.level,
    streakDays: u.streakDays,
    avatar: u.avatar,
    profilePublic: u.profilePublic,
    playtestOptIn: u.playtestOptIn,
    premium: u.premiumPlan && u.premiumUntil ? { plan: u.premiumPlan, until: u.premiumUntil, autoRenew: Boolean(u.premiumAutoRenew), fromPass: Boolean(u.premiumFromPass) } : null,
    createdAt: u.createdAt,
  };
}

export function updateUser(id: string, patch: Partial<MockUser>): MockUser {
  let updated: MockUser | null = null;
  mutateTable('users', (rows) => {
    const row = rows.find((u) => u.id === id);
    if (row) {
      Object.assign(row, patch);
      updated = row;
    }
  });
  if (!updated) fail('not_found');
  return updated;
}

// Guest favourites and history already live in this browser, so a mock login keeps them as
// they are. Guest saves are merged into cloud saves by the saves repo.
function startSession(user: MockUser) {
  writeSessionId(user.id);
  updateUser(user.id, { lastActive: nowIso() });
  emitTopic('session', { local: true });
}

/** Owners (the list in .env.local) and, for tests and demos, any `admin@` address. */
const isOwner = (email: string) => email.startsWith('admin@') || OWNER_EMAILS.includes(email);

function findOrCreate(email: string): MockUser {
  const normalised = email.trim().toLowerCase();
  let user = readTable('users').find((u) => u.email === normalised);
  // An owner who signed up before being added to the owner list is promoted at the next sign-in.
  if (user && isOwner(normalised) && user.role !== 'admin') user = updateUser(user.id, { role: 'admin' });
  if (user) return user;
  user = {
    id: newId(),
    email: normalised,
    username: null,
    displayName: '',
    birthYear: null,
    isMinor: true,
    consent: 'pending',
    role: isOwner(normalised) ? 'admin' : 'player',
    brainPoints: 0,
    level: 1,
    streakDays: 0,
    streakLastDay: null,
    avatar: {},
    profilePublic: true,
    playtestOptIn: false,
    schoolSafe: false,
    lowData: false,
    locale: 'en',
    lastActive: null,
    bannedAt: null,
    createdAt: nowIso(),
  };
  const created = user;
  mutateTable('users', (rows) => {
    rows.push(created);
  });
  return created;
}

function base64url(value: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The owner code is checked by the local services process, never in the browser. */
async function ownerCall<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const user = requireUser();
  const base = `${PLAY_ORIGIN}/__mock/owner/${action}`;
  const res = await fetch(body ? base : `${base}?uid=${encodeURIComponent(user.id)}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'content-type': 'text/plain' } : undefined,
    body: body ? JSON.stringify({ uid: user.id, ...body }) : undefined,
  }).catch(() => null);
  if (!res) fail('unavailable', 'The local services are not running (npm run dev starts them).');
  if (res.status === 429) fail('rate_limited');
  if (!res.ok) fail('not_allowed');
  return (await res.json()) as T;
}

export const mockAuth: AuthRepo = {
  async ownerCodeStatus() {
    return ownerCall('status');
  },
  async ownerCodeEnroll() {
    return ownerCall('enroll', {});
  },
  async ownerCodeVerify(code) {
    const { ok } = await ownerCall<{ ok: boolean }>('verify', { code });
    return ok;
  },
  async ownerCodeLock() {
    await ownerCall('lock', {});
  },
  async session() {
    const user = currentMockUser();
    return user ? toSessionUser(user) : null;
  },
  async signInWithEmail(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fail('invalid', 'Enter a valid e-mail address.');
    if (!takeToken(`signin:${getAnonId()}`, 10, 600_000)) fail('rate_limited');
    startSession(findOrCreate(email));
    return { status: 'signed_in' };
  },
  async signInWithProvider(provider) {
    // Without the provider's keys there is no real Google or Apple identity to read, so the local
    // build signs in the e-mail typed in the form instead (see LoginForm). Never a throwaway account.
    void provider;
    fail('invalid', 'Type your e-mail address above, then use the e-mail button. Google and Apple need their keys set up (docs/DEPLOY.md).');
  },
  async signInWithGoogleIdToken(idToken) {
    // Google's button returned a signed ID token. The local build reads the e-mail from it (the
    // live site has Supabase verify the signature). Same Google account, same Brainstorming account.
    const part = idToken.split('.')[1] ?? '';
    let claims: { email?: string; email_verified?: boolean; name?: string; aud?: string; exp?: number };
    try {
      claims = JSON.parse(decodeURIComponent(escape(atob(part.replace(/-/g, '+').replace(/_/g, '/')))));
    } catch {
      fail('invalid', 'Google sign-in failed. Try again.');
    }
    if (!claims.email || claims.email_verified === false) fail('invalid', 'Your Google account has no verified e-mail address.');
    if (GOOGLE_CLIENT_ID && claims.aud !== GOOGLE_CLIENT_ID) fail('invalid', 'Google sign-in failed. Try again.');
    if (claims.exp && claims.exp * 1000 < Date.now()) fail('invalid', 'Google sign-in expired. Try again.');
    const user = findOrCreate(claims.email);
    if (!user.displayName && claims.name) updateUser(user.id, { displayName: claims.name.slice(0, 40) });
    startSession(readTable('users').find((u) => u.id === user.id)!);
  },
  async completeSignup(username, birthYear, locale) {
    const user = requireUser();
    if (user.username) fail('conflict');
    const name = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name)) fail('invalid', 'Usernames are 3 to 20 letters, numbers or underscores.');
    const year = new Date().getUTCFullYear();
    if (!Number.isInteger(birthYear) || birthYear < AGE_GATE.minBirthYear || birthYear > year) fail('invalid', 'Enter a valid birth year.');
    if (readTable('users').some((u) => u.username === name)) fail('conflict', 'That username is taken.');
    const minor = isMinorByBirthYear(birthYear);
    const updated = updateUser(user.id, {
      username: name,
      displayName: username.trim(),
      birthYear,
      isMinor: minor,
      consent: minor ? 'pending' : 'not_required',
      locale,
      // Everyone starts with the default look.
      avatar: { colour: 'classic', headphones: 'studio', glow: 'cyan' },
    });
    emitTopic('session', { local: true });
    sendMail(user.email, 'welcome_player', { name: name });
    return toSessionUser(updated);
  },
  async usernameAvailable(username) {
    const name = username.trim().toLowerCase();
    return /^[a-z0-9_]{3,20}$/.test(name) && !readTable('users').some((u) => u.username === name);
  },
  async signOut() {
    writeSessionId(null);
    emitTopic('session', { local: true });
  },
  async updateProfile(patch) {
    const user = requireUser();
    updateUser(user.id, {
      ...(patch.displayName != null ? { displayName: patch.displayName.slice(0, 40) } : {}),
      ...(patch.locale ? { locale: patch.locale } : {}),
      ...(patch.lowData != null ? { lowData: patch.lowData } : {}),
      ...(patch.schoolSafe != null ? { schoolSafe: patch.schoolSafe } : {}),
      ...(patch.profilePublic != null ? { profilePublic: patch.profilePublic } : {}),
      ...(patch.playtestOptIn != null ? { playtestOptIn: patch.playtestOptIn } : {}),
    });
    emitTopic('session', { local: true });
    emitTopic('profile');
  },
  async requestParentalConsent(parentEmail) {
    const user = requireProfile();
    if (!user.isMinor) fail('invalid');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim())) fail('invalid', 'Enter a valid e-mail address.');
    if (!takeToken(`consent:${user.id}`, 3, 3_600_000)) fail('rate_limited');
    const token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
    mutateTable('consents', (rows) => {
      const rest = rows.filter((c) => !(c.userId === user.id && c.status === 'pending'));
      rest.push({ token, userId: user.id, status: 'pending', requestedAt: nowIso(), expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() });
      return rest;
    });
    updateUser(user.id, { consent: 'pending' });
    // E-mailed to the parent. The local build also shows the link, so it can be tested without a mailbox.
    sendMail(parentEmail.trim(), 'parental_consent', { username: user.username, link: `${window.location.origin}/parents/consent/?token=${token}` });
    return { devLink: `/parents/consent/?token=${token}` };
  },
  async consentView(token) {
    const c = readTable('consents').find((x) => x.token === token);
    if (!c) return null;
    const user = readTable('users').find((u) => u.id === c.userId);
    return { username: user?.username ?? '', status: c.status, expired: c.expiresAt < nowIso() };
  },
  async consentResolve(token, approve) {
    if (!takeToken(`consent-resolve:${token.slice(0, 12)}`, 10, 600_000)) fail('rate_limited');
    const c = readTable('consents').find((x) => x.token === token);
    if (!c) fail('not_found');
    if (c.expiresAt < nowIso()) fail('invalid', 'This link has expired.');
    const status = approve ? 'granted' : 'denied';
    mutateTable('consents', (rows) => {
      const row = rows.find((x) => x.token === token);
      if (row) row.status = status;
    });
    updateUser(c.userId, { consent: status });
    emitTopic('session');
    return status;
  },
  async exportData() {
    const user = requireUser();
    const t = (name: Parameters<typeof readTable>[0]) => readTable(name) as unknown as Record<string, unknown>[];
    return {
      exportedAt: nowIso(),
      profile: user,
      favourites: guestFavourites.list(),
      history: guestHistory.list(),
      ratings: t('ratings').filter((r) => r.voterKey === `user:${user.id}`),
      cloudSaves: t('cloudSaves').filter((r) => r.userId === user.id),
      scores: t('scores').filter((r) => r.userId === user.id),
      notifications: t('notifications').filter((r) => r.userId === user.id),
    };
  },
  async deleteAccount() {
    const user = requireUser();
    if (readTable('studios').some((s) => s.ownerId === user.id)) fail('conflict', 'Close your studio first (contact support).');
    mutateTable('users', (rows) => rows.filter((u) => u.id !== user.id));
    mutateTable('cloudSaves', (rows) => rows.filter((r) => r.userId !== user.id));
    mutateTable('scores', (rows) => rows.filter((r) => r.userId !== user.id));
    mutateTable('notifications', (rows) => rows.filter((r) => r.userId !== user.id));
    mutateTable('consents', (rows) => rows.filter((r) => r.userId !== user.id));
    writeSessionId(null);
    emitTopic('session', { local: true });
  },
  async gameToken(gameId) {
    const user = currentMockUser();
    if (!user?.username) return null;
    // Mock tokens are unsigned (alg "none") and say so. Production tokens are ES256: see
    // supabase/functions/game-token and docs/SDK.md.
    const now = Math.floor(Date.now() / 1000);
    return `${base64url({ alg: 'none', typ: 'JWT', kid: 'mock' })}.${base64url({ sub: user.id, gameId, iat: now, exp: now + 3600, iss: 'brainstorming-games-mock' })}.`;
  },
};
