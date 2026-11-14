'use client';

import { useTranslations } from 'next-intl';
import { Check, Circle } from 'lucide-react';
import { Badge, Card, cn } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import type { HostLogEntry } from '@/lib/sdk-host/bridge';

type Item = { id: string; required: boolean; match: (e: HostLogEntry) => boolean };

const event = (name: string) => (e: HostLogEntry) => e.direction === 'in' && e.method === 'game.event' && e.detail.includes(`"${name}"`);
const call = (...methods: string[]) => (e: HostLogEntry) => e.direction === 'in' && methods.includes(e.method);

/** What the Brainstorming SDK expects, in the order a game normally calls it. */
const ITEMS: Item[] = [
  { id: 'init', required: true, match: call('hello') },
  { id: 'loadingStart', required: true, match: event('loading_start') },
  { id: 'loadingStop', required: true, match: event('loading_stop') },
  { id: 'gameplayStart', required: true, match: event('gameplay_start') },
  { id: 'gameplayStop', required: true, match: event('gameplay_stop') },
  { id: 'saves', required: false, match: call('data.get', 'data.set', 'data.remove') },
  { id: 'midgame', required: false, match: call('ad.midgame') },
  { id: 'rewarded', required: false, match: call('ad.rewarded') },
  { id: 'happytime', required: false, match: call('game.celebrate') },
  { id: 'user', required: false, match: call('user.get', 'user.login', 'user.token') },
];

/**
 * Ticks each SDK feature off as the game calls it, so a developer sees at a glance what is
 * integrated. Required rows are what Rise Launch needs; the rest are optional extras.
 */
export function SdkChecklist({ log, usesSdk }: { log: HostLogEntry[]; usesSdk: boolean }) {
  const t = useTranslations('dev.sdkCheck');
  const done = new Set(ITEMS.filter((it) => log.some(it.match)).map((it) => it.id));
  const required = ITEMS.filter((it) => it.required);
  const requiredDone = required.filter((it) => done.has(it.id)).length;
  return (
    <Card className="flex flex-col gap-3 p-3" data-testid="sdk-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('title')}</h2>
        <Badge tone={requiredDone === required.length ? 'success' : 'warning'}>{t('progress', { done: requiredDone, total: required.length })}</Badge>
      </div>
      <p className="text-xs text-fg-muted">{usesSdk ? t('intro') : t('noSdk')}</p>
      <ul className="flex flex-col gap-1">
        {ITEMS.map((it) => {
          const ok = done.has(it.id);
          return (
            <li key={it.id} className="flex items-center gap-2 text-sm" data-testid="sdk-check" data-ok={ok}>
              {ok ? <Check aria-hidden="true" className="size-4 text-success" /> : <Circle aria-hidden="true" className="size-4 text-fg-muted" />}
              <span className={cn('flex-1', ok ? 'font-bold' : 'text-fg-muted')}>
                <code className="font-mono text-xs">{t(`items.${it.id}.call` as 'items.init.call')}</code> {t(`items.${it.id}.label` as 'items.init.label')}
              </span>
              {it.required ? null : <span className="text-[0.65rem] font-bold tracking-wide text-fg-muted uppercase">{t('optional')}</span>}
              <span className="sr-only">{ok ? t('seen') : t('notSeen')}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
        <Link href="/dev/docs/quick-start" className="text-primary hover:underline">
          {t('docs')}
        </Link>
        <Link href="/dev/docs/sdk-rules" className="text-primary hover:underline" data-testid="sdk-rules-link">
          {t('rules')}
        </Link>
      </div>
    </Card>
  );
}
