'use client';

import { useTranslations } from 'next-intl';
import { CircleStop, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton, useToast } from '@brainstorming/ui';
import { getDeviceClass } from '@/lib/data/local';

const MAX_MS = 30_000;
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/**
 * Clip and share: records up to 30 seconds of this tab with the browser's own screen-capture
 * prompt, then shares the file (Web Share) or saves it. Shown only where the browser supports
 * tab capture and recording; nothing is uploaded to us.
 */
export function ClipButton({ title }: { title: string }) {
  const t = useTranslations('growth');
  const toast = useToast();
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setSupported(
      typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && getDeviceClass() === 'desktop',
    );
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
    };
  }, []);

  if (!supported) return null;

  const stop = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const start = async () => {
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
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      recorder.current = null;
      const type = rec.mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) return;
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'clip'}.${ext}`;
      const file = new File([blob], name, { type: type.split(';')[0] });
      const save = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        toast(t('clipSaved'), { tone: 'success' });
      };
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file], title, text: t('clipShareText', { title }), url: window.location.href }).catch(save);
      } else save();
    };
    // Stopping the capture from the browser's own bar ends the clip too.
    stream.getVideoTracks()[0]?.addEventListener('ended', stop);
    rec.start(1000);
    setRecording(true);
    timer.current = window.setTimeout(stop, MAX_MS);
  };

  return (
    <IconButton label={recording ? t('clipStop') : t('clip')} aria-pressed={recording} active={recording} data-testid="clip-button" onClick={() => (recording ? stop() : void start())}>
      {recording ? <CircleStop aria-hidden="true" className="size-5 text-danger" /> : <Video aria-hidden="true" className="size-5" />}
    </IconButton>
  );
}
