'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Card, EmptyState, Skeleton } from '@brainstorming/ui';
import { GameFrame } from '@/components/game/GameFrame';
import { PLAY_ORIGIN } from '@/lib/config';
import type { GameSummary } from '@/lib/data/types';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import type { HostLogEntry } from '@/lib/sdk-host/bridge';
import { SdkChecklist } from './SdkChecklist';

/**
 * Private preview: anyone with the link can run this one build, before review. Every SDK call
 * is listed live beside the game, and nothing counts towards KPIs.
 */
export function PreviewPage() {
  const t = useTranslations('dev.preview');
  const params = useSearchParams();
  const versionId = params.get('v') ?? '';
  const token = params.get('t') ?? '';
  const info = useRepoQuery((repo) => repo.dev.preview(versionId, token), [versionId, token]);
  const [log, setLog] = useState<HostLogEntry[]>([]);

  if (info.loading && info.data === undefined) return <Skeleton className="aspect-video w-full" />;
  const p = info.data;
  if (!p) return <EmptyState title={t('invalid')} art="sad" />;

  const game: GameSummary = {
    id: p.gameId,
    slug: p.slug,
    title: p.title,
    shortDescription: '',
    category: '',
    tags: [],
    orientation: p.orientation,
    platforms: [],
    isMultiplayer: false,
    sizeBytes: 0,
    initialLoadBytes: null,
    status: 'draft',
    schoolSafe: false,
    releasedAt: null,
    updatedAt: '',
    sparkStartedAt: null,
    studio: { id: '', slug: '', name: '', country: null, isFirstParty: false, verified: false },
    cover: null,
    coverPortrait: null,
    coverSquare: null,
    preview: null,
    previewPortrait: null,
    coverVariants: [],
    stats: { plays: 0, plays7d: 0, rating10: null, votes: 0, likes: 0, dislikes: 0 },
    versionId: p.versionId,
    version: p.version,
    playPath: p.playPath,
    usesSdk: p.usesSdk,
  };

  return (
    <div className="flex flex-col gap-4" data-testid="preview-page">
      <div>
        <h1 className="text-3xl font-bold">{t('title', { title: p.title })}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <GameFrame
          game={game}
          src={`${PLAY_ORIGIN}/${p.playPath}`}
          preview
          autoStart
          onSdkLog={(entry) => setLog((l) => [...l.slice(-199), entry])}
        />
        <div className="flex min-w-0 flex-col gap-4">
        <SdkChecklist log={log} usesSdk={p.usesSdk} />
        <Card className="flex max-h-[50vh] flex-col p-3">
          <h2 className="mb-2 font-semibold">{t('events')}</h2>
          {log.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noEvents')}</p>
          ) : (
            <ol className="flex-1 overflow-auto font-mono text-xs" aria-live="polite" data-testid="sdk-log">
              {log.map((e, i) => (
                <li key={i} className="border-b border-border py-1">
                  <span className="text-fg-muted">{new Date(e.at).toLocaleTimeString()} </span>
                  <span className={e.direction === 'in' ? 'text-glow' : 'text-success'}>{e.direction === 'in' ? '→' : '←'} </span>
                  <span className="font-bold">{e.method}</span> <span className="break-all text-fg-muted">{e.detail.slice(0, 160)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        </div>
      </div>
    </div>
  );
}
