/**
 * Lighthouse (mobile, simulated 4G) against the production build, served the way Cloudflare
 * Pages serves it. Fails when a page misses the budgets in section 10 of the brief.
 *
 *   npm run build && npm run lighthouse [-- /path/ /other/]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { ROOT } from './lib/run.mjs';

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;
const paths = process.argv.slice(2).filter((a) => a.startsWith('/'));
const targets = paths.length ? paths : ['/', '/developers/'];
const BUDGET = { performance: 90, accessibility: 95, 'best-practices': 95, seo: 100 };

const server = spawn(process.execPath, ['scripts/serve-static.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
const outDir = join(ROOT, '.local', 'lighthouse');
mkdirSync(outDir, { recursive: true });
let failed = false;
try {
  for (const path of targets) {
    const result = await lighthouse(`${BASE}${path}`, {
      port: chrome.port,
      output: 'html',
      logLevel: 'error',
      onlyCategories: Object.keys(BUDGET),
    });
    if (!result) throw new Error(`no result for ${path}`);
    const { categories, audits } = result.lhr;
    const scores = Object.fromEntries(Object.keys(BUDGET).map((k) => [k, Math.round((categories[k]?.score ?? 0) * 100)]));
    const lcp = audits['largest-contentful-paint']?.numericValue ?? 0;
    const cls = audits['cumulative-layout-shift']?.numericValue ?? 0;
    // A localhost server does not serve HTTPS; the HTTPS audit is the only expected miss locally.
    const misses = Object.entries(BUDGET).filter(([k, min]) => scores[k] < min);
    if (misses.length || lcp > 2500 || cls > 0.05) failed = true;
    console.log(
      `[lighthouse] ${path} perf ${scores.performance} a11y ${scores.accessibility} bp ${scores['best-practices']} seo ${scores.seo} | LCP ${(lcp / 1000).toFixed(2)}s CLS ${cls.toFixed(3)}${misses.length ? ` | below budget: ${misses.map(([k]) => k).join(', ')}` : ''}`,
    );
    if (process.argv.includes('--why')) {
      const fcp = audits['first-contentful-paint']?.numericValue ?? 0;
      const tbt = audits['total-blocking-time']?.numericValue ?? 0;
      const si = audits['speed-index']?.numericValue ?? 0;
      console.log(`   FCP ${(fcp / 1000).toFixed(2)}s TBT ${Math.round(tbt)}ms SI ${(si / 1000).toFixed(2)}s`);
      const lcpEl = JSON.stringify(audits['largest-contentful-paint-element']?.details ?? {}).match(/"snippet":"([^"]{0,200})/);
      console.log(`   LCP element: ${lcpEl?.[1] ?? 'n/a'}`);
      const phases = JSON.stringify(audits['largest-contentful-paint-element']?.details ?? {}).match(/"phase":"[^"]+","[^}]*timing":[\d.]+/g);
      if (phases) console.log(`   LCP phases: ${phases.join(' | ')}`);
      const chains = Object.keys(audits['network-dependency-tree-insight']?.details ?? {}).length;
      void chains;
      for (const item of audits['render-blocking-insight']?.details?.items ?? []) console.log(`   render-blocking: ${item.url} ${Math.round(item.wastedMs ?? 0)}ms`);
      const bootup = audits['bootup-time']?.details?.items ?? [];
      for (const item of bootup.slice(0, 5)) console.log(`   bootup: ${item.url} ${Math.round(item.total)}ms`);
    }
    for (const [k] of misses) {
      const failing = result.lhr.categories[k].auditRefs
        .map((ref) => audits[ref.id])
        .filter((a) => a && a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
        .slice(0, 6)
        .map((a) => `   - ${a.id}: ${a.title}`);
      console.log(failing.join('\n'));
    }
    const name = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
    writeFileSync(join(outDir, `${name}.html`), result.report);
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(result.lhr));
  }
} finally {
  await chrome.kill();
  server.kill();
}
process.exit(failed ? 1 : 0);
