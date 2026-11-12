'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, type ReactNode } from 'react';
import { Button, EmptyState, Skeleton, cn } from '@brainstorming/ui';
import { splitLocale } from '@/i18n/config';
import { Link } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import type { DevStudio } from '@/lib/data/devTypes';
import type { SessionUser } from '@/lib/data/repo';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { StudioSignup } from './StudioSignup';

interface DevContextValue {
  user: SessionUser;
  studio: DevStudio;
}

const DevContext = createContext<DevContextValue | null>(null);

export function useDev(): DevContextValue {
  const ctx = useContext(DevContext);
  if (!ctx) throw new Error('useDev outside DevShell');
  return ctx;
}

const NAV = [
  { key: 'dashboard', href: '/dev' },
  { key: 'newGame', href: '/dev/games/new' },
  { key: 'feedback', href: '/dev/feedback' },
  { key: 'devlogs', href: '/dev/devlogs' },
  { key: 'studio', href: '/dev/studio' },
  { key: 'docs', href: '/dev/docs/quick-start' },
] as const;

export function DevNav() {
  const t = useTranslations('dev.nav');
  const { path } = splitLocale(usePathname() ?? '/');
  const clean = path.replace(/\/+$/, '') || '/';
  return (
    <nav aria-label={t('label')} className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1">
      {NAV.map((item) => {
        const active = item.href === '/dev' ? clean === '/dev' : clean.startsWith(item.href.replace(/\/quick-start$/, ''));
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-2 text-sm font-bold whitespace-nowrap',
              active ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Gate for the developer portal: a signed-in player with a complete profile and a studio.
 * Pages that work without a studio (docs) render outside it.
 */
export function DevShell({ children }: { children: ReactNode }) {
  const ta = useTranslations('auth');
  const { user, ready } = useSession();
  const studio = useRepoQuery((repo) => (user?.username ? repo.dev.myStudio() : Promise.resolve(null)), [user?.id, user?.username], {
    topics: ['studio'],
  });

  let body: ReactNode;
  if (!ready || (user?.username && studio.data === undefined)) {
    body = <Skeleton className="h-64 w-full" />;
  } else if (!user) {
    body = (
      <EmptyState
        title={ta('loginRequiredTitle')}
        description={ta('loginRequiredBody')}
        action={
          <Button onClick={() => void requestLogin()} data-testid="dev-login">
            {ta('logIn')}
          </Button>
        }
      />
    );
  } else if (!user.username) {
    // Signed in but no player name yet: finish in the login dialog (one form on screen).
    body = (
      <EmptyState
        title={ta('signupTitle')}
        description={ta('signupIntro')}
        action={<Button onClick={() => void requestLogin()}>{ta('create')}</Button>}
      />
    );
  } else if (!studio.data) {
    body = <StudioSignup user={user} onCreated={() => studio.refresh()} />;
  } else {
    body = <DevContext.Provider value={{ user, studio: studio.data }}>{children}</DevContext.Provider>;
  }

  return (
    <div className="page" data-testid="dev-portal">
      <DevNav />
      {body}
    </div>
  );
}
