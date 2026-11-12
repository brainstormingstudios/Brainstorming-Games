/**
 * Production build: brand assets, SDK, locale routes, catalogue snapshot, Next static export,
 * then the post-build step (404 copies, sitemaps, headers, redirects, service worker).
 *
 *   npm run build              full build into apps/web/out
 *   npm run build -- --prep    only the generated inputs (used by `npm run dev` and typecheck)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED, NEXT, ROOT, WEB, loadEnv, runNode, runTsx } from './lib/run.mjs';

loadEnv();
const prepOnly = process.argv.includes('--prep');

runTsx('brand assets', 'scripts/prepare-brand.ts');
if (existsSync(join(ROOT, 'packages', 'sdk', 'build.mjs')) && existsSync(join(ROOT, 'packages', 'sdk', 'src', 'index.ts'))) {
  runNode('sdk bundle', ['build.mjs'], { cwd: join(ROOT, 'packages', 'sdk') });
}
if (existsSync(join(ROOT, 'scripts', 'gen-sdk-docs.ts')) && existsSync(join(ROOT, 'packages', 'sdk', 'src', 'index.ts'))) {
  runTsx('sdk reference', 'scripts/gen-sdk-docs.ts');
}
runNode('locale routes', ['scripts/gen-locale-routes.mjs']);
runTsx('catalogue snapshot', 'scripts/build-catalogue.ts');

if (!prepOnly) {
  const snapshot = JSON.parse(readFileSync(join(GENERATED, 'catalogue.json'), 'utf8'));
  runNode('next build', [NEXT, 'build'], {
    cwd: WEB,
    env: { NEXT_PUBLIC_BUILD_TIME: snapshot.generatedAt, NEXT_TELEMETRY_DISABLED: '1' },
  });
  runNode('post-build', ['scripts/postbuild.mjs']);
}
