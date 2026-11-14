/**
 * `npm start`: serves the three built sites the way Cloudflare Pages would, plus the local play
 * origin and database. Run `npm run build` first.
 *
 *   player site        http://localhost:3000
 *   developer portal   http://localhost:3001
 *   management portal  http://localhost:3002
 *
 *   npm start -- --site play     only some of the sites (comma separated)
 */
import { existsSync } from 'node:fs';
import { freePorts } from './lib/ports.mjs';
import { SITES, loadEnv, sitesFromArgs, startNode } from './lib/run.mjs';

loadEnv();
await freePorts([4100, ...sitesFromArgs().map((s) => SITES[s].port)]);
const children = [startNode(['scripts/dev-services.mjs'])];
for (const site of sitesFromArgs()) {
  if (!existsSync(SITES[site].out)) {
    console.error(`[start] The ${SITES[site].label} is not built yet. Run: npm run build`);
    process.exit(1);
  }
  children.push(startNode(['scripts/serve-static.mjs', '--site', site]));
  console.log(`[start] ${SITES[site].label}: http://localhost:${SITES[site].port}`);
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
