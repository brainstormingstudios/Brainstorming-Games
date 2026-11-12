/**
 * Checks the JavaScript budget of the production build: the home page must load less than
 * 170 KB of gzipped JS on first visit (section 10 of the brief). Run after `npm run build`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WEB } from './lib/run.mjs';

const BUDGET_KB = 170;
const NEXT_DIR = join(WEB, '.next');
const manifestFile = join(NEXT_DIR, 'app-build-manifest.json');
if (!existsSync(manifestFile)) {
  console.error('[budgets] No build found. Run `npm run build` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const buildManifest = JSON.parse(readFileSync(join(NEXT_DIR, 'build-manifest.json'), 'utf8'));

function firstLoad(entries) {
  const files = new Set([...(buildManifest.rootMainFiles ?? []), ...(buildManifest.polyfillFiles ?? [])]);
  for (const entry of entries) for (const f of manifest.pages[entry] ?? []) files.add(f);
  let bytes = 0;
  for (const f of files) {
    if (!f.endsWith('.js') || f.includes('polyfill')) continue;
    const full = join(NEXT_DIR, f);
    if (existsSync(full)) bytes += gzipSync(readFileSync(full), { level: 9 }).length;
  }
  return bytes / 1024;
}

const checks = [
  { name: 'home', entries: ['/(en)/layout', '/(en)/page'] },
  { name: 'game page', entries: ['/(en)/layout', '/(en)/game/[slug]/page'] },
];
let failed = false;
for (const c of checks) {
  const kb = firstLoad(c.entries);
  const ok = kb < BUDGET_KB;
  if (!ok && c.name === 'home') failed = true;
  console.log(`[budgets] ${c.name}: ${kb.toFixed(1)} KB gzipped first-load JS ${ok ? 'ok' : `OVER ${BUDGET_KB} KB`}`);
}
process.exit(failed ? 1 : 0);
