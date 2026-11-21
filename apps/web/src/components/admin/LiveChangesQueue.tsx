'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, TextAreaField } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import { getRepo } from '@/lib/data';
import type { PendingChangeItem } from '@/lib/data/devTypes';
import { formatDateTime } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

const show = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2));

/**
 * Released games whose page text or media changed. Nothing here is live until approved, so a
 * reviewed page cannot be swapped for a different game's (or a scam's) after launch.
 */
export function LiveChangesQueue() {
  const t = useTranslations('admin.liveChanges');
  const { data } = useRepoQuery((repo) => repo.admin.pendingChanges(), [], { topics: ['qa'] });
  const items = data ?? [];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="live-changes-title" data-testid="live-changes-queue">
      <h2 id="live-changes-title" className="text-2xl font-bold">
        {t('title')} <Badge className="ms-1 align-middle">{items.length}</Badge>
      </h2>
      <p className="max-w-3xl text-sm text-fg-muted">{t('intro')}</p>
      {items.length === 0 ? <p className="text-sm text-fg-muted">{t('empty')}</p> : items.map((item) => <ChangeCard key={item.gameId} item={item} />)}
    </section>
  );
}

function ChangeCard({ item }: { item: PendingChangeItem }) {
  const t = useTranslations('admin.liveChanges');
  const locale = useLocale();
  const act = useAct();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await act(async () => (await getRepo()).admin.decideChange(item.gameId, approve, note), approve ? t('approved') : t('declined'));
    setBusy(false);
  };
  const fields = Object.keys(item.changes) as (keyof PendingChangeItem['changes'])[];
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="live-change">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-display text-lg font-semibold">{item.title}</h3>
        <span className="text-sm text-fg-muted">
          {item.studioName} · {formatDateTime(item.submittedAt, locale)}
        </span>
      </div>
      {fields.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-left">
              <tr>
                <th scope="col" className="px-3 py-2">{t('field')}</th>
                <th scope="col" className="px-3 py-2">{t('live')}</th>
                <th scope="col" className="px-3 py-2">{t('proposed')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f} className="border-t border-border align-top">
                  <th scope="row" className="px-3 py-2 text-left font-bold">{t(`fields.${f}`)}</th>
                  <td className="px-3 py-2 whitespace-pre-wrap text-fg-muted">{show(item.live[f])}</td>
                  <td className="px-3 py-2 whitespace-pre-wrap" data-testid="live-change-new">{show(item.changes[f])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {item.media.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {item.media.map((m) => (
            <div key={m.id} className="flex flex-col gap-1 rounded-card border border-border p-2">
              <span className="text-xs font-bold">
                {t(`kinds.${m.kind}`)}
                {m.variantLabel ? ` ${m.variantLabel}` : ''}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[m.liveUrl, m.url].map((url, i) => (
                  <figure key={i} className="flex flex-col gap-1">
                    <figcaption className="text-xs text-fg-muted">{i === 0 ? t('live') : t('proposed')}</figcaption>
                    {url ? (
                      m.kind.startsWith('preview') ? (
                        <video src={url} muted controls playsInline className="aspect-video w-full rounded-control bg-black object-contain" />
                      ) : (
                        <img src={url} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded-control bg-black object-contain" />
                      )
                    ) : (
                      <span className="text-xs text-fg-muted">–</span>
                    )}
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <TextAreaField label={t('note')} hint={t('noteHint')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={() => void decide(true)} data-testid="live-change-approve">
          {t('approve')}
        </Button>
        <Button size="sm" variant="outline" loading={busy} disabled={note.trim().length < 10} onClick={() => void decide(false)} data-testid="live-change-decline">
          {t('decline')}
        </Button>
      </div>
    </Card>
  );
}
