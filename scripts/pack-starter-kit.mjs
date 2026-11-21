/**
 * Packs templates/starter-kit with the current SDK into apps/web/public/downloads/starter-kit.zip,
 * which the developer portal offers as a download. Runs in every build, after the SDK bundle.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'templates', 'starter-kit');
const SDK = join(ROOT, 'apps', 'web', 'public', 'sdk', 'v1', 'bg-sdk.js');
const OUT = join(ROOT, 'apps', 'web', 'public', 'downloads', 'starter-kit.zip');

const zip = new JSZip();
const folder = zip.folder('star-catcher');
for (const name of readdirSync(KIT)) folder.file(name, readFileSync(join(KIT, name)));
if (existsSync(SDK)) folder.file('bg-sdk.js', readFileSync(SDK));
else console.warn('[starter kit] bg-sdk.js not built yet: the zip has no SDK file');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`[starter kit] ${OUT}`);
