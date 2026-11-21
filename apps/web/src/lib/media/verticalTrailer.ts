/**
 * Makes a 9:16 trailer (1080 × 1920) for YouTube Shorts and Instagram Reels from a game's
 * landscape preview video, entirely in the browser: a blurred full-height background, the video
 * in the middle, the game title above and "Play free" with the link below. Recorded with
 * MediaRecorder as MP4 where the browser supports it (Chrome 126+, Safari), WebM otherwise.
 * The video must be served with CORS, or the canvas cannot be recorded.
 */
export interface TrailerInput {
  videoUrl: string;
  title: string;
  /** Shown under "Play free": the short form of the link, e.g. "brainstorming.games/game/x". */
  linkText: string;
  /** Brand line at the top. */
  brand: string;
  /** "Play free" in the viewer's language. */
  cta: string;
  /** Expected length in seconds, for progress when the file does not say (fresh recordings). */
  durationHint?: number;
  /** Called with 0..1 while recording. */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export interface TrailerResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

const W = 1080;
const H = 1920;
const FPS = 30;

export function trailerSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
}

function pickType(): { mimeType: string; extension: 'mp4' | 'webm' } {
  const candidates: [string, 'mp4' | 'webm'][] = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [type, extension] of candidates) if (MediaRecorder.isTypeSupported(type)) return { mimeType: type, extension };
  throw new Error('This browser cannot record video.');
}

/** Wraps text to fit `maxWidth`, at most `maxLines` lines (the last one ends with "…"). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\s+\S*$/, '')}…`;
    return kept;
  }
  return lines;
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('The preview video could not be loaded.'));
  });
}

export async function makeVerticalTrailer(input: TrailerInput): Promise<TrailerResult> {
  const video = await loadVideo(input.videoUrl);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const { mimeType, extension } = pickType();
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const mainH = Math.round((W * vh) / vw);
  const mainY = Math.round((H - mainH) / 2);
  // Background: the same video scaled to fill the height, blurred and darkened.
  const bgW = Math.round((H * vw) / vh);

  const draw = () => {
    ctx.save();
    ctx.filter = 'blur(36px) brightness(0.45)';
    ctx.drawImage(video, (W - bgW) / 2, 0, bgW, H);
    ctx.restore();
    ctx.fillStyle = 'rgba(11,12,14,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(video, 0, mainY, W, mainH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#00c0f0';
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillText(input.brand.toUpperCase(), W / 2, 220);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 96px Arial, sans-serif';
    wrap(ctx, input.title, W - 140, 3).forEach((l, i, all) => ctx.fillText(l, W / 2, mainY - 70 - (all.length - 1 - i) * 108));

    const ctaY = mainY + mainH + 190;
    ctx.fillStyle = '#00c0f0';
    const pillW = 560;
    ctx.beginPath();
    ctx.roundRect((W - pillW) / 2, ctaY - 90, pillW, 130, 65);
    ctx.fill();
    ctx.fillStyle = '#0b0c0e';
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.fillText(input.cta, W / 2, ctaY);
    ctx.fillStyle = '#e8eef5';
    ctx.font = '44px Arial, sans-serif';
    wrap(ctx, input.linkText, W - 140, 2).forEach((l, i) => ctx.fillText(l, W / 2, ctaY + 130 + i * 56));
  };

  return new Promise<TrailerResult>((resolve, reject) => {
    let raf = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      if (recorder.state !== 'inactive') recorder.stop();
      video.pause();
    };
    input.signal?.addEventListener('abort', () => {
      stop();
      reject(new DOMException('Aborted', 'AbortError'));
    });
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (input.signal?.aborted) return;
      resolve({ blob: new Blob(chunks, { type: mimeType.split(';')[0] }), mimeType, extension });
    };
    const loop = () => {
      draw();
      const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (input.durationHint ?? 0);
      input.onProgress?.(length ? Math.min(1, video.currentTime / length) : 0);
      if (video.ended) {
        stop();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    try {
      draw();
    } catch (err) {
      reject(err instanceof DOMException && err.name === 'SecurityError' ? new Error('The preview video is not served with CORS, so it cannot be recorded.') : err);
      return;
    }
    recorder.start(1000);
    video.currentTime = 0;
    void video.play().then(loop, (err: unknown) => {
      stop();
      reject(err);
    });
  });
}
