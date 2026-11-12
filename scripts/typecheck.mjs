// Type-checks every TypeScript project in the repo and reports all failures at the end.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, TSC, runNode } from './lib/run.mjs';

// Generated inputs (brand manifest, catalogue snapshot, locale routes) must exist first.
runNode('prepare generated files', ['scripts/build.mjs', '--prep']);

const projects = [
  'packages/ui',
  'packages/sdk',
  'apps/web',
  'scripts',
  'tests',
  'supabase/functions',
].filter((p) => existsSync(join(ROOT, p, 'tsconfig.json')));

const failed = [];
for (const project of projects) {
  const ok = runNode(`tsc ${project}`, [TSC, '--noEmit', '-p', join(project, 'tsconfig.json')], { allowFail: true });
  if (!ok) failed.push(project);
}
if (failed.length > 0) {
  console.error(`\nType errors in: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${projects.length} projects type-check.`);
