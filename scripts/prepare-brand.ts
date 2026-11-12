/**
 * Turns the two brand sources into everything the site needs.
 *
 *   brand/logo-full.png   mascot + "Brainstorming" wordmark + cyan "Games" pill, on white
 *   brand/mascot.png      mascot only, on white
 *
 * Output (apps/web/public/brand, git-ignored, rebuilt when a source or this script changes):
 *   logo-light-*  navy wordmark for light backgrounds      logo-dark-*  white wordmark for navy
 *   mascot-*      transparent mascot at several sizes (PNG, WebP, AVIF)
 *   favicon.ico, favicon-16/32.png, apple-touch-icon.png, icon-192/512.png, icon-maskable-512.png
 *   og-default.png (1200x630, navy, logo centred)
 *
 * How the white background is removed:
 *   1. Flood-fill "near white" from the image border. Enclosed whites (the controller face, the
 *      "Games" lettering) are never reached, so they stay opaque.
 *   2. Pixels touching the background are anti-aliased edges. Every brand colour that meets the
 *      background has almost no red in it, so red measures how much white is mixed in:
 *      alpha = 1 - R/255, then the white is subtracted back out of the colour.
 *   3. The "Brainstorming" wordmark is handled on its own: it has no intentional white, so every
 *      pixel becomes ink with alpha from darkness (this also clears the counters inside letters),
 *      and the ink can be recoloured for the dark theme.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_LOGO = join(ROOT, 'brand', 'logo-full.png');
const SRC_MASCOT = join(ROOT, 'brand', 'mascot.png');
const OUT = join(ROOT, 'apps', 'web', 'public', 'brand');
const GENERATED = join(ROOT, 'apps', 'web', 'src', 'generated');
const MANIFEST = join(GENERATED, 'brand.json');

const NAVY_950 = { r: 0x00, g: 0x0c, b: 0x30 };
const NAVY_800 = { r: 0x0c, g: 0x2a, b: 0x6e };
const WHITE = { r: 0xfc, g: 0xfc, b: 0xfc };

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function loadRgba(file: string): Promise<Raw> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const toSharp = (img: Raw) =>
  sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });

/** Marks every near-white pixel that is connected to the image border. */
function floodBackground(img: Raw, threshold = 234): Uint8Array {
  const { data, width: w, height: h } = img;
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let top = 0;
  const visit = (x: number, y: number) => {
    const i = y * w + x;
    if (bg[i]) return;
    const o = i * 4;
    if (Math.min(data[o]!, data[o + 1]!, data[o + 2]!) < threshold) return;
    bg[i] = 1;
    queue[top++] = i;
  };
  for (let x = 0; x < w; x++) {
    visit(x, 0);
    visit(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    visit(0, y);
    visit(w - 1, y);
  }
  while (top > 0) {
    const i = queue[--top]!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) visit(x - 1, y);
    if (x < w - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < h - 1) visit(x, y + 1);
  }
  return bg;
}

/** Clears the background and un-mixes white from the anti-aliased edge band. */
function cutOut(img: Raw, bg: Uint8Array, band = 2): void {
  const { data, width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (bg[i]) {
        data[o + 3] = 0;
        continue;
      }
      let nearBg = false;
      for (let dy = -band; dy <= band && !nearBg; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -band; dx <= band; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (bg[yy * w + xx]) {
            nearBg = true;
            break;
          }
        }
      }
      if (!nearBg) continue;
      const alpha = Math.max(0, Math.min(1, (250 - data[o]!) / 215));
      if (alpha >= 0.995) continue;
      if (alpha <= 0.02) {
        data[o + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const mixed = data[o + c]!;
        data[o + c] = Math.max(0, Math.min(255, Math.round((mixed - (1 - alpha) * 255) / alpha)));
      }
      data[o + 3] = Math.round(alpha * 255);
    }
  }
}

/** Bounding box of everything that is not fully transparent. */
function contentBox(img: Raw, pad = 0): Box {
  const { data, width: w, height: h } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width: w, height: h };
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  return {
    left,
    top,
    width: Math.min(w - 1, maxX + pad) - left + 1,
    height: Math.min(h - 1, maxY + pad) - top + 1,
  };
}

/** Finds where the mascot ends and the wordmark begins (first wide all-background column gap). */
function findSplitX(img: Raw, bg: Uint8Array): number {
  const { width: w, height: h } = img;
  let seenInk = false;
  let gapStart = -1;
  for (let x = 0; x < w; x++) {
    let ink = false;
    for (let y = 0; y < h; y++) {
      if (!bg[y * w + x]) {
        ink = true;
        break;
      }
    }
    if (ink) {
      if (gapStart >= 0 && x - gapStart >= 6) return Math.round((gapStart + x) / 2);
      seenInk = true;
      gapStart = -1;
    } else if (seenInk && gapStart < 0) {
      gapStart = x;
    }
  }
  return Math.round(w * 0.345);
}

/** Bounding box of the cyan "Games" pill, to the right of the mascot. */
function findPill(img: Raw, splitX: number): Box | null {
  const { data, width: w, height: h } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = splitX; x < w; x++) {
      const o = (y * w + x) * 4;
      if (data[o]! < 90 && data[o + 1]! > 140 && data[o + 2]! > 190) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 5;
  return {
    left: minX - pad,
    top: minY - pad,
    width: maxX - minX + 1 + pad * 2,
    height: maxY - minY + 1 + pad * 2,
  };
}

const inBox = (b: Box, x: number, y: number) =>
  x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height;

/** Processes the full logo. `ink` is the colour the wordmark is repainted in. */
async function buildLogo(ink: { r: number; g: number; b: number }): Promise<Raw> {
  const img = await loadRgba(SRC_LOGO);
  const original = Buffer.from(img.data);
  const bg = floodBackground(img);
  const splitX = findSplitX(img, bg);
  const pill = findPill(img, splitX);
  cutOut(img, bg);
  const { data, width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = splitX; x < w; x++) {
      if (pill && inBox(pill, x, y)) continue;
      const o = (y * w + x) * 4;
      const alpha = Math.max(0, Math.min(1, (245 - original[o]!) / 225));
      data[o] = ink.r;
      data[o + 1] = ink.g;
      data[o + 2] = ink.b;
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  return img;
}

async function buildMascot(): Promise<Raw> {
  const img = await loadRgba(SRC_MASCOT);
  cutOut(img, floodBackground(img));
  return img;
}

/** Crops to the content box and centres the result on a transparent square. */
async function squareMascot(img: Raw): Promise<{ png: Buffer; size: number; crop: Box }> {
  const crop = contentBox(img, 4);
  const size = Math.max(crop.width, crop.height);
  const png = await toSharp(img)
    .extract(crop)
    .extend({
      top: Math.floor((size - crop.height) / 2),
      bottom: Math.ceil((size - crop.height) / 2),
      left: Math.floor((size - crop.width) / 2),
      right: Math.ceil((size - crop.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return { png, size, crop };
}

/** ICO container with PNG payloads (supported by every current browser). */
function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const rgb = (c: { r: number; g: number; b: number }) => ({ ...c, alpha: 1 });

async function iconOnColour(mascotPng: Buffer, size: number, scale: number, colour = NAVY_800) {
  const inner = Math.round(size * scale);
  const mascot = await sharp(mascotPng).resize(inner, inner, { fit: 'contain' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: rgb(colour) } })
    .composite([{ input: mascot, gravity: 'centre' }])
    .png()
    .toBuffer();
}

function sourceHash(): string {
  const h = createHash('sha256');
  for (const f of [SRC_LOGO, SRC_MASCOT, fileURLToPath(import.meta.url)]) h.update(readFileSync(f));
  return h.digest('hex').slice(0, 16);
}

async function main() {
  for (const f of [SRC_LOGO, SRC_MASCOT]) {
    if (!existsSync(f)) {
      console.error(`[brand] Missing ${f}. Put logo-full.png and mascot.png in ./brand first.`);
      process.exit(1);
    }
  }
  const hash = sourceHash();
  const force = process.argv.includes('--force');
  if (!force && existsSync(MANIFEST)) {
    try {
      const prev = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { hash?: string };
      if (prev.hash === hash && existsSync(join(OUT, 'og-default.png'))) {
        console.log('[brand] up to date');
        return;
      }
    } catch {
      // fall through and rebuild
    }
  }
  mkdirSync(OUT, { recursive: true });
  mkdirSync(GENERATED, { recursive: true });

  // --- Mascot -------------------------------------------------------------------------------
  const mascotRaw = await buildMascot();
  const mascot = await squareMascot(mascotRaw);
  await sharp(mascot.png).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(join(OUT, 'mascot.png'));
  for (const size of [64, 128, 256, 512]) {
    const base = sharp(mascot.png).resize(size, size);
    await base.clone().webp({ quality: 86, alphaQuality: 90 }).toFile(join(OUT, `mascot-${size}.webp`));
    await base.clone().avif({ quality: 60 }).toFile(join(OUT, `mascot-${size}.avif`));
  }
  await sharp(mascot.png).resize(256, 256).png({ compressionLevel: 9 }).toFile(join(OUT, 'mascot-256.png'));

  // --- Logos --------------------------------------------------------------------------------
  const logoLight = await buildLogo(NAVY_950);
  const logoDark = await buildLogo(WHITE);
  const logoCrop = contentBox(logoLight, 6);
  const logoRatio = logoCrop.width / logoCrop.height;
  for (const [name, raw] of [
    ['light', logoLight],
    ['dark', logoDark],
  ] as const) {
    const cropped = await toSharp(raw).extract(logoCrop).png().toBuffer();
    for (const height of [48, 96, 192]) {
      const width = Math.round(height * logoRatio);
      await sharp(cropped)
        .resize(width, height)
        .webp({ quality: 90, alphaQuality: 95 })
        .toFile(join(OUT, `logo-${name}-${height}.webp`));
    }
    await sharp(cropped)
      .resize(Math.round(192 * logoRatio), 192)
      .png({ compressionLevel: 9 })
      .toFile(join(OUT, `logo-${name}.png`));
  }

  // --- Favicons and app icons -----------------------------------------------------------------
  const fav = async (size: number) => sharp(mascot.png).resize(size, size).png().toBuffer();
  const fav16 = await fav(16);
  const fav32 = await fav(32);
  const fav48 = await fav(48);
  writeFileSync(join(OUT, 'favicon-16.png'), fav16);
  writeFileSync(join(OUT, 'favicon-32.png'), fav32);
  writeFileSync(
    join(OUT, 'favicon.ico'),
    encodeIco([
      { size: 16, png: fav16 },
      { size: 32, png: fav32 },
      { size: 48, png: fav48 },
    ]),
  );
  writeFileSync(join(OUT, 'apple-touch-icon.png'), await iconOnColour(mascot.png, 180, 0.78));
  writeFileSync(join(OUT, 'icon-192.png'), await fav(192));
  writeFileSync(join(OUT, 'icon-512.png'), await fav(512));
  // Maskable icons keep the art inside the central 80% safe zone.
  writeFileSync(join(OUT, 'icon-maskable-512.png'), await iconOnColour(mascot.png, 512, 0.6));

  // --- Open Graph image ------------------------------------------------------------------------
  const ogLogoWidth = 780;
  const ogLogo = await toSharp(logoDark)
    .extract(logoCrop)
    .resize(ogLogoWidth, Math.round(ogLogoWidth / logoRatio))
    .png()
    .toBuffer();
  const glow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
      <defs>
        <radialGradient id="g" cx="50%" cy="46%" r="62%">
          <stop offset="0" stop-color="#1E3F95" stop-opacity="0.85"/>
          <stop offset="0.55" stop-color="#0C2A6E" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#000C30" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="630" fill="#000C30"/>
      <rect width="1200" height="630" fill="url(#g)"/>
      <rect x="0" y="618" width="1200" height="12" fill="#00C0F0"/>
    </svg>`,
  );
  await sharp(glow)
    .composite([{ input: ogLogo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, 'og-default.png'));

  // --- Manifest -------------------------------------------------------------------------------
  const manifest = {
    hash,
    logo: { ratio: Number(logoRatio.toFixed(4)), heights: [48, 96, 192] },
    mascot: {
      sizes: [64, 128, 256, 512],
      // Where the square output sits inside the source image, for anyone re-deriving overlay
      // positions (the blink and glow overlays in @brainstorming/ui/mascot.css).
      source: { width: mascotRaw.width, height: mascotRaw.height, crop: mascot.crop, square: mascot.size },
    },
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `[brand] wrote ${OUT} (logo ${logoCrop.width}x${logoCrop.height}, mascot square ${mascot.size})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
