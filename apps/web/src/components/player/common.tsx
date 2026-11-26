'use client';

import { useTranslations } from 'next-intl';
import { Bell, Brain, Gem, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, EmptyState, Skeleton, TextField, cn, useToast } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo, RepoError } from '@/lib/data';
import type { SessionUser } from '@/lib/data/repo';
import { isRestricted } from '@/lib/domain/ageGate';
import { PLAN_LABEL, activePlan } from '@/lib/domain/premium';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { usePrefs } from '@/lib/prefs';

/** Shared error-to-toast helper for player actions. */
export function useAction() {
  const tc = useTranslations('common');
  const toast = useToast();
  return async <T,>(fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
    try {
      const result = await fn();
      if (done) toast(done, { tone: 'success' });
      return result;
    } catch (err) {
      toast(
        err instanceof RepoError
          ? err.code === 'rate_limited'
            ? tc('rateLimited')
            : err.message !== err.code
              ? err.message
              : tc('errorBody')
          : tc('errorBody'),
        { tone: 'error' },
      );
      return undefined;
    }
  };
}

/** Header: Brain Points balance, friends and notifications for signed-in players. */
export function HeaderChips() {
  const t = useTranslations('player');
  const { user } = useSession();
  const { schoolSafe } = usePrefs();
  const notes = useRepoQuery((repo) => (user?.username ? repo.notifications.list() : Promise.resolve([])), [user?.id], {
    topics: ['notifications', 'session'],
  });
  if (!user?.username) return null;
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const plan = activePlan(user.premium);
  const chip = 'flex h-11 items-center gap-1.5 rounded-control px-2.5 text-sm font-extrabold hover:bg-surface-2';
  return (
    <div className="flex items-center gap-0.5">
      <Link
        href="/premium"
        data-testid="premium-chip"
        className={cn(chip, 'hidden lg:flex', plan ? 'text-primary' : 'text-fg-muted hover:text-fg')}
        title={plan ? t('premiumMember', { plan: PLAN_LABEL[plan] }) : t('goPremium')}
      >
        <Gem aria-hidden="true" className="size-5" />
        <span>{plan ? PLAN_LABEL[plan] : t('premiumShort')}</span>
      </Link>
      <Link href="/quests" className={cn(chip, 'text-glow')} title={t('points', { count: user.brainPoints })} data-testid="points-chip">
        <Brain aria-hidden="true" className="size-5" />
        <span className="hidden sm:inline">{t('pointsShort', { count: user.brainPoints })}</span>
        <span className="sr-only">{t('points', { count: user.brainPoints })}</span>
      </Link>
      {!schoolSafe ? (
        <Link href="/friends" className={cn(chip, 'hidden md:flex')} aria-label={t('friends')} title={t('friends')}>
          <Users aria-hidden="true" className="size-5" />
        </Link>
      ) : null}
      <Link href="/notifications" className={cn(chip, 'relative')} aria-label={`${t('notifications')}${unread ? ` (${t('unread', { count: unread })})` : ''}`} data-testid="notifications-bell">
        <Bell aria-hidden="true" className="size-5" />
        {unread ? (
          <span className="absolute top-1.5 right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.65rem] text-navy-950">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </Link>
    </div>
  );
}

/** Needs a signed-in player with a profile. Renders the login prompt otherwise. */
export function RequireUser({ children }: { children: (user: SessionUser) => ReactNode }) {
  const t = useTranslations('player');
  const ta = useTranslations('auth');
  const { user, ready } = useSession();
  if (!ready) return <Skeleton className="h-64 w-full" />;
  if (!user?.username)
    return (
      <EmptyState
        title={t('loginToUse')}
        description={t('loginToUseBody')}
        action={
          <Button onClick={() => void requestLogin()} data-testid="require-login">
            {ta('logIn')}
          </Button>
        }
      />
    );
  return <>{children(user)}</>;
}

/** Social features: off in school-safe mode and for minors until a parent approves. */
export function SocialGate({ user, children }: { user: SessionUser; children: ReactNode }) {
  const t = useTranslations('player');
  const ta = useTranslations('auth');
  const { schoolSafe } = usePrefs();
  const act = useAction();
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  if (schoolSafe) return <EmptyState title={t('schoolSafeOff')} size="sm" />;
  if (!isRestricted(user)) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 rounded-card border border-border bg-surface p-5" data-testid="restricted-notice">
      <h2 className="text-xl font-semibold">{t('restrictedTitle')}</h2>
      <p className="text-sm text-fg-muted">{t('restrictedBody')}</p>
      <TextField label={ta('parentEmailLabel')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button
        className="self-start"
        onClick={() =>
          void act(async () => {
            const repo = await getRepo();
            const r = await repo.auth.requestParentalConsent(email);
            setLink(r.devLink ?? null);
          }, ta('consentSent'))
        }
      >
        {t('sendApproval')}
      </Button>
      {link ? (
        <p className="text-sm">
          {ta('consentDevLink')}{' '}
          <a href={link} className="font-bold text-link underline" data-testid="consent-dev-link">
            {link}
          </a>
        </p>
      ) : null}
    </div>
  );
}
