'use client';

import { useTranslations } from 'next-intl';
import { Image as ImageIcon, Plus, Trash2, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Skeleton, Switch, TextField, cn } from '@brainstorming/ui';
import { HOUSE_AD, VERTICAL_PROMO } from '@/lib/ads/houseAd';
import { getRepo } from '@/lib/data';
import { AD_PLACEMENTS, type AdCreative, type AdPlacement, type AdSettings } from '@/lib/data/growthTypes';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useAct } from './Admin';

/** A switchable ad space in the preview: lit when on, dimmed when off; click to switch. */
function Slot({ id, on, onToggle, className, label }: { id: AdPlacement; on: boolean; onToggle: () => void; className?: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      data-testid={`slot-${id}`}
      className={cn(
        'flex items-center justify-center rounded-md border-2 border-dashed px-2 text-center text-[11px] font-bold leading-tight transition-colors',
        on ? 'border-warning bg-warning/20 text-warning' : 'border-border bg-surface-2/50 text-fg-muted line-through',
        className,
      )}
    >
      {label}
    </button>
  );
}

const Game = ({ className }: { className?: string }) => <span aria-hidden="true" className={cn('rounded-md bg-black', className)} />;

/** Wireframes of the home page and a game page: games are black boxes, ad spaces glow. */
function SitePreview({ placements, toggle }: { placements: AdSettings['placements']; toggle: (p: AdPlacement) => void }) {
  const t = useTranslations('admin.ads');
  const on = (p: AdPlacement) => placements[p] !== false;
  const slot = (p: AdPlacement, className?: string) => <Slot id={p} on={on(p)} onToggle={() => toggle(p)} label={t(`placements.${p}`)} className={className} />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-2 p-3">
        <p className="text-sm font-bold">{t('homePreview')}</p>
        <div className="flex flex-col gap-2 rounded-card border border-border bg-bg p-2">
          <span className="h-3 w-1/3 rounded bg-surface-2" />
          <Game className="h-24 w-full" />
          <div className="grid grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <Game key={i} className="h-10" />)}</div>
          {slot('home-rail', 'h-10 w-full')}
          <div className="grid grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <Game key={i} className="h-10" />)}</div>
          <span className="h-3 w-1/4 rounded bg-surface-2" />
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 1, 2].map((i) => <Game key={i} className="h-10" />)}
            {slot('grid', 'h-10')}
          </div>
        </div>
      </Card>
      <Card className="flex flex-col gap-2 p-3">
        <p className="text-sm font-bold">{t('gamePreview')}</p>
        <div className="grid grid-cols-[1fr_5rem] gap-2 rounded-card border border-border bg-bg p-2">
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Game className="block aspect-video w-full" />
              <span className="absolute inset-x-6 top-1/2 -translate-y-1/2">{slot('in-game', 'h-10 w-full')}</span>
            </div>
            <span className="h-3 w-1/2 rounded bg-surface-2" />
            {slot('game-content', 'h-10 w-full')}
            <span className="h-2 w-3/4 rounded bg-surface-2" />
          </div>
          {slot('game-side', 'h-full min-h-32')}
        </div>
      </Card>
    </div>
  );
}

function CreativeEditor({ c, onChange, onRemove }: { c: AdCreative; onChange: (next: AdCreative) => void; onRemove: () => void }) {
  const t = useTranslations('admin.ads');
  const act = useAct();
  const set = <K extends keyof AdCreative>(k: K, v: AdCreative[K]) => onChange({ ...c, [k]: v });
  return (
    <Card className="flex flex-col gap-3 p-3" data-testid="ad-creative">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black">
          {c.media ? (
            c.kind === 'video' ? <video src={c.media} muted loop autoPlay playsInline className="size-full object-cover" /> : <img src={c.media} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon aria-hidden="true" className="size-8 text-fg-muted" />
          )}
        </div>
        <div className="grid min-w-60 flex-1 gap-2 sm:grid-cols-2">
          <TextField label={t('adTitle')} value={c.title} onChange={(e) => set('title', e.target.value)} />
          <TextField label={t('button')} value={c.cta} onChange={(e) => set('cta', e.target.value)} />
          <TextField label={t('link')} value={c.href} placeholder="https://" onChange={(e) => set('href', e.target.value)} />
          <TextField label={t('countries')} hint={t('countriesHint')} value={c.countries.join(', ')} onChange={(e) => set('countries', e.target.value.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z]{2}$/.test(x)))} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-border px-3 py-1.5 text-sm font-bold">
          {c.kind === 'video' ? <Video aria-hidden="true" className="size-4" /> : <ImageIcon aria-hidden="true" className="size-4" />}
          {t('upload')}
          <input
            type="file"
            accept="image/webp,image/png,image/jpeg,video/mp4"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void act(async () => {
                const url = await (await getRepo()).growth.uploadAdMedia(file);
                onChange({ ...c, media: url, kind: file.type === 'video/mp4' ? 'video' : 'image' });
              }, t('uploaded'));
            }}
          />
        </label>
        <Switch compact label={t('kidSafe')} checked={c.kidSafe} onChange={(e) => set('kidSafe', e.target.checked)} />
        <Switch compact label={t('active')} checked={c.active} onChange={(e) => set('active', e.target.checked)} />
        <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden="true" className="size-4 text-danger" />} onClick={onRemove}>
          {t('remove')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('whereLabel')}>
        {AD_PLACEMENTS.map((p) => {
          const on = c.placements.includes(p);
          const blocked = p === 'in-game' && c.kind !== 'video';
          return (
            <button
              key={p}
              type="button"
              disabled={blocked}
              aria-pressed={on}
              onClick={() => set('placements', on ? c.placements.filter((x) => x !== p) : [...c.placements, p])}
              className={cn('h-8 rounded-full border px-3 text-xs font-bold disabled:opacity-40', on ? 'border-primary bg-primary/15 text-primary' : 'border-border')}
            >
              {t(`placements.${p}`)}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Ads: switch ad spaces on and off on a preview of the site, and set up our own ads. */
export function AdsManager() {
  const t = useTranslations('admin.ads');
  const act = useAct();
  const settings = useRepoQuery((repo) => repo.growth.adSettings(), [], { topics: ['admin'] });
  const [draft, setDraft] = useState<AdSettings | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);
  if (!draft) return <Skeleton className="h-96 w-full" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);
  const toggle = (p: AdPlacement) => setDraft({ ...draft, placements: { ...draft.placements, [p]: draft.placements[p] === false } });
  const add = () =>
    setDraft({
      ...draft,
      creatives: [
        ...draft.creatives,
        { id: crypto.randomUUID(), title: '', media: '', kind: 'image', href: 'https://', cta: 'Learn more', kidSafe: true, countries: [], placements: ['home-rail'], active: true },
      ],
    });
  return (
    <div className="flex flex-col gap-5" data-testid="ads-manager">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Button disabled={!dirty} onClick={() => void act(async () => (await getRepo()).growth.saveAdSettings(draft), t('saved'))} data-testid="ads-save">
          {t('save')}
        </Button>
      </div>
      <SitePreview placements={draft.placements} toggle={toggle} />
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">{t('ourAds')}</h2>
          <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={add} data-testid="ads-add">
            {t('add')}
          </Button>
        </div>
        <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
          <Badge>{t('builtIn')}</Badge>
          <span>{HOUSE_AD.title}</span>
          <span className="text-fg-muted">· 16:9 · {t('builtInWhere')}</span>
          <span className="text-fg-muted">· {VERTICAL_PROMO.title} 9:16</span>
          <span className="text-fg-muted">· {t('trailers')}</span>
        </Card>
        {draft.creatives.map((c, i) => (
          <CreativeEditor
            key={c.id}
            c={c}
            onChange={(next) => setDraft({ ...draft, creatives: draft.creatives.map((x, j) => (j === i ? next : x)) })}
            onRemove={() => setDraft({ ...draft, creatives: draft.creatives.filter((_, j) => j !== i) })}
          />
        ))}
      </section>
    </div>
  );
}
