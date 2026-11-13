'use client';

import { useTranslations } from 'next-intl';
import { Award, Download, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MascotAvatar,
  SelectField,
  Skeleton,
  Switch,
  Tabs,
  TextField,
  buttonClass,
  chipClass,
  cn,
} from '@brainstorming/ui';
import { GameTile } from '@/components/catalogue/GameTile';
import { localizePath } from '@/i18n/config';
import { Link, useLocale } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { getPrefs, hashPin, setPrefs, usePrefs } from '@/lib/prefs';
import { RequireUser, useAction } from './common';

// ---------------------------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------------------------

function PointsBoard() {
  const t = useTranslations('leaderboards');
  const [period, setPeriod] = useState<'week' | 'all'>('week');
  const [friends, setFriends] = useState(false);
  const { user } = useSession();
  const board = useRepoQuery((repo) => repo.leaderboards.points(period, friends), [period, friends, user?.id], { topics: ['points'] });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(['week', 'all'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={period === p} className={chipClass(period === p)} onClick={() => setPeriod(p)}>
            {t(p)}
          </button>
        ))}
        {user?.username ? (
          <button type="button" aria-pressed={friends} className={chipClass(friends)} onClick={() => setFriends((f) => !f)}>
            {t('friendsOnly')}
          </button>
        ) : null}
      </div>
      <RankTable rows={(board.data?.entries ?? []).map((e) => ({ ...e, value: e.points }))} me={board.data?.me ? { ...board.data.me, value: board.data.me.points } : null} valueLabel={t('points')} loading={board.loading && !board.data} />
    </div>
  );
}

interface RankRow {
  rank: number;
  name: string;
  value: number;
  isMe: boolean;
  cosmetics?: Record<string, string>;
}

function RankTable({ rows, me, valueLabel, loading }: { rows: RankRow[]; me: RankRow | null; valueLabel: string; loading?: boolean }) {
  const t = useTranslations('leaderboards');
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (rows.length === 0) return <EmptyState title={t('empty')} size="sm" />;
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <table className="w-full text-sm" data-testid="rank-table">
        <thead className="bg-surface-3 text-left">
          <tr>
            <th scope="col" className="w-16 px-3 py-2">{t('rank')}</th>
            <th scope="col" className="px-3 py-2">{t('player')}</th>
            <th scope="col" className="px-3 py-2 text-right">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.rank}-${r.name}`} className={cn('border-t border-border', r.isMe && 'bg-surface-2 font-bold')}>
              <td className="px-3 py-2 font-display">#{r.rank}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <MascotAvatar size={28} cosmetics={r.cosmetics} />
                  {r.name} {r.isMe ? <Badge>{t('you')}</Badge> : null}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-display">{r.value.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {me && !rows.some((r) => r.isMe) ? <p className="border-t border-border px-3 py-2 text-sm font-bold">{t('yourRank', { rank: me.rank })}</p> : null}
    </div>
  );
}

function GameBoards() {
  const t = useTranslations('leaderboards');
  const games = useRepoQuery((repo) => repo.catalogue.list({ sort: 'popular', limit: 100 }), [], { topics: ['catalogue'] });
  const [gameId, setGameId] = useState('');
  const [board, setBoard] = useState('');
  const [period, setPeriod] = useState<'week' | 'all'>('all');
  const boards = useRepoQuery((repo) => (gameId ? repo.leaderboards.boards(gameId) : Promise.resolve([])), [gameId]);
  useEffect(() => setBoard(boards.data?.[0] ?? ''), [boards.data]);
  const top = useRepoQuery((repo) => (gameId && board ? repo.scores.top(gameId, board, { limit: 50, friends: false, period }) : Promise.resolve(null)), [gameId, board, period], { topics: ['leaderboards'] });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label={t('pickGame')} placeholder="…" value={gameId} onChange={(e) => setGameId(e.target.value)} options={(games.data?.items ?? []).map((g) => ({ value: g.id, label: g.title }))} />
        {gameId && (boards.data ?? []).length > 0 ? (
          <SelectField label={t('board')} value={board} onChange={(e) => setBoard(e.target.value)} options={(boards.data ?? []).map((b) => ({ value: b, label: b }))} />
        ) : null}
        <div className="flex items-end gap-2">
          {(['week', 'all'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} className={chipClass(period === p)} onClick={() => setPeriod(p)}>
              {t(p)}
            </button>
          ))}
        </div>
      </div>
      {gameId && (boards.data ?? []).length === 0 && !boards.loading ? <EmptyState title={t('noBoards')} size="sm" /> : null}
      {top.data ? <RankTable rows={top.data.entries.map((e) => ({ ...e, value: e.score }))} me={top.data.me ? { ...top.data.me, value: top.data.me.score } : null} valueLabel={t('score')} /> : null}
    </div>
  );
}

export function LeaderboardsPage() {
  const t = useTranslations('leaderboards');
  const [tab, setTab] = useState('global');
  return (
    <div className="flex flex-col gap-4" data-testid="leaderboards-page">
      <h1 className="text-3xl font-bold sm:text-4xl">{t('title')}</h1>
      <Tabs
        label={t('title')}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'global', label: t('global'), content: <PointsBoard /> },
          { id: 'game', label: t('game'), content: <GameBoards /> },
        ]}
      />
    </div>
  );
}

/** Game page: top 10 of the game's first board, your rank, and quests you can progress here. */
export function GameLeaderboard({ gameId, category }: { gameId: string; category: string }) {
  const t = useTranslations('leaderboards');
  const locale = useLocale();
  const boards = useRepoQuery((repo) => repo.leaderboards.boards(gameId), [gameId], { topics: ['leaderboards'] });
  const key = boards.data?.[0];
  const top = useRepoQuery((repo) => (key ? repo.scores.top(gameId, key, { limit: 10, friends: false, period: 'all' }) : Promise.resolve(null)), [gameId, key], { topics: ['leaderboards'] });
  const quests = useRepoQuery((repo) => repo.quests.mine(locale), [locale], { topics: ['quests'] });
  const relevant = (quests.data?.quests ?? []).filter((q) => !q.completed && (q.category == null || q.category === category)).slice(0, 4);
  if (!key && relevant.length === 0) return null;
  return (
    <section className="mt-7 grid gap-4 lg:grid-cols-2" data-testid="game-leaderboard">
      {key && top.data ? (
        <div>
          <h2 className="mb-2 text-xl font-semibold">{t('gameTop')}</h2>
          <RankTable rows={top.data.entries.map((e) => ({ ...e, value: e.score }))} me={top.data.me ? { ...top.data.me, value: top.data.me.score } : null} valueLabel={t('score')} />
        </div>
      ) : null}
      {relevant.length ? (
        <div>
          <h2 className="mb-2 text-xl font-semibold">{t('questsHere')}</h2>
          <ul className="flex flex-col gap-2">
            {relevant.map((q) => (
              <li key={q.code} className="rounded-control border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-bold">{q.title}</span> · {q.progress}/{q.target} · <span className="text-glow">+{q.reward} BP</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------------------------------

export function ProfilePage() {
  const t = useTranslations('profile');
  const tp = useTranslations('player');
  const tf = useTranslations('friends');
  const locale = useLocale();
  const act = useAction();
  const { user } = useSession();
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    const m = /\/u\/([a-z0-9_]{3,20})\/?$/i.exec(window.location.pathname);
    setUsername(m ? m[1]!.toLowerCase() : '');
  }, []);
  const profile = useRepoQuery((repo) => (username ? repo.profiles.get(username) : Promise.resolve(null)), [username], { topics: ['profile', 'points'] });
  if (username === null || (profile.loading && profile.data === undefined)) return <Skeleton className="h-96 w-full" />;
  const p = profile.data;
  if (!p) return <EmptyState title={t('notFound')} art="sad" />;
  const isMe = user?.id === p.id;
  return (
    <div className="flex flex-col gap-6" data-testid="profile-page">
      <Card className="flex flex-wrap items-center gap-5 p-5">
        <MascotAvatar size={128} cosmetics={p.avatar} animated label={p.displayName || p.username} />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold">{p.displayName || p.username}</h1>
          <p className="text-fg-muted">@{p.username} · {t('joined', { date: formatDate(p.createdAt, locale) })}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="glow">{tp('level', { level: p.level })}</Badge>
            <Badge>{tp('points', { count: p.brainPoints })}</Badge>
            <Badge tone="warning">{tp('streak', { count: p.streakDays })}</Badge>
          </div>
        </div>
        {isMe ? (
          <div className="flex gap-2">
            <Link href="/locker" className={buttonClass({ variant: 'secondary', size: 'sm' })}>{tp('locker')}</Link>
            <Link href="/settings" className={buttonClass({ variant: 'outline', size: 'sm' })}>{tp('settings')}</Link>
          </div>
        ) : user?.username ? (
          <Button size="sm" onClick={() => void act(async () => (await getRepo()).social.request(p.username), tf('sent'))}>
            {t('addFriend')}
          </Button>
        ) : null}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-lg font-semibold">{t('stats')}</h2>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              [t('gamesPlayed'), p.stats.gamesPlayed],
              [t('minutesPlayed'), p.stats.minutesPlayed],
              [t('questsCompleted'), p.stats.questsCompleted],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dd className="font-display text-2xl font-bold">{value}</dd>
                <dt className="text-xs text-fg-muted">{label}</dt>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-lg font-semibold">{t('badges')}</h2>
          {p.badges.length ? (
            <ul className="flex flex-wrap gap-2">
              {p.badges.map((b) => (
                <li key={b}>
                  <Badge tone="glow">
                    <Award aria-hidden="true" className="size-3.5" />
                    {t(`badgeNames.${b}` as 'badgeNames.explorer')}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">{t('noBadges')}</p>
          )}
        </Card>
      </div>
      {[
        ['favourites', p.favourites],
        ['recent', p.recent],
      ].map(([key, games]) =>
        (games as typeof p.favourites).length ? (
          <section key={key as string}>
            <h2 className="mb-2 text-xl font-semibold">{t(key as 'favourites')}</h2>
            <ul className="game-grid">
              {(games as typeof p.favourites).map((g) => (
                <li key={g.id}>
                  <GameTile game={g} />
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export function SettingsPage() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const act = useAction();
  const prefs = usePrefs();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');

  const toggleSchoolSafe = async (userSync: boolean) => {
    setPinError(null);
    if (!/^\d{4,8}$/.test(pin)) return setPinError(t('pinNeeded'));
    const hash = await hashPin(pin);
    if (prefs.schoolSafe) {
      if (hash !== getPrefs().schoolSafePinHash) return setPinError(t('pinWrong'));
      setPrefs({ schoolSafe: false, schoolSafePinHash: null });
    } else {
      setPrefs({ schoolSafe: true, schoolSafePinHash: hash });
    }
    setPin('');
    if (userSync) void act(async () => (await getRepo()).auth.updateProfile({ schoolSafe: !prefs.schoolSafe }));
  };

  const deviceSettings = (signedIn: boolean) => (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold">{t('device')}</h2>
      <Switch label={t('lowData')} description={t('lowDataBody')} checked={prefs.lowData} onChange={(e) => setPrefs({ lowData: e.target.checked })} />
      <div className="flex flex-col gap-2" data-testid="school-safe">
        <p className="font-bold">{t('schoolSafe')} <Badge tone={prefs.schoolSafe ? 'success' : 'neutral'}>{prefs.schoolSafe ? 'ON' : 'OFF'}</Badge></p>
        <p className="text-sm text-fg-muted">{t('schoolSafeBody')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <TextField label={t('pin')} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} error={pinError} data-testid="school-safe-pin" />
          <Button variant="secondary" onClick={() => void toggleSchoolSafe(signedIn)} data-testid="school-safe-toggle">
            {prefs.schoolSafe ? t('turnOff') : t('turnOn')}
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="settings-page">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      {deviceSettings(false)}
      <RequireUser>
        {(user) => (
          <>
            <AccountSettings user={user} />
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-lg font-semibold">{t('data')}</h2>
              <Button
                variant="outline"
                className="self-start"
                icon={<Download aria-hidden="true" className="size-4" />}
                onClick={() =>
                  void act(async () => {
                    const data = await (await getRepo()).auth.exportData();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
                    a.download = `brainstorming-games-${user.username}.json`;
                    a.click();
                  })
                }
              >
                {t('export')}
              </Button>
              <p className="text-sm text-fg-muted">{t('deleteConfirm')}</p>
              <div className="flex flex-wrap items-end gap-2">
                <TextField label={t('deleteType')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button
                  variant="danger"
                  disabled={confirm !== 'DELETE'}
                  icon={<Trash2 aria-hidden="true" className="size-4" />}
                  onClick={() =>
                    void act(async () => {
                      await (await getRepo()).auth.deleteAccount();
                      window.location.assign(localizePath('/', locale));
                    }, t('deleted'))
                  }
                >
                  {t('delete')}
                </Button>
              </div>
            </Card>
            <Button variant="ghost" className="self-start" onClick={() => void getRepo().then((r) => r.auth.signOut())}>
              {t('logOut')}
            </Button>
          </>
        )}
      </RequireUser>
    </div>
  );
}

function AccountSettings({ user }: { user: NonNullable<ReturnType<typeof useSession>['user']> }) {
  const t = useTranslations('settings');
  const act = useAction();
  const [name, setName] = useState(user.displayName);
  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold">{t('account')}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={t('displayName')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Button onClick={() => void act(async () => (await getRepo()).auth.updateProfile({ displayName: name }), t('saved'))}>{t('save')}</Button>
      </div>
      <h2 className="text-lg font-semibold">{t('privacy')}</h2>
      {/* Read `checked` before any await: React resets a controlled checkbox once the handler returns. */}
      <Switch
        label={t('publicProfile')}
        description={t('publicProfileBody')}
        checked={user.profilePublic}
        onChange={(e) => {
          const profilePublic = e.target.checked;
          void act(async () => (await getRepo()).auth.updateProfile({ profilePublic }));
        }}
        data-testid="public-profile"
      />
      <Switch
        label={t('playtest')}
        description={t('playtestBody')}
        checked={user.playtestOptIn}
        onChange={(e) => {
          const playtestOptIn = e.target.checked;
          void act(async () => (await getRepo()).auth.updateProfile({ playtestOptIn }));
        }}
        data-testid="playtest-optin"
      />
      {user.isMinor ? (
        <p className="text-sm">
          <span className="font-bold">{t('consentTitle')}:</span> {t(`consentStatus.${user.consent}`)}
        </p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

export function NotificationsPage() {
  return <RequireUser>{() => <NotificationsList />}</RequireUser>;
}

function NotificationsList() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const { data, loading } = useRepoQuery((repo) => repo.notifications.list(), [], { topics: ['notifications'] });
  useEffect(() => {
    if (data?.some((n) => !n.read)) {
      const id = window.setTimeout(() => void getRepo().then((r) => r.notifications.markRead()), 1500);
      return () => window.clearTimeout(id);
    }
  }, [data]);
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3" data-testid="notifications-page">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <Button variant="ghost" size="sm" onClick={() => void getRepo().then((r) => r.notifications.markRead())}>
          {t('markAll')}
        </Button>
      </div>
      {(data ?? []).length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        <ul className="flex flex-col gap-2">
          {(data ?? []).map((n) => (
            <li key={n.id}>
              <Card className={cn('p-3', !n.read && 'border-glow/60')}>
                {n.link ? (
                  <a href={localizePath(n.link, locale as 'en')} className="font-bold hover:underline">
                    {n.title}
                  </a>
                ) : (
                  <p className="font-bold">{n.title}</p>
                )}
                {n.body ? <p className="text-sm text-fg-muted">{n.body}</p> : null}
                <p className="text-xs text-fg-muted">{formatDate(n.createdAt, locale)}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
