/**
 * The pre-QA bot. Loads a game build the way the player does (sandboxed iframe on the play
 * origin, framed by the site) on desktop Chromium and on an emulated Pixel 7, and records:
 * bytes downloaded before the first gameplayStart, time to gameplayStart, console errors, which
 * SDK events fired, absolute-path 404s, requests to ad networks, and a screenshot.
 *
 *   npm run pre-qa -- <build url> [--json] [--site https://site] [--report-to <url> --version-id <id>]
 *
 * The page around the game is a small harness served by Playwright itself on the site's origin
 * (so the play origin's frame-ancestors sitelock allows it). It answers the SDK handshake like
 * the real player in Spark mode: every ad is refused, saves are in memory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Browser, type BrowserContextOptions } from '@playwright/test';
import {
  codeMakesPasswordFields,
  findCredentialFields,
  isAdNetwork,
  isMiningUrl,
  minerRules,
  scanForMiner,
  scorePreQa,
  type PreQaReport,
  type PreQaRun,
  GAMEPLAY_LIMIT_MS,
} from '../apps/web/src/lib/domain/preqa';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const url = args.find((a) => /^https?:\/\//.test(a));
const asJson = args.includes('--json');
const SITE = (flag('site') ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const HARNESS_PATH = '/__bg-pre-qa/';
// Crypto-miner rules come from online secrets only (see minerRules in lib/domain/preqa.ts).
const RULES = minerRules();

if (!url) {
  console.error('usage: pre-qa <build url> [--json] [--site <site origin>] [--report-to <url> --version-id <id>]');
  process.exit(2);
}

const sdkFile = join(ROOT, 'apps', 'web', 'public', 'sdk', 'v1', 'bg-sdk.js');

function harnessHtml(gameUrl: string): string {
  const src = `${gameUrl}${gameUrl.includes('?') ? '&' : '?'}bg_site=${encodeURIComponent(SITE)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100vw;height:100vh;display:block}</style></head>
<body><iframe id="game" src="${src.replace(/"/g, '&quot;')}" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups-to-escape-sandbox" allow="fullscreen; autoplay; gamepad"></iframe>
<script>
const frame = document.getElementById('game');
const playOrigin = new URL(${JSON.stringify(gameUrl)}).origin;
const saves = {};
const reply = (id, result) => frame.contentWindow.postMessage({ p: 'bg-sdk', v: 1, kind: 'res', id, ok: true, result }, playOrigin);
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== playOrigin) return;
  const m = e.data;
  if (!m || m.p !== 'bg-sdk' || m.kind !== 'req') return;
  window.__bgEvent(m.method === 'game.event' ? m.params.name : 'call:' + m.method);
  const p = m.params || {};
  switch (m.method) {
    case 'hello': return reply(m.id, { gameId: 'pre-qa', versionId: null, settings: { muteAudio: false, disableChat: true, lowData: false, schoolSafe: false }, user: null, inviteParams: {}, gameUrl: location.href, spark: true, preview: false });
    case 'ad.midgame': case 'ad.banner': return reply(m.id, { shown: false, reason: 'spark' });
    case 'ad.rewarded': return reply(m.id, { rewarded: false, reason: 'spark' });
    case 'ad.adblock': return reply(m.id, false);
    case 'data.get': return reply(m.id, saves[p.key] ?? null);
    case 'data.set': saves[p.key] = p.value; return reply(m.id, null);
    case 'data.remove': delete saves[p.key]; return reply(m.id, null);
    case 'lb.submit': return reply(m.id, { accepted: false });
    case 'lb.top': return reply(m.id, { entries: [], me: null });
    case 'user.get': case 'user.token': case 'user.login': return reply(m.id, null);
    default: return reply(m.id, null);
  }
});
</script></body></html>`;
}

async function runOnce(browser: Browser, device: 'desktop' | 'mobile', gameUrl: string): Promise<PreQaRun> {
  const options: BrowserContextOptions =
    device === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 720 } };
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const playOrigin = new URL(gameUrl).origin;
  const prefix = new URL(gameUrl).pathname.replace(/[^/]*$/, '');
  const events: { name: string; at: number }[] = [];
  const consoleErrors: string[] = [];
  const absolute404s = new Set<string>();
  const externalAds = new Set<string>();
  const mining = new Set<string>();
  const credentialFields = new Set<string>();
  let passwordInCode = false;
  const transfers: { at: number; bytes: number }[] = [];
  let crashed = false;

  await page.exposeFunction('__bgEvent', (name: string) => {
    events.push({ name, at: Date.now() });
  });
  await page.route(`${SITE}${HARNESS_PATH}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: harnessHtml(gameUrl) }),
  );
  if (existsSync(sdkFile)) {
    await page.route(`${SITE}/sdk/v1/bg-sdk.js`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(sdkFile) }),
    );
  }

  const debug = Boolean(process.env.BG_PREQA_DEBUG);
  page.on('console', (msg) => {
    if (debug) console.error(`[console:${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  if (debug) {
    page.on('request', (r) => console.error(`[request] ${r.url()}`));
    page.on('requestfailed', (r) => console.error(`[failed] ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => console.error(`[response] ${r.status()} ${r.url()}`));
  }
  page.on('pageerror', (err) => consoleErrors.push(String(err.message).slice(0, 300)));
  page.on('crash', () => (crashed = true));
  // The game document itself failing to load is a load failure, not a pass.
  page.on('requestfailed', (r) => {
    if (r.url().split('?')[0] === gameUrl.split('?')[0]) crashed = true;
  });
  page.on('response', (r) => {
    if (r.url().split('?')[0] === gameUrl.split('?')[0] && r.status() >= 400) crashed = true;
  });
  page.on('request', (req) => {
    if (isAdNetwork(req.url())) externalAds.add(new URL(req.url()).hostname);
    if (isMiningUrl(req.url(), RULES)) mining.add(`request to ${safeHost(req.url())}`);
  });
  page.on('websocket', (ws) => {
    if (isMiningUrl(ws.url(), RULES)) mining.add(`connection to ${safeHost(ws.url())}`);
  });
  // The build's own code, read as it loads: miner signatures and password fields.
  let scanned = 0;
  page.on('response', async (res) => {
    try {
      if (!res.url().startsWith(playOrigin) || res.status() !== 200) return;
      const type = res.headers()['content-type'] ?? '';
      if (!/javascript|html|json|wasm/.test(type) || scanned > 40 * 1048576) return;
      const body = await res.body();
      if (body.length > 15 * 1048576) return;
      scanned += body.length;
      const text = body.toString('latin1');
      for (const s of scanForMiner(text, RULES)) mining.add(`"${s}" in ${new URL(res.url()).pathname.split('/').pop()}`);
      if (!passwordInCode && /javascript|html/.test(type) && codeMakesPasswordFields(text)) passwordInCode = true;
    } catch {
      // the page closed first
    }
  });
  page.on('requestfinished', async (req) => {
    try {
      if (!req.url().startsWith(playOrigin)) return;
      const sizes = await req.sizes();
      transfers.push({ at: Date.now(), bytes: sizes.responseBodySize + sizes.responseHeadersSize });
    } catch {
      // the page closed first
    }
  });
  page.on('response', (res) => {
    const u = new URL(res.url());
    if (res.status() === 404 && u.origin === playOrigin && !u.pathname.startsWith(prefix)) absolute404s.add(u.pathname);
  });

  const started = Date.now();
  try {
    await page.goto(`${SITE}${HARNESS_PATH}`, { waitUntil: 'load', timeout: 45_000 });
  } catch {
    crashed = true;
  }
  const gameplayAt = () => events.find((e) => e.name === 'gameplay_start')?.at ?? null;
  const deadline = started + GAMEPLAY_LIMIT_MS + 5_000;
  let clicked = false;
  while (!crashed && !gameplayAt() && Date.now() < deadline) {
    // Many games wait for a first click on a title screen; give them exactly one.
    if (!clicked && Date.now() - started > 6_000) {
      clicked = true;
      const box = await page.locator('#game').boundingBox().catch(() => null);
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  const playAt = gameplayAt();
  if (playAt) await page.waitForTimeout(2_000);
  // What the game shows the player: any password, card or one-time-code field, in any of its frames.
  for (const f of page.frames().filter((fr) => fr.url().startsWith(playOrigin))) {
    const found = await f.evaluate(`(${findCredentialFields.toString()})(document)`).catch(() => []);
    for (const x of found as string[]) credentialFields.add(x);
  }
  let screenshot: string | null = null;
  try {
    const shot = await page.screenshot({ type: 'jpeg', quality: 45 });
    screenshot = `data:image/jpeg;base64,${shot.toString('base64')}`;
  } catch {
    // no screenshot for a crashed page
  }
  const cutoff = playAt ?? Date.now();
  await context.close();
  return {
    device,
    initialBytes: transfers.filter((t) => t.at <= cutoff).reduce((n, t) => n + t.bytes, 0),
    timeToGameplayMs: playAt ? playAt - started : null,
    events: [...new Set(events.filter((e) => !e.name.startsWith('call:')).map((e) => e.name))],
    calls: [...new Set(events.filter((e) => e.name.startsWith('call:')).map((e) => e.name.slice(5)))],
    consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
    absolute404s: [...absolute404s].slice(0, 20),
    externalAds: [...externalAds],
    screenshot,
    crashed,
    miningSignals: [...mining].slice(0, 20),
    credentialFields: [...credentialFields],
    passwordInCode,
  };
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u.slice(0, 80);
  }
}

function localChannel(): string | undefined {
  if (process.env.PW_CHANNEL) return process.env.PW_CHANNEL === 'bundled' ? undefined : process.env.PW_CHANNEL;
  if (process.env.CI) return undefined;
  const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'];
  return chrome.some((p) => existsSync(p)) ? 'chrome' : undefined;
}

async function main() {
  const browser = await chromium.launch({
    channel: localChannel(),
    headless: true,
    // The harness is served by Playwright, so Chrome sees it as a public page; allow it to frame
    // a build on a local play origin during development.
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
  });
  let report: PreQaReport;
  try {
    const desktop = await runOnce(browser, 'desktop', url!);
    const mobile = await runOnce(browser, 'mobile', url!);
    report = scorePreQa(url!, { desktop, mobile });
  } finally {
    await browser.close();
  }

  const reportTo = flag('report-to');
  const versionId = flag('version-id');
  if (reportTo && versionId) {
    const res = await fetch(reportTo, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pre-qa-secret': process.env.PRE_QA_CALLBACK_SECRET ?? '' },
      body: JSON.stringify({ versionId, report }),
    });
    if (!res.ok) console.error(`[pre-qa] report upload failed: ${res.status} ${await res.text()}`);
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    console.log(`[pre-qa] ${report.status.toUpperCase()} ${url}`);
    for (const c of report.checks) console.log(`  ${c.status.padEnd(4)} ${c.label}: ${c.detail}${c.fix ? `\n       fix: ${c.fix}` : ''}`);
  }
}

main().catch((err) => {
  if (asJson) process.stdout.write(`${JSON.stringify({ status: 'error', reason: String(err?.message ?? err) })}\n`);
  else console.error(err);
  process.exit(asJson ? 0 : 1);
});
