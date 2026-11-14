'use client';

import { SocialSignIn } from './SocialSignIn';
import { useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Mascot, TextField } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { AGE_GATE, MASCOT_NAME } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import type { SessionUser } from '@/lib/data/repo';

export interface LoginFormProps {
  /** Called once the player is signed in with a complete profile. */
  onDone: (user: SessionUser) => void;
  /** Where the magic link returns to. */
  next?: string;
  /** The current session, when the form opens for a signed-in player with no profile yet. */
  initialUser?: SessionUser | null;
}

type Step = 'start' | 'inbox' | 'profile' | 'consent';

const errorText = (err: unknown, fallback: string) =>
  err instanceof RepoError && err.message && err.message !== err.code ? err.message : fallback;

/** E-mail, Google or Apple, then username and birth year, then parental consent. */
export function LoginForm({ onDone, next, initialUser }: LoginFormProps) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [step, setStep] = useState<Step>(initialUser && !initialUser.username ? 'profile' : 'start');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [user, setUser] = useState<SessionUser | null>(initialUser ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [consentSent, setConsentSent] = useState(false);

  const afterSignIn = async () => {
    const repo = await getRepo();
    const session = await repo.auth.session();
    setUser(session);
    if (session?.username) onDone(session);
    else setStep('profile');
  };

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('invalidEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      const result = await repo.auth.signInWithEmail(email.trim(), next);
      if (result.status === 'code_sent') {
        setDevCode(result.devCode ?? null);
        setCode('');
        setStep('inbox');
      } else await afterSignIn();
    } catch (err) {
      setError(errorText(err, tc('errorBody')));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      await repo.auth.verifyEmailCode(email.trim(), code);
      await afterSignIn();
    } catch (err) {
      setError(errorText(err, t('codeWrong')));
    } finally {
      setBusy(false);
    }
  };

  const submitProfile = async (e: FormEvent) => {
    e.preventDefault();
    const year = Number(birthYear);
    const now = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < AGE_GATE.minBirthYear || year > now) {
      setError(t('invalidYear'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      const created = await repo.auth.completeSignup(username, year, locale);
      setUser(created);
      if (created.isMinor && created.consent !== 'granted') setStep('consent');
      else onDone(created);
    } catch (err) {
      setError(err instanceof RepoError && err.code === 'conflict' ? t('usernameTaken') : errorText(err, tc('errorBody')));
    } finally {
      setBusy(false);
    }
  };

  const submitConsent = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      const result = await repo.auth.requestParentalConsent(parentEmail.trim());
      setConsentSent(true);
      setDevLink(result.devLink ?? null);
    } catch (err) {
      setError(errorText(err, t('invalidEmail')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="login-form">
      {step === 'start' ? (
        <>
          <form onSubmit={submitEmail} className="flex flex-col gap-3" noValidate>
            <TextField
              label={t('emailLabel')}
              type="email"
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              data-testid="login-email"
              required
            />
            <Button type="submit" size="lg" loading={busy} icon={<Mail aria-hidden="true" className="size-5" />} data-testid="login-submit">
              {t('continueEmail')}
            </Button>
          </form>
          <p className="text-center text-sm text-fg-muted">{t('or')}</p>
          <SocialSignIn
            next={next}
            disabled={busy}
            onSignedIn={() => void afterSignIn()}
            onError={(message) => setError(message)}
          />
        </>
      ) : null}

      {step === 'inbox' ? (
        <form onSubmit={submitCode} className="flex flex-col gap-3" noValidate data-testid="code-step">
          <div className="flex items-center gap-3">
            <Mascot size={64} />
            <div>
              <h3 className="text-lg font-semibold">{t('checkInbox')}</h3>
              <p className="text-sm text-fg-muted">{t('checkInboxBody', { email })}</p>
            </div>
          </div>
          {devCode ? (
            <p className="rounded-control border border-warning/70 bg-surface-3 px-3 py-2 text-sm" data-testid="dev-code">
              {t('devCode')} <strong className="font-mono text-base tracking-widest">{devCode}</strong>
            </p>
          ) : null}
          <TextField
            label={t('codeLabel')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            error={error}
            data-testid="login-code"
          />
          <Button type="submit" size="lg" loading={busy} disabled={code.replace(/\D/g, '').length !== 6} data-testid="login-code-submit">
            {t('codeSubmit')}
          </Button>
          <button type="button" className="text-sm font-bold text-link" onClick={() => setStep('start')}>
            {t('codeOther')}
          </button>
        </form>
      ) : null}

      {step === 'profile' ? (
        <form onSubmit={submitProfile} className="flex flex-col gap-3" noValidate>
          <div>
            <h3 className="text-lg font-semibold">{t('signupTitle')}</h3>
            <p className="text-sm text-fg-muted">{t('signupIntro')}</p>
          </div>
          <TextField
            label={t('usernameLabel')}
            hint={t('usernameHint')}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            pattern="[a-z0-9_]{3,20}"
            autoComplete="username"
            maxLength={20}
            data-testid="signup-username"
            required
          />
          <TextField
            label={t('birthYearLabel')}
            hint={t('birthYearHint')}
            inputMode="numeric"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            error={error}
            data-testid="signup-birth-year"
            required
          />
          <Button type="submit" size="lg" loading={busy} data-testid="signup-submit">
            {t('create')}
          </Button>
        </form>
      ) : null}

      {step === 'consent' ? (
        <form onSubmit={submitConsent} className="flex flex-col gap-3" noValidate data-testid="consent-step">
          <div>
            <h3 className="text-lg font-semibold">{t('minorTitle')}</h3>
            <p className="text-sm text-fg-muted">{t('minorBody')}</p>
          </div>
          {consentSent ? (
            <div role="status" className="rounded-control border border-border bg-surface-3 p-3 text-sm">
              <p className="font-bold">{t('consentSent')}</p>
              {devLink ? (
                <p className="mt-1 text-fg-muted">
                  {t('consentDevLink')}{' '}
                  <a href={devLink} className="font-bold text-link underline" data-testid="consent-dev-link">
                    {devLink}
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <TextField
                label={t('parentEmailLabel')}
                type="email"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                error={error}
                data-testid="parent-email"
              />
              <Button type="submit" loading={busy} data-testid="consent-submit">
                {t('sendConsent')}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => user && onDone(user)} data-testid="consent-done">
            {consentSent ? t('done') : t('later')}
          </Button>
        </form>
      ) : null}
      <p className="sr-only">{MASCOT_NAME}</p>
    </div>
  );
}
