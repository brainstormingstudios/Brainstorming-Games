// Builds the SDK: ESM for npm (dist/index.js) and script-tag bundles served by the site
// at /sdk/v1/bg-sdk.js and /sdk/v1/bg-crazygames-shim.js. Fails if the script bundle grows past
// 15 KB gzipped.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', '..', 'apps', 'web', 'public', 'sdk', 'v1');
mkdirSync(pub, { recursive: true });

const common = { bundle: true, minify: true, target: ['es2019'], legalComments: 'none', logLevel: 'warning' };
await build({ ...common, entryPoints: [join(here, 'src', 'index.ts')], format: 'esm', outfile: join(here, 'dist', 'index.js') });
await build({ ...common, entryPoints: [join(here, 'src', 'browser.ts')], format: 'iife', outfile: join(pub, 'bg-sdk.js') });
await build({ ...common, entryPoints: [join(here, 'src', 'crazygames-shim.ts')], format: 'iife', outfile: join(pub, 'bg-crazygames-shim.js') });

const size = gzipSync(readFileSync(join(pub, 'bg-sdk.js'))).length;
console.log(`[sdk] bg-sdk.js ${(size / 1024).toFixed(1)} KB gzipped`);
if (size > 15 * 1024) {
  console.error('[sdk] over the 15 KB budget');
  process.exit(1);
}
