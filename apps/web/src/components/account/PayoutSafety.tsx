'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, useToast } from '@brainstorming/ui';
import { LoginForm } from '@/components/auth/LoginForm';
import { useLocale } from '@/i18n/navigation';
import { RepoError } from '@/lib/data';
import type { PayoutProfileSummary } from '@/lib/data/repo';
import { PAYOUT_HOLD_HOURS } from '@/lib/domain/payoutHold';
import { formatDateTime } from '@/lib/format';

/**
 * A payout-details change waiting out its 48 hours: what it is, when it takes effect, and a
 * button to cancel it ("this wasn't me").
 */
export function PendingPayoutChange({ profile, onCancel }: { profile: PayoutProfileSummary | null | undefined; onCancel: () => Promise<void> }) {
  const t = useTranslations('payoutSafety');
  const tc = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const p = profile?.pending;
  if (!p) return null;
  const cancel = async () => {
    setBusy(true);
    try {
      await onCancel();
      toast(t('cancelled'), { tone: 'success' });
    } catch (err) {
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="status" className="flex flex-col gap-2 rounded-card border border-warning bg-surface-3 p-3 text-sm" data-testid="payout-pending">
      <p className="font-bold">{t('pendingTitle', { hours: PAYOUT_HOLD_HOURS })}</p>
      <p>{t('pendingBody', { summary: p.summary, date: formatDateTime(p.effectiveAt, locale) })}</p>
      <Button size="sm" variant="secondary" className="self-start" loading={busy} onClick={() => void cancel()} data-testid="payout-cancel">
        {t('cancel')}
      </Button>
    </div>
  );
}

/** Asks for a fresh sign-in before a payout change, then runs `onDone` (the save again). */
export function ReauthPrompt({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const t = useTranslations('payoutSafety');
  return (
    <div className="flex flex-col gap-3 rounded-card border border-primary bg-surface-3 p-4" data-testid="reauth-prompt">
      <p className="flex items-center gap-2 font-bold">
        <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
        {t('reauthTitle')}
      </p>
      <p className="text-sm text-fg-muted">{t('reauthBody')}</p>
      <LoginForm onDone={() => onDone()} />
      <Button size="sm" variant="ghost" className="self-start" onClick={onClose}>
        {t('reauthCancel')}
      </Button>
    </div>
  );
}

/** True when an error from savePayoutProfile asks for a fresh sign-in. */
export const needsReauth = (err: unknown) => err instanceof RepoError && err.code === 'reauth_required';
