import { AGE_GATE } from '@/lib/config';
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

export function currentUserId(): string | null {
  return tabSession.get<string | null>(SESSION_KEY, null);
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
  tabSession.set(SESSION_KEY, user.id);
  updateUser(user.id, { lastActive: nowIso() });
  emitTopic('session', { local: true });
}

function findOrCreate(email: string): MockUser {
  const normalised = email.trim().toLowerCase();
  let user = readTable('users').find((u) => u.email === normalised);
  if (user) return user;
  user = {
    id: newId(),
    email: normalised,
    username: null,
    displayName: '',
    birthYear: null,
    isMinor: true,
    consent: 'pending',
    role: normalised.startsWith('admin@') ? 'admin' : 'player',
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

export const mockAuth: AuthRepo = {
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
    startSession(findOrCreate(`${provider}-player-${getAnonId().slice(0, 8)}@example.test`));
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
    return toSessionUser(updated);
  },
  async usernameAvailable(username) {
    const name = username.trim().toLowerCase();
    return /^[a-z0-9_]{3,20}$/.test(name) && !readTable('users').some((u) => u.username === name);
  },
  async signOut() {
    tabSession.remove(SESSION_KEY);
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
    // In production the parental-consent Edge Function e-mails this link. Mock mode shows it.
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
    tabSession.remove(SESSION_KEY);
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
