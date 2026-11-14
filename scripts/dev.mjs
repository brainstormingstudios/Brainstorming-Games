/**
 * `npm run dev`: works with zero environment variables.
 * Prepares the generated inputs, then runs side by side:
 *   - the player site        http://localhost:3000
 *   - the developer portal   http://localhost:3001
 *   - the management portal  http://localhost:3002
 *   - the local play origin and database (port 4100)
 * Ctrl+C stops everything.
 *
 *   npm run dev -- --site play            only some of the sites (comma separated)
 */
import { NEXT, SITES, WEB, loadEnv, runNode, sitesFromArgs, startNode } from './lib/run.mjs';

loadEnv();
runNode('prepare generated files', ['scripts/build.mjs', '--prep']);

const children = [startNode(['scripts/dev-services.mjs'])];
for (const site of sitesFromArgs()) {
  children.push(
    startNode([NEXT, 'dev', '--port', String(SITES[site].port)], {
      cwd: WEB,
      env: { BG_SITE: site, NEXT_TELEMETRY_DISABLED: '1' },
    }),
  );
  console.log(`[dev] ${SITES[site].label}: http://localhost:${SITES[site].port}`);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exit(code);
}
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
