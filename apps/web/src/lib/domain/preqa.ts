/**
 * Pre-QA scoring. The bot (scripts/pre-qa.ts) records two runs, desktop and Pixel 7, and this
 * turns them into a pass / warn / fail checklist with a fix for each problem.
 */
export interface PreQaRun {
  device: 'desktop' | 'mobile';
  /** Bytes downloaded from the game's origin before the first gameplayStart (or the end). */
  initialBytes: number;
  /** Milliseconds from navigation to the first gameplayStart; null if it never fired. */
  timeToGameplayMs: number | null;
  /** SDK events seen, in order (loading_start, loading_stop, gameplay_start ...). */
  events: string[];
  consoleErrors: string[];
  /** Requests for absolute paths (`/assets/x.png`) that returned 404. */
  absolute404s: string[];
  /** Requests to known ad networks made by the game itself. */
  externalAds: string[];
  /** Small JPEG data URL. */
  screenshot: string | null;
  /** The page crashed or never loaded. */
  crashed: boolean;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface PreQaCheck {
  id: string;
  status: CheckStatus;
  label: string;
  detail: string;
  fix: string | null;
}

export interface PreQaReport {
  status: CheckStatus;
  ranAt: string;
  url: string;
  usesSdk: boolean;
  checks: PreQaCheck[];
  desktop: PreQaRun | null;
  mobile: PreQaRun | null;
}

export const GAMEPLAY_LIMIT_MS = 20_000;
export const GAMEPLAY_WARN_MS = 10_000;

export const AD_NETWORK_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adnxs.com', 'adsafeprotected.com',
  'amazon-adsystem.com', 'applovin.com', 'unityads.unity3d.com', 'imasdk.googleapis.com', 'pubmatic.com',
  'rubiconproject.com', 'openx.net', 'criteo.com', 'taboola.com', 'outbrain.com', 'adcolony.com',
  'vungle.com', 'ironsrc.com', 'chartboost.com', 'moatads.com', 'smartadserver.com', 'yandex.ru/ads',
  'crazygames.com/sdk', 'poki.com', 'gamedistribution.com', 'gamemonetize.com',
];

export function isAdNetwork(url: string): boolean {
  try {
    const u = new URL(url);
    const target = `${u.hostname}${u.pathname}`;
    return AD_NETWORK_HOSTS.some((h) => target.includes(h));
  } catch {
    return false;
  }
}

const mb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function scorePreQa(url: string, runs: { desktop: PreQaRun | null; mobile: PreQaRun | null }): PreQaReport {
  const all = [runs.desktop, runs.mobile].filter((r): r is PreQaRun => r != null);
  const checks: PreQaCheck[] = [];
  const add = (c: PreQaCheck) => checks.push(c);

  const crashed = all.filter((r) => r.crashed);
  add(
    crashed.length
      ? { id: 'loads', status: 'fail', label: 'The game loads', detail: `The page failed to load on ${crashed.map((r) => r.device).join(' and ')}.`, fix: 'Open the build from a local web server (not file://) and check the browser console.' }
      : { id: 'loads', status: 'pass', label: 'The game loads', detail: 'Loaded on desktop and on a Pixel 7.', fix: null },
  );

  const sawSdk = all.some((r) => r.events.length > 0);
  const has = (name: string) => all.every((r) => r.events.includes(name));
  add({
    id: 'sdk', status: sawSdk ? 'pass' : 'warn', label: 'Brainstorming SDK connected',
    detail: sawSdk ? 'The SDK talked to the platform.' : 'No SDK calls were seen.',
    fix: sawSdk ? null : 'Add the SDK script and call `await BG.init()`. It is required for Rise Launch.',
  });
  add({
    id: 'loading-events', status: has('loading_start') && has('loading_stop') ? 'pass' : 'warn', label: 'loadingStart and loadingStop fire',
    detail: has('loading_start') && has('loading_stop') ? 'Both fired.' : 'One or both were missing.',
    fix: has('loading_start') && has('loading_stop') ? null : 'Call `BG.game.loadingStart()` before loading assets and `BG.game.loadingStop()` when done.',
  });
  const gameplay = has('gameplay_start');
  add({
    id: 'gameplay-event', status: gameplay ? 'pass' : 'warn', label: 'gameplayStart fires',
    detail: gameplay ? 'Fired on both devices.' : 'gameplayStart was not seen within the time limit.',
    fix: gameplay ? null : 'Call `BG.game.gameplayStart()` when the player can act, and `gameplayStop()` on menus and game over.',
  });

  const times = all.map((r) => r.timeToGameplayMs).filter((t): t is number => t != null);
  const slowest = times.length ? Math.max(...times) : null;
  add(
    slowest == null
      ? { id: 'time-to-gameplay', status: sawSdk ? 'fail' : 'warn', label: 'Reaches gameplay within 20 s', detail: 'Could not measure: gameplayStart never fired.', fix: 'Make sure the game reaches gameplay without a click on a splash screen, or call gameplayStart when it does.' }
      : slowest > GAMEPLAY_LIMIT_MS
        ? { id: 'time-to-gameplay', status: 'fail', label: 'Reaches gameplay within 20 s', detail: `Slowest run: ${sec(slowest)}.`, fix: 'Load only what the first level needs, compress textures (WebP, KTX2), and enable Brotli or gzip builds.' }
        : { id: 'time-to-gameplay', status: slowest > GAMEPLAY_WARN_MS ? 'warn' : 'pass', label: 'Reaches gameplay within 20 s', detail: `Slowest run: ${sec(slowest)}.`, fix: slowest > GAMEPLAY_WARN_MS ? 'Under 10 s keeps far more players. Stream later levels in the background.' : null },
  );

  const bytes = all.length ? Math.max(...all.map((r) => r.initialBytes)) : 0;
  add({
    id: 'initial-download', status: bytes > 50 * 1048576 ? 'fail' : bytes > 20 * 1048576 ? 'warn' : 'pass', label: 'Initial download size',
    detail: `${mb(bytes)} before gameplay.`,
    fix: bytes > 20 * 1048576 ? 'Split assets and load later levels after gameplay starts. Mobile players pay for every megabyte.' : null,
  });

  const errors = [...new Set(all.flatMap((r) => r.consoleErrors))];
  add({
    id: 'console-errors', status: errors.length ? 'warn' : 'pass', label: 'No console errors',
    detail: errors.length ? `${errors.length} error(s): ${errors.slice(0, 3).join(' | ').slice(0, 300)}` : 'The console stayed clean.',
    fix: errors.length ? 'Fix the errors shown. They often break the game on some browsers.' : null,
  });

  const abs = [...new Set(all.flatMap((r) => r.absolute404s))];
  add({
    id: 'absolute-paths', status: abs.length ? 'fail' : 'pass', label: 'Relative paths only',
    detail: abs.length ? `Absolute paths returned 404: ${abs.slice(0, 5).join(', ')}` : 'All files loaded from relative paths.',
    fix: abs.length ? 'Use relative paths (`assets/x.png`, not `/assets/x.png`). Games are served from a sub-folder.' : null,
  });

  const ads = [...new Set(all.flatMap((r) => r.externalAds))];
  add({
    id: 'external-ads', status: ads.length ? 'fail' : 'pass', label: 'No external ads or other portals’ SDKs',
    detail: ads.length ? `Requests to: ${ads.slice(0, 5).join(', ')}` : 'None detected.',
    fix: ads.length ? 'Remove other ad networks and portal SDKs. Ads run only through the Brainstorming SDK.' : null,
  });

  const status: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { status, ranAt: new Date().toISOString(), url, usesSdk: sawSdk, checks, desktop: runs.desktop, mobile: runs.mobile };
}
