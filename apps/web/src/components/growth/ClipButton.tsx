'use client';

import { useTranslations } from 'next-intl';
import { CircleStop, Copy, Download, Share2, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, IconButton, ProgressBar, buttonClass, useToast } from '@brainstorming/ui';
import { SITE_URL } from '@/lib/config';
import { getRepo } from '@/lib/data';
import { getDeviceClass } from '@/lib/data/local';
import { makeVerticalTrailer, trailerSupported } from '@/lib/media/verticalTrailer';
import type { ClipVideo } from '@/lib/sdk-host/bridge';
import { useSession } from '@/lib/hooks/useSession';

const CLIP_SECONDS = 15;
const MAX_MS = 30_000;
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

const fileName = (title: string, ext: string) => `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'clip'}.${ext}`;

export interface ClipButtonProps {
  title: string;
  slug: string;
  /** Records the game through the SDK (no browser prompt, works on phones). */
  requestClip?: (seconds: number) => Promise<ClipVideo>;
  /** Whether the game's SDK is connected right now. */
  canClip?: () => boolean;
}

/** The finished clip: a vertical version with the share link, to share or save. */
function ClipDialog({ source, title, slug, onClose }: { source: Blob; title: string; slug: string; onClose: () => void }) {
  const t = useTranslations('growth');
  const tc = useTranslations('common');
  const toast = useToast();
  const { user } = useSession();
  const [link, setLink] = useState(`${SITE_URL}/game/${slug}/`);
  const [progress, setProgress] = useState<number | null>(0);
  const [out, setOut] = useState<{ blob: Blob; url: string; ext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // An approved creator's clips carry their creator link, so the players they bring count for them.
  useEffect(() => {
    if (!user?.username) return;
    void getRepo()
      .then((repo) => repo.creators.mine())
      .then((c) => c?.status === 'approved' && setLink(`${SITE_URL}/game/${slug}/?cr=${c.handle}`))
      .catch(() => {});
  }, [user?.id, user?.username, slug]);

  useEffect(() => {
    const abort = new AbortController();
    const src = URL.createObjectURL(source);
    let made: string | null = null;
    if (!trailerSupported()) {
      setOut({ blob: source, url: src, ext: source.type.includes('mp4') ? 'mp4' : 'webm' });
      setProgress(null);
      return () => URL.revokeObjectURL(src);
    }
    void makeVerticalTrailer({
      videoUrl: src,
      title,
      brand: 'Brainstorming Games',
      cta: t('clipCta'),
      linkText: link.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      durationHint: CLIP_SECONDS,
      onProgress: setProgress,
      signal: abort.signal,
    })
      .then((r) => {
        made = URL.createObjectURL(r.blob);
        setOut({ blob: r.blob, url: made, ext: r.extension });
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        // The vertical version failed: offer the plain recording instead.
        setError(t('clipVerticalFailed'));
        setOut({ blob: source, url: src, ext: source.type.includes('mp4') ? 'mp4' : 'webm' });
      })
      .finally(() => setProgress(null));
    return () => {
      abort.abort();
      URL.revokeObjectURL(src);
      if (made) URL.revokeObjectURL(made);
    };
    // The link only changes the text on the video; it is read once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, title]);

  const share = async () => {
    if (!out) return;
    const file = new File([out.blob], fileName(title, out.ext), { type: out.blob.type || 'video/webm' });
    const text = `${t('clipShareText', { title })} ${link}`;
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(link).catch(() => {});
      toast(t('clipLinkCopied'), { tone: 'success' });
    }
  };

  return (
    <Dialog open onClose={onClose} title={t('clipTitle')} size="md" closeLabel={tc('close')}>
      <div className="flex flex-col items-center gap-3" data-testid="clip-dialog">
        {progress != null ? (
          <div className="w-full">
            <ProgressBar value={progress * 100} label={t('clipMaking')} />
          </div>
        ) : out ? (
          <video src={out.url} controls playsInline className="max-h-[55vh] rounded-control bg-black" data-testid="clip-preview" />
        ) : null}
        {error ? <p className="text-xs text-fg-muted">{error}</p> : null}
        <p className="text-center text-xs text-fg-muted">{t('clipHint')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={!out} icon={<Share2 aria-hidden="true" className="size-4" />} onClick={() => void share()} data-testid="clip-share">
            {t('clipShare')}
          </Button>
          {out ? (
            <a href={out.url} download={fileName(title, out.ext)} className={buttonClass({ variant: 'outline' })} data-testid="clip-download">
              <Download aria-hidden="true" className="size-4" />
              {t('clipDownload')}
            </a>
          ) : null}
          <Button variant="ghost" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast(t('clipLinkCopied'), { tone: 'success' }))}>
            {t('clipCopyLink')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Clip & share. With the Brainstorming SDK the game records itself for 15 seconds (no browser
 * prompt, works on phones) and the site turns it into a vertical clip with the game's link.
 * Without the SDK, desktop browsers can still record the tab with their own screen-capture
 * prompt. Nothing is uploaded to us.
 */
export function ClipButton({ title, slug, requestClip, canClip }: ClipButtonProps) {
  const t = useTranslations('growth');
  const toast = useToast();
  const [tabCapture, setTabCapture] = useState(false);
  const [recording, setRecording] = useState(false);
  const [left, setLeft] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setTabCapture(typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && getDeviceClass() === 'desktop');
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
    };
  }, []);

  // The game's SDK connects a moment after Play: check now and then whether clips are possible.
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    if (!requestClip || !canClip) return;
    const check = () => setSdkReady(canClip());
    check();
    const id = window.setInterval(check, 2000);
    return () => window.clearInterval(id);
  }, [requestClip, canClip]);

  // Countdown while the game records itself.
  useEffect(() => {
    if (!recording || left <= 0) return;
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [recording, left]);

  const viaSdk = async () => {
    setRecording(true);
    setLeft(CLIP_SECONDS);
    toast(t('clipRecording', { seconds: CLIP_SECONDS }));
    try {
      const video = await requestClip!(CLIP_SECONDS);
      setClip(video.blob);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'error';
      toast(reason === 'disabled' ? t('clipDisabled') : reason === 'tainted' || reason === 'no-canvas' ? t('clipNotPossible') : t('clipFailed'), { tone: 'error' });
    } finally {
      setRecording(false);
      setLeft(0);
    }
  };

  const stopTab = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const viaTab = async () => {
    let stream: MediaStream;
    try {
      // `preferCurrentTab` (Chromium) offers this tab first; other browsers show their usual picker.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true } as DisplayMediaStreamOptions);
    } catch {
      return; // the player closed the browser prompt
    }
    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      toast(t('clipFailed'), { tone: 'error' });
      return;
    }
    recorder.current = rec;
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      recorder.current = null;
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      if (blob.size > 0) setClip(blob);
    };
    stream.getVideoTracks()[0]?.addEventListener('ended', stopTab);
    rec.start(1000);
    setRecording(true);
    timer.current = window.setTimeout(stopTab, MAX_MS);
  };

  if (!sdkReady && !tabCapture && !recording) return null;

  const onClick = () => {
    if (recording) {
      if (recorder.current) stopTab();
      return;
    }
    if (requestClip && canClip?.()) void viaSdk();
    else if (tabCapture) void viaTab();
  };

  return (
    <>
      <IconButton
        label={recording ? (recorder.current ? t('clipStop') : t('clipRecordingLabel', { seconds: left })) : t('clip')}
        aria-pressed={recording}
        active={recording}
        data-testid="clip-button"
        data-via={sdkReady ? 'sdk' : 'tab'}
        onClick={onClick}
      >
        {recording ? (
          recorder.current ? (
            <CircleStop aria-hidden="true" className="size-5 text-danger" />
          ) : (
            <span className="font-display text-sm font-bold text-danger tabular-nums">{left}</span>
          )
        ) : (
          <Video aria-hidden="true" className="size-5" />
        )}
      </IconButton>
      {clip ? <ClipDialog source={clip} title={title} slug={slug} onClose={() => setClip(null)} /> : null}
    </>
  );
}
