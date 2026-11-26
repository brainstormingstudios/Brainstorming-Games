'use client';

import { getPreviewToken } from '@/lib/dev/previewTokens';
import { parseControls } from '@/lib/domain/controlsParse';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  IconButton,
  SelectField,
  Skeleton,
  Switch,
  TextAreaField,
  TextField,
  chipClass,
  cn,
  useToast,
  buttonClass,
} from '@brainstorming/ui';
import { MAX_SKILLS_PER_GAME, SKILLS } from '@/lib/domain/brain';
import { localizePath } from '@/i18n/config';
import { useLocale } from '@/i18n/navigation';
import { PRIMARY_CATEGORY_SLUGS, tagLabel, tagSlug } from '@/lib/catalogue/categories';
import { LIMITS } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import { EMPTY_GAME, type DevGameDetail, type GameEditable } from '@/lib/data/devTypes';
import type { ControlRow, MediaKind, Platform } from '@/lib/data/types';
import { Markdown, wordCount } from '@/lib/domain/markdown';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { BuildUpload } from './BuildUpload';
import { LiveChangesNotice } from './LiveChanges';
import { MediaField } from './MediaField';

/** Four quick steps. Everything marked required is needed to submit; the rest is optional. */
const STEPS = ['details', 'page', 'media', 'build'] as const;
type Step = (typeof STEPS)[number];

/** The engines a build can come from. "Other" lets the developer type one. */
export const ENGINES = [
  'HTML5 / JavaScript',
  'Phaser',
  'PixiJS',
  'Three.js',
  'Babylon.js',
  'PlayCanvas',
  'Construct 3',
  'GameMaker',
  'Godot',
  'Unity (WebGL)',
  'Defold',
  'Cocos Creator',
  'GDevelop',
] as const;

/** Common inputs, so most controls are two clicks. "Other" lets the developer type their own. */
const KEYBOARD_INPUTS = ['Mouse click', 'Mouse move', 'Mouse drag', 'Mouse wheel', 'Arrow keys', 'WASD', 'Space', 'Enter', 'Shift', 'E', 'Esc', 'Number keys', 'None'];
const TOUCH_INPUTS = ['Tap', 'Double tap', 'Swipe', 'Drag', 'Hold', 'Pinch', 'On-screen buttons', 'On-screen joystick', 'Tilt', 'None'];
const OTHER = '__other';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

function nextVersion(detail: DevGameDetail | null): string {
  const nums = (detail?.versions ?? []).map((v) => Number.parseInt(v.version, 10)).filter(Number.isFinite);
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

/** A label with "Required" or "Optional" next to it. */
function Need({ required, children }: { required?: boolean; children: ReactNode }) {
  const t = useTranslations('dev.wizard');
  return (
    <span className="flex items-center gap-2">
      {children}
      <span className={cn('rounded-full px-1.5 py-px text-[0.65rem] font-extrabold tracking-wide uppercase', required ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-fg-muted')}>
        {required ? t('required') : t('optional')}
      </span>
    </span>
  );
}

/** Tags as chips, like YouTube: type, then comma or Enter. */
function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const t = useTranslations('dev.wizard');
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = raw.split(',').map(tagSlug).filter(Boolean);
    if (next.length) onChange([...new Set([...value, ...next])].slice(0, LIMITS.maxTags));
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">
        <Need required>{t('tags')}</Need>
      </span>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border border-border bg-surface-3 px-2 py-1.5 focus-within:border-primary" data-testid="wiz-tags-box">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-sm font-bold" data-testid="wiz-tag">
            {tagLabel(tag)}
            <button type="button" aria-label={t('removeTag', { tag: tagLabel(tag) })} className="rounded-full p-0.5 hover:bg-surface" onClick={() => onChange(value.filter((x) => x !== tag))}>
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={onKey}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? '' : t('tagsPlaceholder')}
          aria-label={t('tags')}
          className="min-h-9 min-w-32 flex-1 bg-transparent py-1.5 text-sm outline-none"
          data-testid="wiz-tags"
        />
      </div>
      <span className="text-xs text-fg-muted">{t('tagsHint', { count: LIMITS.maxTags })}</span>
    </div>
  );
}

/** One input picker: a list of the usual inputs, or "Other" with a text box. */
function InputPicker({ label, options, value, onChange, testId }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void; testId?: string }) {
  const t = useTranslations('dev.wizard');
  const custom = value !== '' && !options.includes(value);
  const [other, setOther] = useState(custom);
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        label={label}
        hideLabel
        value={other ? OTHER : value}
        placeholder={label}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            onChange('');
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
        options={[...options.map((o) => ({ value: o, label: o })), { value: OTHER, label: t('other') }]}
        data-testid={testId}
      />
      {other ? <TextField label={label} hideLabel placeholder={t('otherPlaceholder')} value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} /> : null}
    </div>
  );
}

/** The required preview step: opens the build in the preview page (same tab; it has a Continue button back). */
function OpenPreview({ versionId, label }: { versionId: string; label: string }) {
  const locale = useLocale();
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const token = getPreviewToken(versionId);
    setHref(token ? `${localizePath(`/dev/preview?v=${versionId}`, locale)}&t=${token}` : null);
  }, [versionId, locale]);
  if (!href) return null;
  return (
    <a href={href} className={cn(buttonClass({ size: 'lg' }), 'self-start')} data-testid="wiz-open-preview">
      {label}
    </a>
  );
}

/** Paste every control at once ("Move: Arrow keys | Swipe", one per line); they fill the rows below. */
function PasteControls({ onRows }: { onRows: (rows: ControlRow[]) => void }) {
  const t = useTranslations('dev.wizard');
  const [text, setText] = useState('');
  const found = parseControls(text);
  return (
    <details className="rounded-control border border-dashed border-border px-3" data-testid="wiz-controls-paste">
      <summary className="cursor-pointer text-sm font-bold">{t('controlsPasteTitle')}</summary>
      <div className="flex flex-col gap-2 pb-3">
        <p className="text-xs text-fg-muted">{t('controlsPasteHint')}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={['Move: Arrow keys / WASD | Swipe', 'Jump: Space | Tap', 'Pause: Esc | Two-finger tap'].join(String.fromCharCode(10))}
          className="w-full rounded-control border border-border bg-surface-3 p-2 font-mono text-sm"
          data-testid="wiz-controls-paste-text"
        />
        <Button size="sm" className="self-start" disabled={found.length === 0} onClick={() => { onRows(found); setText(''); }} data-testid="wiz-controls-paste-apply">
          {t('controlsPasteApply', { count: found.length })}
        </Button>
      </div>
    </details>
  );
}

function ControlsEditor({ rows, onChange }: { rows: ControlRow[]; onChange: (rows: ControlRow[]) => void }) {
  const t = useTranslations('dev.wizard');
  const set = (i: number, patch: Partial<ControlRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-2" data-testid="wiz-controls">
      <legend className="mb-1 text-sm font-bold">
        <Need required>{t('controls')}</Need>
      </legend>
      <p className="text-xs text-fg-muted">{t('controlsHint')}</p>
      <PasteControls onRows={(pasted) => onChange(pasted)} />
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 rounded-control border border-border p-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]" data-testid="wiz-control-row">
          <TextField hideLabel label={t('controlAction')} placeholder={t('controlActionPlaceholder')} value={row.action} maxLength={60} onChange={(e) => set(i, { action: e.target.value })} data-testid="wiz-control-action" />
          <InputPicker label={t('controlKeyboard')} options={KEYBOARD_INPUTS} value={row.keyboard} onChange={(v) => set(i, { keyboard: v })} testId="wiz-control-keyboard" />
          <InputPicker label={t('controlTouch')} options={TOUCH_INPUTS} value={row.touch} onChange={(v) => set(i, { touch: v })} testId="wiz-control-touch" />
          <IconButton label={t('remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => onChange([...rows, { action: '', keyboard: '', touch: '' }])} data-testid="wiz-add-control">
        {t('addControl')}
      </Button>
    </fieldset>
  );
}

/**
 * The game form: four quick steps. The first creates a draft; every later change saves itself.
 * `?id=` edits an existing game, `?step=` opens a step directly.
 */
export function GameWizard() {
  const t = useTranslations('dev.wizard');
  const tc = useTranslations('common');
  const tcat = useTranslations('categories');
  const tg = useTranslations('game');
  const tgame = useTranslations('dev.game');
  const tb = useTranslations('brain');
  const toast = useToast();
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const gameId = params.get('id');
  const step: Step = (STEPS as readonly string[]).includes(params.get('step') ?? '') ? (params.get('step') as Step) : 'details';

  const detail = useRepoQuery((repo) => (gameId ? repo.dev.game(gameId) : Promise.resolve(null)), [gameId], { topics: ['dev-games'] });
  const [form, setForm] = useState<GameEditable>(EMPTY_GAME);
  const [slugTouched, setSlugTouched] = useState(false);
  const [engineOther, setEngineOther] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ownsRights, setOwnsRights] = useState(false);
  const [noCopies, setNoCopies] = useState(false);
  const [credits, setCredits] = useState('');
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
    setEngineOther(Boolean(g.engine) && !(ENGINES as readonly string[]).includes(g.engine!));
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
    if (gameId) save(pending.current);
  };
  useEffect(() => {
    if (saveState === 'saved') pending.current = {};
  }, [saveState]);

  const madeInIndia = form.tags.includes('made-in-india');

  const createDraft = async () => {
    setError(null);
    if (!form.title.trim() || !form.slug) return setError(t('needTitle'));
    if (!form.shortDescription.trim()) return setError(t('needShort'));
    if (!form.category) return setError(t('needCategory'));
    if (form.tags.length < 3) return setError(t('needTags'));
    setBusy(true);
    try {
      const repo = await getRepo();
      if (!(await repo.dev.slugAvailable(form.slug))) {
        setError(t('slugTaken'));
        return;
      }
      const id = await repo.dev.createGame(form);
      go('page', id);
    } catch (err) {
      setError(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'));
    } finally {
      setBusy(false);
    }
  };

  if (gameId && detail.loading && !detail.data) return <Skeleton className="h-96 w-full" />;
  const d = detail.data ?? null;
  // A file waiting for review is shown in place of the live one (the developer sees their latest).
  const media = (kind: MediaKind, label: string | null = null) =>
    d?.media.find((m) => m.kind === kind && m.variantLabel === label && m.pending) ??
    d?.media.find((m) => m.kind === kind && m.variantLabel === label && m.isActive) ??
    null;
  const latest = d?.versions[0] ?? null;
  // An uploaded build is all the developer needs: the checks run on the server after submitting
  // (migration 0026), and their results go to the moderators.
  const preQaOk = latest ? latest.qaStatus !== 'rejected' && latest.qaStatus !== 'changes_requested' : false;
  // Why the build row is not ticked yet, in plain words.
  const preQaWhy = !latest
    ? 'whyNoBuild'
    : latest.qaStatus === 'rejected' || latest.qaStatus === 'changes_requested'
      ? 'whyRejected'
      : null;
  const checklist: { key: string; ok: boolean; why?: string | null; step?: Step }[] = [
    { key: 'checkDetails', ok: Boolean(form.title.trim() && form.shortDescription.trim() && form.category && form.tags.length >= 3), step: 'details' },
    { key: 'checkPage', ok: Boolean(form.descriptionMd.trim() && form.controls.some((c) => c.action.trim())), step: 'page' },
    { key: 'checkCovers', ok: Boolean(media('cover_landscape') && media('cover_portrait') && media('cover_square')), step: 'media' },
    { key: 'checkVideo', ok: Boolean(media('preview_landscape')), step: 'media' },
    { key: 'checkPreQa', ok: preQaOk, why: preQaWhy },
    { key: 'checkPreview', ok: Boolean(latest?.previewedAt), why: 'whyPreview' },
    { key: 'checkRights', ok: ownsRights && noCopies, why: 'whyRights' },
  ];
  const ready = checklist.every((c) => c.ok);
  const inReview = latest?.qaStatus === 'in_review' || d?.game.status === 'in_review';

  const submit = async () => {
    if (!gameId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await (await getRepo()).dev.submitForReview(gameId, { ownsRights, noCopies, credits: credits.trim() });
      if (result.rejected) {
        // A clear copy was rejected at once; the game page shows the reason too.
        toast(result.reason ?? tgame('autoRejected'), { tone: 'error' });
      } else {
        toast(tgame('submitted'), { tone: 'success' });
      }
      router.push(localizePath(`/dev/games/view?id=${gameId}`, locale));
    } catch (err) {
      setError(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'));
    } finally {
      setBusy(false);
    }
  };

  const stepBody: Record<Step, () => ReactNode> = {
    details: () => (
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={<Need required>{t('title')}</Need>}
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
          label={<Need required>{t('shortDescription')}</Need>}
          hint={t('shortDescriptionHint')}
          meta={`${form.shortDescription.length}/${LIMITS.shortDescription}`}
          rows={2}
          maxLength={LIMITS.shortDescription}
          value={form.shortDescription}
          onChange={(e) => update('shortDescription', e.target.value)}
          data-testid="wiz-short"
        />
        <SelectField
          label={<Need required>{t('category')}</Need>}
          placeholder={t('categoryPlaceholder')}
          value={form.category}
          onChange={(e) => update('category', e.target.value)}
          options={PRIMARY_CATEGORY_SLUGS.map((c) => ({ value: c, label: tcat(`${c}.name`) }))}
          data-testid="wiz-category"
        />
        <div className="flex flex-col gap-1">
          <SelectField
            label={<Need>{t('engine')}</Need>}
            placeholder={t('enginePlaceholder')}
            value={engineOther ? OTHER : (form.engine ?? '')}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setEngineOther(true);
                update('engine', null);
              } else {
                setEngineOther(false);
                update('engine', e.target.value || null);
              }
            }}
            options={[...ENGINES.map((x) => ({ value: x, label: x })), { value: OTHER, label: t('other') }]}
            data-testid="wiz-engine"
          />
          {engineOther ? <TextField label={t('engine')} hideLabel placeholder={t('otherPlaceholder')} value={form.engine ?? ''} maxLength={40} onChange={(e) => update('engine', e.target.value || null)} /> : null}
        </div>
        <div className="md:col-span-2">
          <TagInput value={form.tags.filter((x) => x !== 'made-in-india')} onChange={(tags) => update('tags', madeInIndia ? [...tags, 'made-in-india'].slice(0, LIMITS.maxTags) : tags)} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">{t('platforms')}</legend>
          {(['desktop', 'mobile', 'tablet'] as Platform[]).map((p) => (
            <Checkbox key={p} label={tg(`platforms.${p}`)} checked={form.platforms.includes(p)} onChange={(e) => update('platforms', e.target.checked ? [...new Set([...form.platforms, p])] : form.platforms.filter((x) => x !== p))} />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">{t('orientation')}</legend>
          {(['landscape', 'portrait', 'any'] as const).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name="orientation" checked={form.orientation === o} onChange={() => update('orientation', o)} className="size-4 accent-(--primary)" />
              {tg(`orientations.${o}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2 md:col-span-2" data-testid="wiz-skills">
          <legend className="mb-1 text-sm font-bold">
            <Need>{t('skills')}</Need>
          </legend>
          <p className="text-xs text-fg-muted">{t('skillsHint', { count: MAX_SKILLS_PER_GAME })}</p>
          <div className="flex flex-wrap gap-2">
            {SKILLS.map((skill) => {
              const on = form.skills.includes(skill);
              const full = !on && form.skills.length >= MAX_SKILLS_PER_GAME;
              return (
                <button
                  key={skill}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  className={cn(chipClass(on), full && 'opacity-50')}
                  onClick={() => update('skills', on ? form.skills.filter((x) => x !== skill) : [...form.skills, skill])}
                  data-testid={`wiz-skill-${skill}`}
                >
                  {tb(`skills.${skill}.name`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-3 md:col-span-2">
          <Switch label={t('multiplayer')} checked={form.isMultiplayer} onChange={(e) => update('isMultiplayer', e.target.checked)} />
          <Switch
            label={t('madeInIndia')}
            description={t('madeInIndiaHint')}
            checked={madeInIndia}
            onChange={(e) => update('tags', e.target.checked ? [...form.tags, 'made-in-india'].slice(0, LIMITS.maxTags) : form.tags.filter((x) => x !== 'made-in-india'))}
            data-testid="wiz-made-in-india"
          />
          <Switch label={t('hasProgress')} checked={form.hasProgress} onChange={(e) => update('hasProgress', e.target.checked)} />
        </div>
      </div>
    ),
    page: () => (
      <div className="flex flex-col gap-6">
        <div className="grid gap-3 lg:grid-cols-2">
          <TextAreaField
            label={<Need required>{t('description')}</Need>}
            hint={t('markdownHint')}
            meta={t('words', { count: wordCount(form.descriptionMd) })}
            rows={9}
            value={form.descriptionMd}
            onChange={(e) => update('descriptionMd', e.target.value)}
            data-testid="wiz-description"
          />
          <div className="rounded-control border border-border bg-surface-3 p-3">
            <p className="mb-1 text-xs font-bold tracking-wide text-fg-muted uppercase">{t('preview')}</p>
            <div className="prose-bg max-h-64 overflow-auto text-sm">
              <Markdown source={form.descriptionMd || '…'} />
            </div>
          </div>
        </div>
        <ControlsEditor rows={form.controls} onChange={(rows) => update('controls', rows)} />
        <details className="rounded-control border border-border p-3">
          <summary className="cursor-pointer text-sm font-bold">
            <Need>{t('more')}</Need>
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <TextAreaField label={t('features')} rows={4} value={form.featuresMd} onChange={(e) => update('featuresMd', e.target.value)} />
            <TextAreaField label={t('tips')} rows={4} value={form.tipsMd} onChange={(e) => update('tipsMd', e.target.value)} />
            <fieldset className="flex flex-col gap-2" data-testid="wiz-faq">
              <legend className="mb-1 text-sm font-bold">{t('faq')}</legend>
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
        </details>
      </div>
    ),
    media: () => <MediaStep gameId={gameId!} media={media} released={Boolean(d?.game.releasedAt)} />,
    build: () => (
      <div className="flex flex-col gap-6">
        <BuildUpload gameId={gameId!} suggestedVersion={nextVersion(d)} isLive={Boolean(d?.game.releasedAt)} onUploaded={() => detail.refresh()} />
        {latest && preQaOk ? (
          <p role="status" className="text-sm font-bold" data-testid="build-status" data-qa={latest.qaStatus}>
            {t('buildReceived')}
          </p>
        ) : null}
        {latest && preQaOk && !latest.previewedAt ? <OpenPreview versionId={latest.id} label={t('openPreview')} /> : null}

        <section className="flex flex-col gap-3 rounded-card border border-border p-4" aria-labelledby="rights">
          <h2 id="rights" className="font-display text-lg font-bold">
            {t('rightsTitle')}
          </h2>
          <Checkbox label={t('ownsRights')} checked={ownsRights} onChange={(e) => setOwnsRights(e.target.checked)} data-testid="wiz-owns-rights" />
          <Checkbox label={t('noCopies')} checked={noCopies} onChange={(e) => setNoCopies(e.target.checked)} data-testid="wiz-no-copies" />
          <TextAreaField label={<Need>{t('credits')}</Need>} hint={t('creditsHint')} rows={3} maxLength={2000} value={credits} onChange={(e) => setCredits(e.target.value)} />
          <Switch label={t('exclusive')} checked={form.wantsExclusive} onChange={(e) => update('wantsExclusive', e.target.checked)} />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="ready">
          <h2 id="ready" className="font-display text-lg font-bold">
            {t('readyTitle')}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-sm" data-ok={c.ok} data-testid="wiz-check">
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', c.ok ? 'bg-success text-navy-950' : 'border border-warning text-warning')}>
                  {c.ok ? <Check aria-hidden="true" className="size-4" /> : <X aria-hidden="true" className="size-3.5" />}
                </span>
                <span className="flex flex-col pt-0.5">
                  <span className={c.ok ? '' : 'font-bold'}>{t(c.key as 'checkDetails')}</span>
                  {!c.ok && c.why ? (
                    <span className="text-xs text-fg-muted" data-testid="wiz-check-why">
                      {t(c.why as 'whyNoBuild')}
                    </span>
                  ) : null}
                  {!c.ok && c.step ? (
                    <button type="button" className="self-start text-xs font-bold text-primary hover:underline" onClick={() => go(c.step!)}>
                      {t('fixIt', { step: t(`steps.${c.step}`) })}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-fg-muted">{t('afterSubmit')}</p>
          <Button size="lg" className="self-start" disabled={!ready || inReview} loading={busy} onClick={() => void submit()} data-testid="wiz-submit">
            {inReview ? t('alreadyInReview') : tgame('submit')}
          </Button>
        </section>
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
      {d ? <LiveChangesNotice detail={d} /> : null}
      <ol className="mb-5 flex gap-1 overflow-x-auto" aria-label={t('titleNew')}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={!gameId && s !== 'details'}
              aria-current={s === step ? 'step' : undefined}
              onClick={() => gameId && go(s)}
              className={cn('h-9 rounded-full px-3.5 text-sm font-bold whitespace-nowrap disabled:opacity-50', s === step ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-muted hover:text-fg')}
            >
              {i + 1}. {t(`steps.${s}`)}
            </button>
          </li>
        ))}
      </ol>
      <div className="rounded-card border border-border bg-surface p-4 sm:p-6">{stepBody[step]()}</div>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-bold text-danger" data-testid="wiz-error">
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
  released,
}: {
  gameId: string;
  media: (kind: MediaKind, label?: string | null) => DevGameDetail['media'][number] | null;
  released: boolean;
}) {
  const t = useTranslations('dev.media');
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MediaField gameId={gameId} kind="cover_landscape" current={media('cover_landscape')} required released={released} />
        <MediaField gameId={gameId} kind="cover_portrait" current={media('cover_portrait')} required released={released} />
        <MediaField gameId={gameId} kind="cover_square" current={media('cover_square')} required released={released} />
        <MediaField gameId={gameId} kind="preview_landscape" current={media('preview_landscape')} required released={released} />
        <MediaField gameId={gameId} kind="preview_portrait" current={media('preview_portrait')} released={released} />
      </div>
      <section className="rounded-card border border-border p-4">
        <h3 className="text-lg font-semibold">{t('abTitle')}</h3>
        <p className="max-w-3xl text-sm text-fg-muted">{t('abBody')}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {['B', 'C'].map((label) => (
            <MediaField
              key={label}
              gameId={gameId}
              kind="cover_landscape"
              variantLabel={label}
              label={t('variant', { label })}
              current={media('cover_landscape', label)}
              released={released}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
