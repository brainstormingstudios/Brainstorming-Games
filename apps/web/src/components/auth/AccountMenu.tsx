'use client';

import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, MascotAvatar, useToast } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { onLoginRequest, requestLogin, settleLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import { isStaff, useSession } from '@/lib/hooks/useSession';
import { LoginForm } from './LoginForm';

/** The login dialog. Anything can open it with `requestLogin()` (including games, via the SDK). */
export function LoginDialog() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  useEffect(() => onLoginRequest(setOpen), []);
  return (
    <Dialog
      open={open}
      onClose={() => settleLogin(null)}
      title={t('title')}
      description={t('intro')}
      closeLabel={tc('close')}
    >
      {open ? (
        <LoginForm
          initialUser={user}
          next={typeof window !== 'undefined' ? window.location.pathname : '/'}
          onDone={(u) => {
            toast(t('welcome', { name: u.displayName || u.username || '' }), { tone: 'success' });
            settleLogin(u);
          }}
        />
      ) : null}
    </Dialog>
  );
}

/** Header account control: "Log in" for guests, an avatar menu for players. */
export function AccountMenu() {
  const t = useTranslations('auth');
  const tp = useTranslations('player');
  const tparty = useTranslations('party');
  const { user, ready } = useSession();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!ready) return <span className="size-11 shrink-0" aria-hidden="true" />;
  if (!user || !user.username) {
    return (
      <Button
        size="md"
        variant="secondary"
        onClick={() => void requestLogin()}
        icon={<LogIn aria-hidden="true" className="size-4" />}
        data-testid="login-button"
        className="shrink-0 px-3"
      >
        <span className="hidden md:inline">{t('logIn')}</span>
      </Button>
    );
  }
  const name = user.displayName || user.username;
  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account')}
        onClick={() => setOpen((v) => !v)}
        data-testid="account-button"
        className="flex size-11 items-center justify-center rounded-full border border-border bg-surface-3"
      >
        <MascotAvatar size={34} cosmetics={user.avatar} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 animate-pop-in rounded-card border border-border bg-surface-3 p-1.5 shadow-card"
        >
          <p className="truncate px-3 py-2 text-xs text-fg-muted">{t('signedInAs', { name })}</p>
          {(
            [
              [`/u/${user.username}`, tp('profile'), true],
              ['/locker', tp('locker'), false],
              ['/friends', tp('friends'), false],
              ['/party', tparty('title'), false],
              ['/settings', tp('settings'), false],
              ['/dev', t('devPortal'), false],
            ] as const
          ).map(([href, label, hard]) => (
            <Link key={href} role="menuitem" href={href} hard={hard} className="block rounded-control px-3 py-2 text-sm font-bold hover:bg-surface-2" onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          {isStaff(user) ? (
            <Link role="menuitem" href="/admin" className="block rounded-control px-3 py-2 text-sm font-bold hover:bg-surface-2" onClick={() => setOpen(false)} data-testid="admin-link">
              {t('adminConsole')}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-control px-3 py-2 text-left text-sm font-bold hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              void getRepo().then((repo) => repo.auth.signOut());
            }}
            data-testid="logout-button"
          >
            {t('logOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
