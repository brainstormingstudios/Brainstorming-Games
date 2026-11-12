'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Crown, Gamepad2, LogOut, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MascotAvatar,
  Skeleton,
  TextField,
  buttonClass,
  chipClass,
  cn,
  useToast,
} from '@brainstorming/ui';
import { GameCover } from '@/components/catalogue/GameCover';
import { localizePath } from '@/i18n/config';
import { Link, useLocale } from '@/i18n/navigation';
import { getRepo, RepoError } from '@/lib/data';
import type { PresenceInfo, SessionUser } from '@/lib/data/repo';
import { PARTY_EMOJI, PARTY_PHRASES } from '@/lib/domain/progression';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { RequireUser, SocialGate, useAction } from './common';

// ---------------------------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------------------------

function FriendsBody({ user }: { user: SessionUser }) {
  const t = useTranslations('friends');
  const toast = useToast();
  const act = useAction();
  const params = useSearchParams();
  const [name, setName] = useState('');
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});
  const friends = useRepoQuery((repo) => repo.social.friends(), [user.id], { topics: ['friends'] });
  const addFromLink = params.get('add');

  useEffect(() => {
    let off = () => {};
    void getRepo().then((repo) => {
      off = repo.social.watchPresence(setPresence);
    });
    return () => off();
  }, []);

  const send = async (username: string) => {
    try {
      const repo = await getRepo();
      const status = await repo.social.request(username);
      toast(status === 'accepted' ? t('accepted') : t('sent'), { tone: 'success' });
      setName('');
    } catch (err) {
      toast(err instanceof RepoError && err.code === 'not_found' ? t('notFound') : String((err as Error).message), { tone: 'error' });
    }
  };

  const link = typeof window !== 'undefined' ? `${window.location.origin}${localizePath(`/friends?add=${user.username}`, 'en')}` : '';
  const list = friends.data ?? [];
  const incoming = list.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const outgoing = list.filter((f) => f.status === 'pending' && f.direction === 'outgoing');
  const accepted = list.filter((f) => f.status === 'accepted');

  return (
    <div className="flex flex-col gap-6" data-testid="friends-page">
      <h1 className="text-3xl font-bold sm:text-4xl">{t('title')}</h1>
      {addFromLink && addFromLink !== user.username ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="font-bold">{t('addFromLink', { username: addFromLink })}</p>
          <Button icon={<UserPlus aria-hidden="true" className="size-4" />} onClick={() => void send(addFromLink)}>
            {t('send')}
          </Button>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-lg font-semibold">{t('add')}</h2>
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim()) void send(name.trim());
            }}
          >
            <TextField label={t('username')} hideLabel placeholder={t('username')} value={name} onChange={(e) => setName(e.target.value)} className="flex-1" data-testid="friend-username" />
            <Button type="submit" data-testid="friend-send">
              {t('send')}
            </Button>
          </form>
        </Card>
        <Card className="p-4">
          <h2 className="text-lg font-semibold">{t('inviteLink')}</h2>
          <p className="text-sm text-fg-muted">{t('inviteBody')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-control bg-surface-3 px-2 py-1.5 text-xs break-all">{link}</code>
            <Button size="sm" variant="outline" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast(t('copied')))}>
              {t('copyLink')}
            </Button>
          </div>
        </Card>
      </div>
      {incoming.length + outgoing.length > 0 ? (
        <section aria-labelledby="requests">
          <h2 id="requests" className="mb-2 text-xl font-semibold">
            {t('requests')}
          </h2>
          <ul className="flex flex-col gap-2">
            {[...incoming, ...outgoing].map((f) => (
              <li key={f.id}>
                <Card className="flex flex-wrap items-center gap-3 p-3" data-testid="friend-request">
                  <MascotAvatar size={40} cosmetics={f.avatar} />
                  <span className="font-bold">{f.displayName || f.username}</span>
                  <span className="text-sm text-fg-muted">@{f.username}</span>
                  <span className="ml-auto flex gap-2">
                    {f.direction === 'incoming' ? (
                      <>
                        <Button size="sm" onClick={() => void act(async () => (await getRepo()).social.respond(f.id, true), t('accepted'))} data-testid="friend-accept">
                          {t('accept')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void act(async () => (await getRepo()).social.respond(f.id, false))}>
                          {t('decline')}
                        </Button>
                      </>
                    ) : (
                      <Badge>{t('pending')}</Badge>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="friend-list">
        <h2 id="friend-list" className="mb-2 text-xl font-semibold">
          {t('list')}
        </h2>
        {friends.loading && !friends.data ? (
          <Skeleton className="h-32 w-full" />
        ) : accepted.length === 0 ? (
          <EmptyState title={t('empty')} size="sm" />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {accepted.map((f) => {
              const p = presence[f.id];
              const activity = p?.activity;
              return (
                <li key={f.id}>
                  <Card className="flex items-center gap-3 p-3" data-testid="friend" data-online={p?.online ? 'true' : 'false'}>
                    <span className="relative">
                      <MascotAvatar size={48} cosmetics={f.avatar} />
                      <span className={cn('absolute right-0 bottom-0 size-3.5 rounded-full border-2 border-surface', p?.online ? 'bg-success' : 'bg-navy-400')} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link href={`/u/${f.username}`} hard className="block truncate font-bold hover:underline">
                        {f.displayName || f.username}
                      </Link>
                      <span className="block truncate text-sm text-fg-muted" data-testid="friend-status">
                        {activity ? t('playing', { game: activity.gameTitle }) : p?.online ? t('online') : t('offline')}
                      </span>
                    </span>
                    {activity ? (
                      <Link
                        href={activity.partyCode ? `/party/${activity.partyCode}` : `/game/${activity.gameSlug}`}
                        hard
                        className={buttonClass({ size: 'sm' })}
                      >
                        {t('join')}
                      </Link>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => void act(async () => (await getRepo()).social.remove(f.id))}>
                      {t('remove')}
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function FriendsPage() {
  return <RequireUser>{(user) => <SocialGate user={user}><FriendsBody user={user} /></SocialGate>}</RequireUser>;
}

// ---------------------------------------------------------------------------------------------
// Party rooms
// ---------------------------------------------------------------------------------------------

/** /party: start a party or join one with a code. */
export function PartyStart() {
  const t = useTranslations('party');
  const locale = useLocale();
  const act = useAction();
  const [code, setCode] = useState('');
  const create = async () => {
    const party = await act(async () => (await getRepo()).party.create(null));
    // Party rooms are not pre-rendered pages: a full load lets the host serve them.
    if (party) window.location.assign(localizePath(`/party/${party.code}`, locale));
  };
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5" data-testid="party-start">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-fg-muted">{t('intro')}</p>
      </div>
      <Button size="lg" onClick={() => void create()} data-testid="party-create">
        {t('create')}
      </Button>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) window.location.assign(localizePath(`/party/${code.trim().toUpperCase()}`, locale));
        }}
      >
        <TextField label={t('joinCode')} hideLabel placeholder={t('joinCode')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} className="flex-1" />
        <Button type="submit" variant="secondary">
          {t('join')}
        </Button>
      </form>
    </div>
  );
}

/** Reads the party code from `/party/<code>/` (the page is a shared shell for every code). */
function usePathCode(): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const m = /\/party\/([A-Za-z0-9]{4,6})\/?$/.exec(window.location.pathname);
    setCode(m ? m[1]!.toUpperCase() : '');
  }, []);
  return code;
}

export function PartyRoom() {
  const t = useTranslations('party');
  const toast = useToast();
  const act = useAction();
  const locale = useLocale();
  const code = usePathCode();
  const [joined, setJoined] = useState(false);
  const party = useRepoQuery((repo) => (code ? repo.party.get(code) : Promise.resolve(null)), [code], {});
  const games = useRepoQuery((repo) => repo.catalogue.list({ sort: 'popular', limit: 24 }), [], { topics: ['catalogue'] });

  // Join on arrival, then follow every change.
  useEffect(() => {
    if (!code || joined || party.data === undefined) return;
    if (party.data === null) return;
    setJoined(true);
    void act(async () => (await getRepo()).party.join(code)).then(() => party.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join once per code
  }, [code, party.data, joined]);
  useEffect(() => {
    if (!code) return;
    let off = () => {};
    void getRepo().then((repo) => {
      off = repo.party.watch(code, () => party.refresh());
    });
    const poll = window.setInterval(() => party.refresh(), 5000);
    return () => {
      off();
      window.clearInterval(poll);
    };
  }, [code, party]);

  const p = party.data;
  const gameList = games.data?.items ?? [];
  const current = gameList.find((g) => g.id === p?.currentGameId) ?? null;

  // When the host starts, everyone goes to the game together.
  const [routed, setRouted] = useState(false);
  useEffect(() => {
    if (!p || routed || p.state !== 'playing' || !current) return;
    setRouted(true);
    window.location.assign(localizePath(`/game/${current.slug}?party=${p.code}`, locale));
  }, [p, current, routed, locale]);

  const voteCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of Object.values(p?.votes ?? {})) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [p?.votes]);

  if (code === null || (party.loading && party.data === undefined)) return <Skeleton className="h-96 w-full" />;
  if (!p) return <EmptyState title={t('notFound')} art="sad" action={<Link href="/party" className={buttonClass({})}>{t('create')}</Link>} />;
  const isHost = p.hostKey === p.meKey;
  const me = p.members.find((m) => m.key === p.meKey);
  const shareLink = `${window.location.origin}${localizePath(`/party/${p.code}`, locale)}`;

  return (
    <div className="flex flex-col gap-5" data-testid="party-room" data-code={p.code} data-state={p.state}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('room', { code: p.code })}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void navigator.clipboard.writeText(shareLink).then(() => toast(t('copied')))}>
            {t('copy')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut aria-hidden="true" className="size-4" />}
            onClick={() =>
              void act(async () => {
                await (await getRepo()).party.leave(p.code);
                window.location.assign(localizePath('/party', locale));
              })
            }
          >
            {t('leave')}
          </Button>
        </div>
      </div>
      <p className="text-sm text-fg-muted">
        {t('share')}: <code className="break-all">{shareLink}</code>
      </p>
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t('members', { count: p.members.length })}</h2>
            <ul className="flex flex-col gap-2" data-testid="party-members">
              {p.members.map((m) => (
                <li key={m.key} className="flex items-center gap-2">
                  <MascotAvatar size={36} cosmetics={m.cosmetics} />
                  <span className="font-bold">{m.name}</span>
                  {m.key === p.hostKey ? (
                    <Badge tone="glow">
                      <Crown aria-hidden="true" className="size-3" />
                      {t('host')}
                    </Badge>
                  ) : null}
                  {m.key === p.meKey ? <Badge>{t('you')}</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="font-semibold">{t('chat')}</h2>
            <ol className="my-2 flex max-h-48 flex-col gap-1 overflow-auto text-sm" aria-live="polite" data-testid="party-chat">
              {p.chat.map((c, i) => (
                <li key={i}>
                  <span className="font-bold">{c.name}:</span> {PARTY_EMOJI[c.phrase as keyof typeof PARTY_EMOJI] ?? ''} {t(`phrases.${c.phrase}` as 'phrases.hi')}
                </li>
              ))}
            </ol>
            {me?.canChat ? (
              <>
                <p className="mb-1 text-xs text-fg-muted">{t('chatHint')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {PARTY_PHRASES.map((phrase) => (
                    <button key={phrase} type="button" className={chipClass(false, 'h-8 text-xs')} onClick={() => void act(async () => (await getRepo()).party.act(p.code, 'chat', { phrase }))}>
                      {t(`phrases.${phrase}`)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-muted">{t('chatOff')}</p>
            )}
          </Card>
        </div>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t('pickGame')}</h2>
          {p.state === 'playing' && current ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-control bg-surface-3 p-3">
              <Gamepad2 aria-hidden="true" className="size-5 text-glow" />
              <span className="font-bold">{t('playing', { game: current.title })}</span>
              <Link href={`/game/${current.slug}?party=${p.code}`} hard className={buttonClass({ size: 'sm' })}>
                {t('openGame')}
              </Link>
              {isHost ? (
                <Button size="sm" variant="ghost" onClick={() => void act(async () => (await getRepo()).party.act(p.code, 'lobby'))}>
                  {t('backToLobby')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {gameList.length === 0 ? (
            <EmptyState title={t('noGames')} size="sm" />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="party-games">
              {gameList.map((g) => {
                const selected = g.id === p.currentGameId;
                return (
                  <li key={g.id}>
                    <Card className={cn('flex flex-col gap-2 p-2', selected && 'ring-2 ring-glow')} data-testid="party-game">
                      <span className="block aspect-video overflow-hidden rounded-control">
                        <GameCover game={g} sizes="200px" />
                      </span>
                      <span className="truncate text-sm font-bold">{g.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => void act(async () => (await getRepo()).party.act(p.code, 'vote', { gameId: g.id }))}>
                          {t('vote')}
                        </Button>
                        {voteCounts.get(g.id) ? <Badge>{t('votes', { count: voteCounts.get(g.id)! })}</Badge> : null}
                        {isHost ? (
                          <Button size="sm" variant={selected ? 'primary' : 'secondary'} onClick={() => void act(async () => (await getRepo()).party.act(p.code, 'set_game', { gameId: g.id }))} data-testid="party-select">
                            {selected ? t('selected') : t('select')}
                          </Button>
                        ) : null}
                      </span>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4">
            {isHost ? (
              <Button size="lg" disabled={!p.currentGameId} onClick={() => void act(async () => (await getRepo()).party.act(p.code, 'start', { gameId: p.currentGameId ?? undefined }))} data-testid="party-go">
                {t('start')}
              </Button>
            ) : (
              <p className="text-sm text-fg-muted">{t('waitingHost')}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** On a game page opened from a party: a strip linking back to the lobby. */
export function PartyBar() {
  const t = useTranslations('party');
  const params = useSearchParams();
  const code = params.get('party');
  if (!code || !/^[A-Za-z0-9]{4,6}$/.test(code)) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-card border border-glow/50 bg-surface px-4 py-2 text-sm" data-testid="party-bar">
      <span className="font-bold">{t('inParty', { code: code.toUpperCase() })}</span>
      <Link href={`/party/${code.toUpperCase()}`} hard className="font-bold text-link underline">
        {t('backToLobby')}
      </Link>
    </div>
  );
}
