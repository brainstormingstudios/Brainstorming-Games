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

/**
 * A 64-bit "difference hash" of an image (hex): the picture shrunk to 9 x 8 grey pixels, one bit
 * per neighbour comparison. Near-identical covers (re-encoded, resized, lightly edited) differ in
 * only a few bits, which is how the auto-review spots a cover copied from another game.
 */
export function differenceHash(img: CanvasImageSource, crop: CropRect): string {
  const canvas = draw(img, crop, 9, 8);
  const data = canvas.getContext('2d')!.getImageData(0, 0, 9, 8).data;
  const grey = (x: number, y: number) => {
    const i = (y * 9 + x) * 4;
    return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
  };
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (grey(x, y) > grey(x + 1, y) ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** SHA-256 of a build's sorted file paths and sizes: the same build uploaded twice gives the same value. */
export async function buildFingerprint(files: { path: string; data: Blob }[]): Promise<string> {
  const lines = files.map((f) => `${f.path}:${f.data.size}`).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
