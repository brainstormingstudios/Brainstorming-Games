'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  IconButton,
  SelectField,
  Skeleton,
  Switch,
  TextAreaField,
  TextField,
  buttonClass,
  cn,
  useToast,
} from '@brainstorming/ui';
import { localizePath } from '@/i18n/config';
import { Link, useLocale } from '@/i18n/navigation';
import { PRIMARY_CATEGORY_SLUGS, tagLabel, tagSlug } from '@/lib/catalogue/categories';
import { LIMITS } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import { EMPTY_GAME, type DevGameDetail, type GameEditable } from '@/lib/data/devTypes';
import type { MediaKind, Platform } from '@/lib/data/types';
import { Markdown, wordCount } from '@/lib/domain/markdown';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { BuildUpload } from './BuildUpload';
import { useDev } from './DevShell';
import { MediaField } from './MediaField';
import { PreQaReportView } from './PreQaReportView';

const STEPS = ['details', 'content', 'media', 'build', 'submit'] as const;
type Step = (typeof STEPS)[number];

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

function nextVersion(detail: DevGameDetail | null): string {
  const nums = (detail?.versions ?? []).map((v) => Number.parseInt(v.version, 10)).filter(Number.isFinite);
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

function MarkdownField({
  label,
  value,
  onChange,
  aim,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  aim: number;
  testId?: string;
}) {
  const t = useTranslations('dev.wizard');
  const words = wordCount(value);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <TextAreaField
        label={label}
        hint={t('markdownHint')}
        meta={
          <span className={words >= aim ? 'text-success' : undefined}>
            {t('words', { count: words })} · {t('aim', { count: aim })}
          </span>
        }
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
      <div className="rounded-control border border-border bg-surface-3 p-3">
        <p className="mb-1 text-xs font-bold tracking-wide text-fg-muted uppercase">{t('preview')}</p>
        <div className="prose-bg max-h-64 overflow-auto text-sm">
          <Markdown source={value || '…'} />
        </div>
      </div>
    </div>
  );
}

/**
 * The new-game wizard. The first step creates a draft; every later change autosaves.
 * `?id=` edits an existing game, `?step=` opens a step directly.
 */
export function GameWizard() {
  const t = useTranslations('dev.wizard');
  const tc = useTranslations('common');
  const tcat = useTranslations('categories');
  const tg = useTranslations('game');
  const tgame = useTranslations('dev.game');
  const toast = useToast();
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const { studio } = useDev();
  const gameId = params.get('id');
  const step: Step = (STEPS as readonly string[]).includes(params.get('step') ?? '') ? (params.get('step') as Step) : 'details';

  const detail = useRepoQuery((repo) => (gameId ? repo.dev.game(gameId) : Promise.resolve(null)), [gameId], {
    topics: ['dev-games'],
  });
  const [form, setForm] = useState<GameEditable>(EMPTY_GAME);
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagText, setTagText] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const g = detail.data?.game;
    if (!g || loadedFor.current === g.id) return;
    loadedFor.current = g.id;
    const { id: _i, studioId: _s, status: _st, ...rest } = g;
    void _i;
    void _s;
    void _st;
    setForm({ ...EMPTY_GAME, ...rest });
    setTagText(g.tags.join(', '));
    setSlugTouched(true);
  }, [detail.data]);

  const go = (next: Step, id = gameId) => router.push(localizePath(`/dev/games/edit?id=${id}&step=${next}`, locale));

  const save = useCallback(
    (patch: Partial<GameEditable>) => {
      if (!gameId) return;
      setSaveState('saving');
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void getRepo()
          .then((repo) => repo.dev.updateGame(gameId, patch))
          .then(() => setSaveState('saved'))
          .catch((err: unknown) => {
            setSaveState('idle');
            toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
          });
      }, 700);
    },
    [gameId, tc, toast],
  );

  const pending = useRef<Partial<GameEditable>>({});
  const update = <K extends keyof GameEditable>(key: K, value: GameEditable[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    pending.current = { ...pending.current, [key]: value };
    if (gameId) {
      save(pending.current);
    }
  };
  useEffect(() => {
    if (saveState === 'saved') pending.current = {};
  }, [saveState]);

  const createDraft = async () => {
    setError(null);
    if (!form.title.trim() || !form.slug) return setError(t('title'));
    if (!form.category) return setError(t('categoryPlaceholder'));
    setBusy(true);
    try {
      const repo = await getRepo();
      if (!(await repo.dev.slugAvailable(form.slug))) {
        setError(t('slugTaken'));
        return;
      }
      const id = await repo.dev.createGame(form);
      go('content', id);
    } catch (err) {
      setError(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'));
    } finally {
      setBusy(false);
    }
  };

  if (gameId && detail.loading && !detail.data) return <Skeleton className="h-96 w-full" />;
  const d = detail.data ?? null;
  const media = (kind: MediaKind, label: string | null = null) =>
    d?.media.find((m) => m.kind === kind && m.variantLabel === label && m.isActive) ?? null;
  const latest = d?.versions[0] ?? null;
  const preQaOk = latest ? ['pre_qa_passed', 'pre_qa_warn', 'approved', 'in_review'].includes(latest.qaStatus) : false;
  const checks = [
    { label: 'checkPreQa', ok: preQaOk },
    { label: 'checkCover', ok: Boolean(media('cover_landscape')) },
    { label: 'checkText', ok: Boolean(form.shortDescription && form.descriptionMd) },
    { label: 'checkFaq', ok: form.faq.filter((f) => f.q && f.a).length >= LIMITS.minFaq },
  ];

  const stepBody: Record<Step, () => ReactNode> = {
    details: () => (
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('title')}
          value={form.title}
          maxLength={80}
          onChange={(e) => {
            update('title', e.target.value);
            if (!slugTouched && !d?.game.releasedAt) update('slug', slugify(e.target.value));
          }}
          data-testid="wiz-title"
        />
        <TextField
          label={t('slug')}
          hint={t('slugHint', { slug: form.slug || '…' })}
          value={form.slug}
          disabled={Boolean(d?.game.releasedAt)}
          onChange={(e) => {
            setSlugTouched(true);
            update('slug', slugify(e.target.value));
          }}
          data-testid="wiz-slug"
        />
        <TextAreaField
          className="md:col-span-2"
          label={t('shortDescription')}
          hint={t('shortDescriptionHint')}
          meta={`${form.shortDescription.length}/${LIMITS.shortDescription}`}
          rows={2}
          maxLength={LIMITS.shortDescription}
          value={form.shortDescription}
          onChange={(e) => update('shortDescription', e.target.value)}
          data-testid="wiz-short"
        />
        <SelectField
          label={t('category')}
          placeholder={t('categoryPlaceholder')}
          value={form.category}
          onChange={(e) => update('category', e.target.value)}
          options={PRIMARY_CATEGORY_SLUGS.map((c) => ({ value: c, label: tcat(`${c}.name`) }))}
          data-testid="wiz-category"
        />
        <TextField
          label={t('tags')}
          hint={t('tagsHint')}
          value={tagText}
          onChange={(e) => {
            setTagText(e.target.value);
            update('tags', [...new Set(e.target.value.split(',').map(tagSlug).filter(Boolean))].slice(0, LIMITS.maxTags));
          }}
          meta={form.tags.map(tagLabel).join(' · ')}
          data-testid="wiz-tags"
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">{t('orientation')}</legend>
          {(['landscape', 'portrait', 'any'] as const).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name="orientation" checked={form.orientation === o} onChange={() => update('orientation', o)} className="size-4 accent-(--primary)" />
              {tg(`orientations.${o}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">{t('platforms')}</legend>
          {(['desktop', 'mobile', 'tablet'] as Platform[]).map((p) => (
            <Checkbox
              key={p}
              label={tg(`platforms.${p}`)}
              checked={form.platforms.includes(p)}
              onChange={(e) =>
                update('platforms', e.target.checked ? [...new Set([...form.platforms, p])] : form.platforms.filter((x) => x !== p))
              }
            />
          ))}
        </fieldset>
        <TextField label={t('engine')} placeholder={t('enginePlaceholder')} value={form.engine ?? ''} onChange={(e) => update('engine', e.target.value || null)} />
        <TextField
          label={t('maxScore')}
          inputMode="decimal"
          value={form.maxScorePerSec ?? ''}
          onChange={(e) => update('maxScorePerSec', e.target.value ? Number(e.target.value) || null : null)}
        />
        <div className="flex flex-col gap-3 md:col-span-2">
          <Switch label={t('multiplayer')} checked={form.isMultiplayer} onChange={(e) => update('isMultiplayer', e.target.checked)} />
          <Switch label={t('hasProgress')} checked={form.hasProgress} onChange={(e) => update('hasProgress', e.target.checked)} />
          <Switch label={t('exclusive')} checked={form.wantsExclusive} onChange={(e) => update('wantsExclusive', e.target.checked)} />
        </div>
      </div>
    ),
    content: () => (
      <div className="flex flex-col gap-6">
        <MarkdownField label={t('description')} value={form.descriptionMd} onChange={(v) => update('descriptionMd', v)} aim={150} testId="wiz-description" />
        <MarkdownField label={t('howToPlay')} value={form.howToPlayMd} onChange={(v) => update('howToPlayMd', v)} aim={40} testId="wiz-how" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">{t('controls')}</legend>
          {form.controls.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              {(['action', 'keyboard', 'touch'] as const).map((k) => (
                <TextField
                  key={k}
                  hideLabel
                  label={t(k === 'action' ? 'controlAction' : k === 'keyboard' ? 'controlKeyboard' : 'controlTouch')}
                  placeholder={t(k === 'action' ? 'controlAction' : k === 'keyboard' ? 'controlKeyboard' : 'controlTouch')}
                  value={row[k]}
                  onChange={(e) => update('controls', form.controls.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))}
                />
              ))}
              <IconButton label={t('remove')} onClick={() => update('controls', form.controls.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            </div>
          ))}
          <Button variant="outline" size="sm" className="self-start" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => update('controls', [...form.controls, { action: '', keyboard: '', touch: '' }])}>
            {t('addControl')}
          </Button>
        </fieldset>
        <MarkdownField label={t('features')} value={form.featuresMd} onChange={(v) => update('featuresMd', v)} aim={30} />
        <MarkdownField label={t('tips')} value={form.tipsMd} onChange={(v) => update('tipsMd', v)} aim={30} />
        <fieldset className="flex flex-col gap-2" data-testid="wiz-faq">
          <legend className="mb-1 text-sm font-bold">
            {t('faq')} <span className="font-normal text-fg-muted">({t('faqHint')})</span>
          </legend>
          {form.faq.map((row, i) => (
            <div key={i} className="grid gap-2 rounded-control border border-border p-2 md:grid-cols-[1fr_2fr_auto]">
              <TextField hideLabel label={t('faqQ')} placeholder={t('faqQ')} value={row.q} onChange={(e) => update('faq', form.faq.map((r, j) => (j === i ? { ...r, q: e.target.value } : r)))} />
              <TextField hideLabel label={t('faqA')} placeholder={t('faqA')} value={row.a} onChange={(e) => update('faq', form.faq.map((r, j) => (j === i ? { ...r, a: e.target.value } : r)))} />
              <IconButton label={t('remove')} onClick={() => update('faq', form.faq.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            </div>
          ))}
          <Button variant="outline" size="sm" className="self-start" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => update('faq', [...form.faq, { q: '', a: '' }])} data-testid="wiz-add-faq">
            {t('addFaq')}
          </Button>
        </fieldset>
      </div>
    ),
    media: () => (
      <MediaStep gameId={gameId!} media={media} canAb={studio.level !== 'rookie'} />
    ),
    build: () => (
      <div className="flex flex-col gap-5">
        <BuildUpload
          gameId={gameId!}
          suggestedVersion={nextVersion(d)}
          isLive={Boolean(d?.game.releasedAt)}
          onUploaded={() => detail.refresh()}
        />
        {latest?.qaStatus === 'pre_qa_running' ? (
          <p role="status" className="text-sm font-bold">
            {tgame('preQaRunning')}
          </p>
        ) : null}
        {latest?.preQaReport ? <PreQaReportView report={latest.preQaReport} /> : null}
      </div>
    ),
    submit: () => (
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              <span className={cn('flex size-6 items-center justify-center rounded-full', c.ok ? 'bg-success text-navy-950' : 'bg-surface-3 text-fg-muted')}>
                {c.ok ? <Check aria-hidden="true" className="size-4" /> : '·'}
              </span>
              {tgame(c.label as 'checkPreQa')}
            </li>
          ))}
        </ul>
        <Link href={`/dev/games/view?id=${gameId}`} className={buttonClass({ size: 'lg', className: 'self-start' })} data-testid="wiz-to-manage">
          {tgame('submit')}
        </Link>
      </div>
    ),
  };

  const idx = STEPS.indexOf(step);
  return (
    <div data-testid="game-wizard">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{d ? t('titleEdit', { title: d.game.title }) : t('titleNew')}</h1>
        {gameId ? (
          <span role="status" className="text-sm font-bold text-fg-muted" data-testid="save-state">
            {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('saved') : ''}
          </span>
        ) : null}
      </div>
      <ol className="mb-5 flex gap-1 overflow-x-auto" aria-label={t('titleNew')}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={!gameId && s !== 'details'}
              aria-current={s === step ? 'step' : undefined}
              onClick={() => gameId && go(s)}
              className={cn(
                'h-9 rounded-full px-3.5 text-sm font-bold whitespace-nowrap disabled:opacity-50',
                s === step ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-muted hover:text-fg',
              )}
            >
              {i + 1}. {t(`steps.${s}`)}
            </button>
          </li>
        ))}
      </ol>
      <div className="rounded-card border border-border bg-surface p-4 sm:p-6">{stepBody[step]()}</div>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-between gap-2">
        {idx > 0 ? (
          <Button variant="ghost" onClick={() => go(STEPS[idx - 1]!)}>
            {t('back')}
          </Button>
        ) : (
          <span />
        )}
        {!gameId ? (
          <Button onClick={() => void createDraft()} loading={busy} data-testid="wiz-create">
            {t('createDraft')}
          </Button>
        ) : idx < STEPS.length - 1 ? (
          <Button onClick={() => go(STEPS[idx + 1]!)} data-testid="wiz-next">
            {t('next')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MediaStep({
  gameId,
  media,
  canAb,
}: {
  gameId: string;
  media: (kind: MediaKind, label?: string | null) => DevGameDetail['media'][number] | null;
  canAb: boolean;
}) {
  const t = useTranslations('dev.media');
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MediaField gameId={gameId} kind="cover_landscape" current={media('cover_landscape')} required />
        <MediaField gameId={gameId} kind="cover_portrait" current={media('cover_portrait')} />
        <MediaField gameId={gameId} kind="cover_square" current={media('cover_square')} />
        <MediaField gameId={gameId} kind="preview_landscape" current={media('preview_landscape')} />
        <MediaField gameId={gameId} kind="preview_portrait" current={media('preview_portrait')} />
      </div>
      <section className="rounded-card border border-border p-4">
        <h3 className="text-lg font-semibold">{t('abTitle')}</h3>
        <p className="text-sm text-fg-muted">{canAb ? t('abBody') : t('abLocked')}</p>
        {canAb ? (
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {['B', 'C', 'D'].map((label) => (
              <MediaField
                key={label}
                gameId={gameId}
                kind="cover_landscape"
                variantLabel={label}
                label={t('variant', { label })}
                current={media('cover_landscape', label)}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
