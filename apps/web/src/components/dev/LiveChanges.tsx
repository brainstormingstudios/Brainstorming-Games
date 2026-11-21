'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { Button, useToast } from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import type { DevGameDetail } from '@/lib/data/devTypes';

/**
 * Tells the developer of a released game that their page changes wait for review (players keep
 * seeing the reviewed page), and lets them withdraw them.
 */
export function LiveChangesNotice({ detail }: { detail: DevGameDetail }) {
  const t = useTranslations('dev.liveChanges');
  const tc = useTranslations('common');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!detail.game.releasedAt) return null;
  const fields = detail.pendingEdit?.fields ?? [];
  const media = detail.media.filter((m) => m.pending).length;
  if (fields.length === 0 && media === 0) {
    return (
      <p className="mb-4 rounded-card border border-border bg-surface-3 p-3 text-sm text-fg-muted" data-testid="live-changes-info">
        {t('info')}
      </p>
    );
  }
  const withdraw = async () => {
    setBusy(true);
    try {
      await (await getRepo()).dev.discardPendingEdit(detail.game.id);
      toast(t('withdrawn'), { tone: 'success' });
    } catch (err) {
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section role="status" className="mb-4 flex flex-col gap-2 rounded-card border border-warning bg-surface-3 p-4" data-testid="live-changes">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Clock aria-hidden="true" className="size-5 text-warning" />
        {t('title')}
      </h2>
      <p className="text-sm">{t('body')}</p>
      <ul className="list-disc ps-5 text-sm">
        {fields.length > 0 ? <li>{t('fields', { fields: fields.map((f) => t(`field.${f}`)).join(', ') })}</li> : null}
        {media > 0 ? <li>{t('media', { count: media })}</li> : null}
      </ul>
      <Button size="sm" variant="secondary" className="self-start" loading={busy} onClick={() => void withdraw()} data-testid="live-changes-withdraw">
        {t('withdraw')}
      </Button>
    </section>
  );
}
