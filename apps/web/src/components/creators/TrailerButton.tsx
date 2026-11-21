'use client';

import { useTranslations } from 'next-intl';
import { Clapperboard, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, ProgressBar, buttonClass } from '@brainstorming/ui';
import { makeVerticalTrailer, trailerSupported } from '@/lib/media/verticalTrailer';

/** "Make a vertical trailer": a 9:16 video of a game's preview with the title and share link. */
export function TrailerButton({ game, link }: { game: { slug: string; title: string; previewUrl: string | null }; link: string }) {
  const t = useTranslations('creators.trailer');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => setSupported(trailerSupported()), []);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  // A different game: start over.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [game.slug]);

  if (!game.previewUrl) return <p className="text-sm text-fg-muted">{t('noVideo')}</p>;
  if (!supported) return <p className="text-sm text-fg-muted">{t('unsupported')}</p>;

  const make = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const out = await makeVerticalTrailer({
        videoUrl: game.previewUrl!,
        title: game.title,
        brand: 'Brainstorming Games',
        cta: t('cta'),
        linkText: link.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      setResult({ url: URL.createObjectURL(out.blob), name: `${game.slug}-vertical.${out.extension}` });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border p-3" data-testid="trailer-maker">
      <p className="text-sm font-bold">{t('title')}</p>
      <p className="text-xs text-fg-muted">{t('hint')}</p>
      {progress != null ? (
        <ProgressBar value={progress * 100} label={t('making')} />
      ) : result ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <video src={result.url} controls playsInline className="h-64 w-36 rounded-control bg-black object-contain" />
          <a href={result.url} download={result.name} className={buttonClass({ size: 'sm' })} data-testid="trailer-download">
            <Download aria-hidden="true" className="size-4" />
            {t('download')}
          </a>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="self-start" icon={<Clapperboard aria-hidden="true" className="size-4" />} onClick={() => void make()} data-testid="trailer-make">
          {t('make')}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
