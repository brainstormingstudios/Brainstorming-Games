'use client';

import { useTranslations } from 'next-intl';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  buttonClass,
  useToast,
} from '@brainstorming/ui';
import { Link, useLocale } from '@/i18n/navigation';
import { getRepo, RepoError } from '@/lib/data';
import type { DevlogRecord } from '@/lib/data/devTypes';
import { Markdown } from '@/lib/domain/markdown';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useDev } from './DevShell';

function useAct() {
  const tc = useTranslations('common');
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, { tone: 'success' });
      return true;
    } catch (err) {
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
      return false;
    }
  };
}

/** Player bug reports with the context the game set through the SDK. */
export function FeedbackInbox() {
  const t = useTranslations('dev.feedback');
  const locale = useLocale();
  const act = useAct();
  const { data, loading } = useRepoQuery((repo) => repo.dev.feedback(), [], { topics: ['dev-games'] });
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-3" data-testid="feedback-inbox">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      {(data ?? []).length === 0 ? (
        <EmptyState title={t('empty')} size="sm" />
      ) : (
        (data ?? []).map((f) => (
          <Card key={f.id} className="flex flex-col gap-2 p-4" data-testid="feedback-item">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold">{f.gameTitle}</span>
              <Badge>{t(`categories.${f.category}`)}</Badge>
              <Badge tone={f.status === 'open' ? 'warning' : 'success'}>{t(f.status)}</Badge>
              <span className="text-xs text-fg-muted">
                {formatDate(f.createdAt, locale)} · {f.device}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{f.message}</p>
            {f.context ? (
              <details>
                <summary className="text-sm font-bold">{t('context')}</summary>
                <pre className="mt-1 overflow-auto rounded-control bg-surface-3 p-2 text-xs">{JSON.stringify(f.context, null, 2)}</pre>
              </details>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => void act(async () => (await getRepo()).dev.resolveFeedback(f.id, f.status === 'open'))}
            >
              {f.status === 'open' ? t('resolve') : t('reopen')}
            </Button>
          </Card>
        ))
      )}
    </div>
  );
}

/** Devlogs and patch notes. */
export function DevlogEditor() {
  const t = useTranslations('dev.devlogs');
  const tc = useTranslations('common');
  const locale = useLocale();
  const act = useAct();
  const games = useRepoQuery((repo) => repo.dev.myGames(), [], { topics: ['dev-games'] });
  const logs = useRepoQuery((repo) => repo.dev.devlogs(), [], { topics: ['devlogs'] });
  const [editing, setEditing] = useState<Partial<DevlogRecord> | null>(null);
  const save = async () => {
    if (!editing) return;
    const ok = await act(
      async () =>
        (await getRepo()).dev.saveDevlog({ id: editing.id, gameId: editing.gameId ?? null, title: editing.title ?? '', bodyMd: editing.bodyMd ?? '' }),
      t('published'),
    );
    if (ok) setEditing(null);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="devlog-editor">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing({ title: '', bodyMd: '', gameId: null })}>
          {t('new')}
        </Button>
      </div>
      {editing ? (
        <Card className="flex flex-col gap-3 p-4">
          <TextField label={t('postTitle')} value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <SelectField
            label={t('game')}
            value={editing.gameId ?? ''}
            onChange={(e) => setEditing({ ...editing, gameId: e.target.value || null })}
            options={[{ value: '', label: t('allGames') }, ...(games.data ?? []).map((g) => ({ value: g.id, label: g.title }))]}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <TextAreaField label={t('body')} rows={10} value={editing.bodyMd ?? ''} onChange={(e) => setEditing({ ...editing, bodyMd: e.target.value })} />
            <div className="prose-bg max-h-72 overflow-auto rounded-control border border-border bg-surface-3 p-3 text-sm">
              <Markdown source={editing.bodyMd || '…'} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save()}>{editing.id ? t('update') : t('publish')}</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {tc('cancel')}
            </Button>
          </div>
        </Card>
      ) : null}
      {(logs.data ?? []).length === 0 && !editing ? <EmptyState title={t('empty')} size="sm" /> : null}
      {(logs.data ?? []).map((log) => (
        <Card key={log.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{log.title}</h2>
            <span className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setEditing(log)}>
                {t('edit')}
              </Button>
              <IconButton label={t('delete')} size="sm" onClick={() => void act(async () => (await getRepo()).dev.deleteDevlog(log.id))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            </span>
          </div>
          <p className="text-xs text-fg-muted">{formatDate(log.publishedAt, locale)}</p>
          <div className="prose-bg mt-2 text-sm">
            <Markdown source={log.bodyMd} baseHeading={3} />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Studio page editor plus the referral link and its stats. */
export function StudioEditor() {
  const t = useTranslations('dev.studio');
  const ts = useTranslations('dev.signup');
  const tw = useTranslations('dev.wizard');
  const toast = useToast();
  const act = useAct();
  const { studio } = useDev();
  const [bio, setBio] = useState(studio.bio);
  const [name, setName] = useState(studio.name);
  const [links, setLinks] = useState(studio.links);
  const referral = useRepoQuery((repo) => repo.dev.referralStats(), [], { topics: ['catalogue'] });
  useEffect(() => {
    setBio(studio.bio);
    setName(studio.name);
    setLinks(studio.links);
  }, [studio]);
  return (
    <div className="flex flex-col gap-5" data-testid="studio-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <Link href={`/studio/${studio.slug}`} hard className={buttonClass({ variant: 'outline', size: 'sm' })}>
          {t('view')}
        </Link>
      </div>
      <Card className="flex flex-col gap-3 p-4">
        <TextField label={ts('name')} value={name} onChange={(e) => setName(e.target.value)} />
        <TextAreaField label={t('bio')} value={bio} maxLength={600} meta={`${bio.length}/600`} onChange={(e) => setBio(e.target.value)} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">{t('links')}</legend>
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
              <TextField hideLabel label={t('linkLabel')} placeholder={t('linkLabel')} value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <TextField hideLabel label={t('linkUrl')} placeholder="https://" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <IconButton label={tw('remove')} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            </div>
          ))}
          {links.length < 6 ? (
            <Button size="sm" variant="outline" className="self-start" onClick={() => setLinks([...links, { label: '', url: '' }])}>
              {t('addLink')}
            </Button>
          ) : null}
        </fieldset>
        <Button className="self-start" onClick={() => void act(async () => (await getRepo()).dev.updateStudio({ name, bio, links }), t('saved'))}>
          {t('save')}
        </Button>
      </Card>
      {referral.data ? (
        <Card className="flex flex-col gap-2 p-4" data-testid="referral">
          <h2 className="text-xl font-semibold">{t('referralTitle')}</h2>
          <p className="text-sm text-fg-muted">{t('referralBody')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-control bg-surface-3 px-3 py-2 text-sm break-all">{referral.data.link}</code>
            <Button
              size="sm"
              variant="outline"
              icon={<Copy aria-hidden="true" className="size-4" />}
              onClick={() => void navigator.clipboard.writeText(referral.data!.link).then(() => toast(t('copied'), { tone: 'success' }))}
            >
              {t('copy')}
            </Button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-fg-muted">{t('visits')}</dt>
              <dd className="font-display text-2xl font-bold">{referral.data.visits30d}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('refImpressions')}</dt>
              <dd className="font-display text-2xl font-bold">{referral.data.adImpressions30d}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
