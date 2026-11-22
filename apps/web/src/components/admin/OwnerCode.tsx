'use client';

import { useTranslations } from 'next-intl';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Skeleton, TextField } from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';

/** Draws the set-up link as a QR code. The library is only fetched on this screen. */
export function Qr({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode')
      .then((qr) => qr.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#0b0c0e', light: '#ffffff' } }))
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return src ? <img src={src} width={220} height={220} alt="" className="rounded-control bg-white p-1" data-testid="owner-qr" /> : <Skeleton className="size-[220px]" />;
}

/**
 * The second lock on the management portal. The admin role is not enough: the person must also
 * type the current 6-digit code from an authenticator app on their own phone. On the live site
 * the database refuses every staff request from a session that has not passed this step.
 */
export function OwnerCodeGate({ userId, children }: { userId: string; children: ReactNode }) {
  const t = useTranslations('admin.owner');
  const status = useRepoQuery((repo) => repo.auth.ownerCodeStatus(), [userId], { topics: ['session'] });
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status.error) return <Card className="mx-auto max-w-md p-5 text-sm">{t('unavailable')}</Card>;
  if (!status.data) return <Skeleton className="mx-auto h-72 w-full max-w-md" />;
  if (status.data.unlocked) return <>{children}</>;

  const enrolled = status.data.enrolled;
  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await (await getRepo()).auth.ownerCodeEnroll());
    } catch {
      setError(t('unavailable'));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await (await getRepo()).auth.ownerCodeVerify(code);
      if (ok) status.refresh();
      else setError(t('wrong'));
    } catch (err) {
      setError(err instanceof RepoError && err.code === 'rate_limited' ? t('locked') : t('unavailable'));
    } finally {
      setBusy(false);
      setCode('');
    }
  };

  return (
    <Card className="mx-auto flex max-w-md flex-col gap-4 p-5" data-testid="owner-code">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-control bg-surface-2 text-primary">
          {enrolled ? <KeyRound aria-hidden="true" className="size-5" /> : <ShieldCheck aria-hidden="true" className="size-5" />}
        </span>
        <div>
          <h1 className="font-display text-xl font-bold">{enrolled ? t('title') : t('setupTitle')}</h1>
          <p className="text-sm text-fg-muted">{enrolled ? t('intro') : t('setupIntro')}</p>
        </div>
      </div>

      {!enrolled && !setup ? (
        <Button loading={busy} onClick={() => void begin()} data-testid="owner-setup">
          {t('setupStart')}
        </Button>
      ) : null}

      {!enrolled && setup ? (
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>{t('step1')}</li>
          <li>
            {t('step2')}
            <div className="mt-2 flex flex-col items-start gap-2">
              <Qr uri={setup.uri} />
              <p className="text-fg-muted">{t('manual')}</p>
              <code className="rounded-md border border-border bg-surface-3 px-2 py-1 font-mono text-[0.85rem] break-all select-all" data-testid="owner-secret">
                {setup.secret}
              </code>
            </div>
          </li>
          <li>{t('step3')}</li>
        </ol>
      ) : null}

      {enrolled || setup ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.replace(/\D/g, '').length === 6) void submit();
          }}
        >
          <TextField
            label={t('code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            value={code}
            error={error ?? undefined}
            onChange={(e) => setCode(e.target.value)}
            data-testid="owner-code-input"
          />
          <Button type="submit" loading={busy} disabled={code.replace(/\D/g, '').length !== 6} data-testid="owner-code-submit">
            {t('unlock')}
          </Button>
        </form>
      ) : error ? (
        <p role="alert" className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-fg-muted">{t('note')}</p>
    </Card>
  );
}
