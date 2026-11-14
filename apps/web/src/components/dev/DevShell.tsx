'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, type ReactNode } from 'react';
import { Button, EmptyState, Skeleton } from '@brainstorming/ui';
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

  return <div className="page">{body}</div>;
}
