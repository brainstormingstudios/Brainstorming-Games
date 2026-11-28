/**
 * Packs each first-party game in /games into a zip in .local/originals, with the Brainstorming
 * SDK added as `bg-sdk.js`, ready to upload through the developer portal.
 *
 *   npm run pack:originals
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { ROOT, WEB } from './lib/run.mjs';

const GAMES = join(ROOT, 'games');
const OUT = join(ROOT, '.local', 'originals');
const SDK = join(WEB, 'public', 'sdk', 'v1', 'bg-sdk.js');
const KIT = join(GAMES, '_kit', 'bs-kit.js');
if (!existsSync(SDK)) {
  console.error('[pack] The SDK bundle is missing. Run: npm run build:sdk');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

const manifest = JSON.parse(readFileSync(join(GAMES, 'originals.json'), 'utf8'));
for (const game of manifest.games) {
  const dir = join(GAMES, game.slug);
  const media = new Set((game.media ?? []).map((m) => m.file));
  const zip = new JSZip();
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep).join('/');
    // Covers and preview videos are uploaded on the game's media step, not inside the build.
    if (!media.has(rel)) zip.file(rel, readFileSync(file));
  }
  zip.file('bg-sdk.js', readFileSync(SDK));
  // Games that load BS Kit get their own copy, so the build makes no requests outside its folder.
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  if (html.includes('bs-kit.js')) zip.file('bs-kit.js', readFileSync(KIT));
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  writeFileSync(join(OUT, `${game.slug}.zip`), data);
  console.log(`[pack] ${game.slug}.zip ${(data.length / 1024).toFixed(0)} KB`);
}
console.log(`[pack] zips are in ${OUT}`);
