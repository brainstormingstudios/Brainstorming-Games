'use client';

/**
 * Browser-side media processing for covers: crop to the exact size, then make WebP variants at
 * several widths plus a tiny blurred placeholder. Supabase Free has no image transformations, so
 * this is where responsive images come from (docs/PLAN.md, D11).
 */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('not an image');
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  );
}

function draw(img: CanvasImageSource, crop: CropRect, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  return canvas;
}

/** WebP variants of the crop at each width (height follows the target aspect ratio). */
export async function makeVariants(
  img: CanvasImageSource,
  crop: CropRect,
  target: { width: number; height: number },
  widths: readonly number[],
): Promise<{ width: number; blob: Blob }[]> {
  const out: { width: number; blob: Blob }[] = [];
  for (const w of widths) {
    const h = Math.round((w * target.height) / target.width);
    out.push({ width: w, blob: await canvasToBlob(draw(img, crop, w, h), 'image/webp', w >= 1280 ? 0.82 : 0.85) });
  }
  return out;
}

/** A ~24 px wide WebP data URL shown blurred while the real cover loads. */
export async function makePlaceholder(img: CanvasImageSource, crop: CropRect, aspect: number): Promise<string> {
  const w = 24;
  const canvas = draw(img, crop, w, Math.max(1, Math.round(w / aspect)));
  return canvas.toDataURL('image/webp', 0.5);
}

/** The centred crop that fills `target` from an image of `width` × `height`. */
export function centreCrop(width: number, height: number, target: { width: number; height: number }): CropRect {
  const aspect = target.width / target.height;
  if (width / height > aspect) {
    const sw = height * aspect;
    return { sx: (width - sw) / 2, sy: 0, sw, sh: height };
  }
  const sh = width / aspect;
  return { sx: 0, sy: (height - sh) / 2, sw: width, sh };
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

export function videoInfo(file: Blob): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not a video'));
    };
    video.src = url;
  });
}

export const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', txt: 'text/plain', xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', mp3: 'audio/mpeg',
  ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', gz: 'application/gzip',
};
