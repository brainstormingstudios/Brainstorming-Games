/**
 * `npm run dev`: works with zero environment variables.
 * Prepares the generated inputs, then runs the Next dev server (port 3000) and the local play
 * origin (port 4100) side by side. Ctrl+C stops both.
 */
import { NEXT, WEB, loadEnv, runNode, startNode } from './lib/run.mjs';

loadEnv();
runNode('prepare generated files', ['scripts/build.mjs', '--prep']);

const children = [
  startNode(['scripts/dev-services.mjs']),
  startNode([NEXT, 'dev', '--port', process.env.PORT || '3000'], {
    cwd: WEB,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  }),
];

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
