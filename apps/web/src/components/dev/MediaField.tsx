'use client';

import { useTranslations } from 'next-intl';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Badge, Button, Dialog, ProgressBar, cn, useToast } from '@brainstorming/ui';
import { COVER_SPECS, COVER_WIDTHS, LIMITS } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import type { DevMedia } from '@/lib/data/devTypes';
import type { MediaKind } from '@/lib/data/types';
import { centreCrop, differenceHash, loadImage, makePlaceholder, makeVariants, videoInfo, type CropRect } from './media';

type CoverKind = keyof typeof COVER_SPECS;

function CropDialog({
  image,
  target,
  onCancel,
  onCrop,
}: {
  image: HTMLImageElement;
  target: { width: number; height: number };
  onCancel: () => void;
  onCrop: (crop: CropRect) => void;
}) {
  const t = useTranslations('dev.media');
  const tc = useTranslations('common');
  const zoomId = useId();
  const box = { w: 480, h: Math.round((480 * target.height) / target.width) };
  const base = Math.max(box.w / image.naturalWidth, box.h / image.naturalHeight);
  // Never zoom out past the point where the output would be smaller than the required size.
  const maxZoom = Math.max(1, Math.min(image.naturalWidth / target.width, image.naturalHeight / target.height));
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: image.naturalWidth / 2, y: image.naturalHeight / 2 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const scale = base * zoom;
  const sw = box.w / scale;
  const sh = box.h / scale;
  const clamp = (c: { x: number; y: number }) => ({
    x: Math.min(Math.max(c.x, sw / 2), image.naturalWidth - sw / 2),
    y: Math.min(Math.max(c.y, sh / 2), image.naturalHeight - sh / 2),
  });
  const c = clamp(centre);
  const crop: CropRect = { sx: c.x - sw / 2, sy: c.y - sh / 2, sw, sh };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.x) / scale;
    const dy = (e.clientY - drag.current.y) / scale;
    drag.current = { x: e.clientX, y: e.clientY };
    setCentre((p) => clamp({ x: p.x - dx, y: p.y - dy }));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = 20 / scale;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setCentre((p) => clamp({ x: p.x + m[0], y: p.y + m[1] }));
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      title={t('cropTitle', target)}
      description={t('cropHint')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => onCrop(crop)} data-testid="crop-confirm">
            {t('useCrop')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {/* A pannable crop area: drag with a pointer, or focus it and use the arrow keys. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          role="img"
          aria-label={t('cropTitle', target)}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard panning needs focus
          tabIndex={0}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          className="relative max-w-full cursor-grab touch-none overflow-hidden rounded-control border border-border bg-black"
          style={{ width: box.w, height: box.h }}
        >
          <img
            src={image.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left select-none"
            style={{
              width: image.naturalWidth,
              height: image.naturalHeight,
              transform: `scale(${scale}) translate(${-crop.sx}px, ${-crop.sy}px)`,
            }}
          />
        </div>
        <label htmlFor={zoomId} className="flex w-full max-w-sm items-center gap-3 text-sm font-bold">
          {t('zoom')}
          <input
            id={zoomId}
            type="range"
            min={1}
            max={maxZoom}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-(--primary)"
          />
        </label>
      </div>
    </Dialog>
  );
}

export interface MediaFieldProps {
  gameId: string;
  kind: MediaKind;
  current: DevMedia | null;
  required?: boolean;
  variantLabel?: string | null;
  label?: string;
  /** A released game: a new file waits for review and the reviewed one cannot just be removed. */
  released?: boolean;
}

/** One cover or preview video: validate in the browser, crop if needed, make variants, upload. */
export function MediaField({ gameId, kind, current, required, variantLabel = null, label, released = false }: MediaFieldProps) {
  const t = useTranslations('dev.media');
  const tc = useTranslations('common');
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const isVideo = kind.startsWith('preview');
  const spec = isVideo ? null : COVER_SPECS[kind as CoverKind];

  useEffect(() => () => (cropping ? URL.revokeObjectURL(cropping.src) : undefined), [cropping]);

  const upload = async (variants: { width: number; blob: Blob }[], width: number, height: number, placeholder: string | null, phash: string | null = null) => {
    setProgress(0);
    try {
      const repo = await getRepo();
      await repo.dev.uploadMedia(gameId, { kind, variants, width, height, placeholder, variantLabel, phash }, setProgress);
    } catch (err) {
      const message = err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody');
      setError(message);
      toast(message, { tone: 'error' });
    } finally {
      setProgress(null);
    }
  };

  const processImage = async (img: HTMLImageElement, crop: CropRect) => {
    if (!spec) return;
    const widths = COVER_WIDTHS[kind as CoverKind];
    const variants = await makeVariants(img, crop, spec, widths);
    const placeholder = await makePlaceholder(img, crop, spec.width / spec.height);
    await upload(variants, spec.width, spec.height, placeholder, differenceHash(img, crop));
  };

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (isVideo) {
      if (file.size > LIMITS.previewMaxBytes) return setError(t('videoTooBig'));
      try {
        const info = await videoInfo(file);
        if (info.duration < LIMITS.previewMinSeconds - 0.5 || info.duration > LIMITS.previewMaxSeconds + 0.5) {
          return setError(t('videoTooLong', { seconds: Math.round(info.duration) }));
        }
        await upload([{ width: info.width, blob: file }], info.width, info.height, null);
      } catch {
        setError(tc('errorBody'));
      }
      return;
    }
    if (!spec) return;
    let img: HTMLImageElement;
    try {
      img = await loadImage(file);
    } catch {
      return setError(tc('errorBody'));
    }
    if (img.naturalWidth === spec.width && img.naturalHeight === spec.height) {
      await processImage(img, { sx: 0, sy: 0, sw: spec.width, sh: spec.height });
      return;
    }
    const message = t('wrongSize', { width: img.naturalWidth, height: img.naturalHeight, needW: spec.width, needH: spec.height });
    const fits = centreCrop(img.naturalWidth, img.naturalHeight, spec);
    if (fits.sw < spec.width || fits.sh < spec.height) return setError(message);
    // Large enough: offer the crop helper.
    setError(message);
    setCropping(img);
  };

  const title = label ?? t(kind);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-3 p-3" data-testid={`media-${kind}${variantLabel ? `-${variantLabel}` : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{title}</span>
        {current?.pending ? (
          <Badge tone="glow" data-testid={`media-pending-${kind}`}>{t('pendingReview')}</Badge>
        ) : (
          <Badge tone={required ? 'warning' : 'neutral'}>{required ? t('required') : t('optional')}</Badge>
        )}
      </div>
      <p className="text-xs text-fg-muted">{isVideo ? t('videoSpec') : t('size', spec!)}</p>
      {released ? <p className="text-xs text-fg-muted">{current?.pending ? t('pendingHint') : t('releasedHint')}</p> : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'relative flex aspect-video items-center justify-center overflow-hidden rounded-control border border-dashed bg-surface transition-colors',
          dragging ? 'border-primary bg-surface-2' : 'border-border',
        )}
      >
        {current ? (
          isVideo ? (
            <video src={current.url} muted loop playsInline controls className="size-full object-contain" />
          ) : (
            <img src={current.url} alt="" className="size-full object-contain" />
          )
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-fg-muted">
            <ImagePlus aria-hidden="true" className="size-8" />
            {t('dropHere')}
          </span>
        )}
      </div>
      {progress != null ? <ProgressBar value={progress * 100} label={t('uploading')} /> : null}
      {error ? (
        <p role="alert" className="text-xs font-bold text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          ref={input}
          type="file"
          accept={isVideo ? 'video/mp4,video/webm' : 'image/png,image/jpeg,image/webp,image/avif'}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
          data-testid={`media-input-${kind}${variantLabel ? `-${variantLabel}` : ''}`}
        />
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={progress != null}>
          {current ? t('replace') : t('choose')}
        </Button>
        {current && (!released || current.pending || variantLabel) ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            onClick={() => void getRepo().then((repo) => repo.dev.removeMedia(gameId, current.id))}
          >
            {t('remove')}
          </Button>
        ) : null}
      </div>
      {cropping && spec ? (
        <CropDialog
          image={cropping}
          target={spec}
          onCancel={() => setCropping(null)}
          onCrop={(crop) => {
            const img = cropping;
            setCropping(null);
            setError(null);
            void processImage(img, crop);
          }}
        />
      ) : null}
    </div>
  );
}
