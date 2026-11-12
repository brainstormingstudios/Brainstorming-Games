'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Mascot, Skeleton } from '@brainstorming/ui';
import { localizePath } from '@/i18n/config';
import { useLocale } from '@/i18n/navigation';
import { getRepo, RepoError } from '@/lib/data';
import type { ConsentStatus } from '@/lib/data/repo';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { LoginForm } from './LoginForm';

/** Only same-site paths are allowed as a post-login destination. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user, ready } = useSession();

  useEffect(() => {
    if (ready && user?.username) router.replace(next.startsWith(`/${locale}/`) || locale === 'en' ? next : localizePath(next, locale));
  }, [ready, user, next, router, locale]);

  if (!ready) return <Skeleton className="mx-auto h-80 max-w-md" />;
  return (
    <Card className="mx-auto flex max-w-md flex-col gap-4 p-5 sm:p-7" data-testid="login-page">
      <div className="flex flex-col items-center gap-2 text-center">
        <Mascot size={88} priority />
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <LoginForm initialUser={user} next={next} onDone={() => router.replace(next)} />
    </Card>
  );
}

/** The page a parent opens from the approval e-mail. */
export function ConsentPage() {
  const t = useTranslations('consent');
  const tc = useTranslations('common');
  const token = useSearchParams().get('token') ?? '';
  const view = useRepoQuery((repo) => repo.auth.consentView(token), [token]);
  const [result, setResult] = useState<ConsentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      setResult(await repo.auth.consentResolve(token, approve));
    } catch (err) {
      setError(err instanceof RepoError && err.code === 'invalid' ? t('expired') : tc('errorBody'));
    } finally {
      setBusy(false);
    }
  };

  if (view.loading && view.data === undefined) return <Skeleton className="mx-auto h-64 max-w-lg" />;
  const v = view.data;
  if (!v) return <EmptyState title={t('notFound')} art="sad" />;
  if (v.expired) return <EmptyState title={t('expired')} art="sad" />;
  const status = result ?? v.status;
  return (
    <Card className="mx-auto flex max-w-lg flex-col gap-4 p-6" data-testid="consent-page">
      <h1 className="text-2xl font-bold">{t('title', { username: v.username })}</h1>
      <p className="text-sm">{t('body', { username: v.username })}</p>
      <a href={localizePath('/parents', 'en')} className="text-sm font-bold text-link underline">
        {t('privacy')}
      </a>
      {status === 'granted' ? (
        <p role="status" className="font-bold text-success" data-testid="consent-result">
          {t('approved')}
        </p>
      ) : status === 'denied' ? (
        <p role="status" className="font-bold" data-testid="consent-result">
          {t('declined')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={() => void resolve(true)} data-testid="consent-approve">
            {t('approve')}
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => void resolve(false)} data-testid="consent-decline">
            {t('decline')}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
