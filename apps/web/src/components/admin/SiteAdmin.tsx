'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Skeleton, Switch, TextAreaField, TextField } from '@brainstorming/ui';
import { SITE_URL } from '@/lib/config';
import { getRepo } from '@/lib/data';
import type { SitePage } from '@/lib/data/growthTypes';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

const blank: Omit<SitePage, 'updatedAt'> = { slug: '', title: '', bodyMd: '', published: false };

/** Pages: write a page in Markdown and publish it at /page/?s=<address>. */
export function PagesAdmin() {
  const t = useTranslations('admin.pages');
  const act = useAct();
  const pages = useRepoQuery((repo) => repo.growth.pages(), [], { topics: ['admin'] });
  const [edit, setEdit] = useState<Omit<SitePage, 'updatedAt'> | null>(null);
  return (
    <div className="flex flex-col gap-4" data-testid="pages-admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEdit({ ...blank })} data-testid="page-new">
          {t('new')}
        </Button>
      </div>
      {edit ? (
        <Card className="flex flex-col gap-3 p-4" data-testid="page-editor">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('pageTitle')} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <TextField
              label={t('address')}
              hint={`${SITE_URL}/page/?s=${edit.slug || '…'}`}
              value={edit.slug}
              onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) })}
            />
          </div>
          <TextAreaField label={t('body')} hint={t('bodyHint')} rows={14} value={edit.bodyMd} onChange={(e) => setEdit({ ...edit, bodyMd: e.target.value })} />
          <div className="flex flex-wrap items-center gap-3">
            <Switch label={t('published')} checked={edit.published} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} />
            <Button
              onClick={() =>
                void act(async () => {
                  await (await getRepo()).growth.savePage(edit);
                  setEdit(null);
                }, t('saved'))
              }
              data-testid="page-save"
            >
              {t('save')}
            </Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {t('cancel')}
            </Button>
          </div>
        </Card>
      ) : null}
      {pages.data ? (
        pages.data.length ? (
          <ul className="flex flex-col gap-2">
            {pages.data.map((p) => (
              <li key={p.slug}>
                <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <span className="min-w-40 flex-1">
                    <span className="block font-bold">{p.title}</span>
                    <span className="text-fg-muted">
                      /page/?s={p.slug} · {p.published ? t('live') : t('draft')}
                    </span>
                  </span>
                  {p.published ? (
                    <a href={`${SITE_URL}/page/?s=${p.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-link">
                      {t('view')} <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ slug: p.slug, title: p.title, bodyMd: p.bodyMd, published: p.published })}>
                    {t('edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.confirm(t('confirmDelete', { title: p.title })) && void act(async () => (await getRepo()).growth.deletePage(p.slug), t('deleted'))}
                  >
                    {t('delete')}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('none')} size="sm" />
        )
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </div>
  );
}

/**
 * Google Analytics in the portal: Google does not allow its own Analytics pages inside other sites,
 * so the portal shows a free Looker Studio report built on the Analytics data.
 */
export function AnalyticsAdmin() {
  const t = useTranslations('admin.analytics');
  const act = useAct();
  const saved = useRepoQuery((repo) => repo.growth.analyticsEmbedUrl(), [], { topics: ['admin'] });
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(saved.data ?? ''), [saved.data]);
  return (
    <div className="flex flex-col gap-4" data-testid="analytics-admin">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
      </div>
      {saved.data ? (
        <iframe
          src={saved.data}
          title={t('title')}
          className="h-[75vh] w-full rounded-card border border-border bg-white"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          data-testid="analytics-frame"
        />
      ) : (
        <Card className="flex flex-col gap-2 p-4 text-sm">
          <p className="font-bold">{t('howTitle')}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <li key={i}>{t(`how${i}`)}</li>
            ))}
          </ol>
        </Card>
      )}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <TextField className="min-w-72 flex-1" label={t('embedLink')} placeholder="https://lookerstudio.google.com/embed/reporting/..." value={url} onChange={(e) => setUrl(e.target.value.trim())} />
        <Button onClick={() => void act(async () => (await getRepo()).growth.saveAnalyticsEmbedUrl(url || null), t('saved'))} data-testid="analytics-save">
          {t('save')}
        </Button>
        <a href="https://analytics.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-link">
          {t('openGa')} <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </Card>
    </div>
  );
}
