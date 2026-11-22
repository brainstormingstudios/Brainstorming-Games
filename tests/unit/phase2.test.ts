import { describe, expect, it } from 'vitest';
import { AdRules } from '@brainstorming/sdk/host';
import { parseRequest } from '@brainstorming/sdk/host';
import { computeDailyKpis, grade, percentRank, sparkVerdict, summarise, type KpiEvent } from '@/lib/domain/kpis';
import { isAdNetwork, scorePreQa, type PreQaRun } from '@/lib/domain/preqa';
import { findAbsolutePaths, mentionsSdk, validateBuild } from '@/lib/domain/zipValidation';

describe('ad rules', () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('refuses every ad during Spark', () => {
    const rules = new AdRules({ spark: true, enabled: true });
    expect(rules.checkMidgame()).toBe('spark');
    expect(rules.checkRewarded()).toBe('spark');
    expect(rules.checkBanner('a')).toBe('spark');
  });

  it('allows a midgame only after 60 s of gameplay and then once every 3 minutes', () => {
    const c = clock();
    const rules = new AdRules({ spark: false, enabled: true, now: c.now });
    rules.gameplayStart();
    c.advance(59_000);
    expect(rules.checkMidgame()).toBe('cooldown');
    c.advance(2_000);
    expect(rules.checkMidgame()).toBeNull();
    rules.adStarted();
    expect(rules.checkMidgame()).toBe('busy');
    rules.midgameDone();
    c.advance(170_000);
    expect(rules.checkMidgame()).toBe('cooldown');
    c.advance(11_000);
    expect(rules.checkMidgame()).toBeNull();
  });

  it('counts only gameplay time towards the first minute', () => {
    const c = clock();
    const rules = new AdRules({ spark: false, enabled: true, now: c.now });
    rules.gameplayStart();
    c.advance(30_000);
    rules.gameplayStop();
    c.advance(600_000); // a long menu does not count
    rules.gameplayStart();
    c.advance(20_000);
    expect(rules.gameplayTime()).toBe(50_000);
    expect(rules.checkMidgame()).toBe('cooldown');
  });

  it('remembers the last midgame across games (per player)', () => {
    const c = clock();
    const rules = new AdRules({ spark: false, enabled: true, now: c.now, lastMidgameAt: c.now() - 60_000 });
    rules.gameplayStart();
    c.advance(61_000);
    expect(rules.checkMidgame()).toBe('cooldown');
  });

  it('never chains rewarded ads: gameplay must start in between', () => {
    const c = clock();
    const rules = new AdRules({ spark: false, enabled: true, now: c.now });
    expect(rules.checkRewarded()).toBeNull();
    rules.adStarted();
    rules.rewardedDone();
    c.advance(60_000);
    expect(rules.checkRewarded()).toBe('chained');
    rules.gameplayStart();
    expect(rules.checkRewarded()).toBeNull();
  });

  it('allows at most 2 banners and only while gameplay is stopped', () => {
    const rules = new AdRules({ spark: false, enabled: true });
    expect(rules.checkBanner('a')).toBeNull();
    rules.bannerShown('a');
    rules.bannerShown('b');
    expect(rules.checkBanner('c')).toBe('limit');
    expect(rules.checkBanner('a')).toBeNull();
    rules.gameplayStart();
    expect(rules.checkBanner('a')).toBe('gameplay-active');
    expect(rules.bannersToHide().sort()).toEqual(['a', 'b']);
  });
});

describe('SDK message validation', () => {
  const msg = (method: string, params: unknown) => ({ p: 'bg-sdk', v: 1, kind: 'req', id: 1, method, params });
  it('accepts well-formed requests', () => {
    expect(parseRequest(msg('game.event', { name: 'gameplay_start' }))).toMatchObject({ method: 'game.event', params: { name: 'gameplay_start' } });
    expect(parseRequest(msg('lb.submit', { board: 'main', score: 10 }))).toMatchObject({ params: { score: 10 } });
  });
  it('drops anything else', () => {
    expect(parseRequest({ p: 'other' })).toBeNull();
    expect(parseRequest(msg('eval', { code: 'alert(1)' }))).toBeNull();
    expect(parseRequest('string')).toBeNull();
  });
  it('rejects bad parameters without throwing', () => {
    expect(parseRequest(msg('game.event', { name: 'hack' }))?.params).toBeUndefined();
    expect(parseRequest(msg('data.set', { key: '../../etc', value: 1 }))?.params).toBeUndefined();
    expect(parseRequest(msg('lb.submit', { board: 'main', score: Number.POSITIVE_INFINITY }))?.params).toBeUndefined();
    expect(parseRequest(msg('game.context', { context: { big: 'x'.repeat(5000) } }))?.params).toBeUndefined();
  });
});

describe('KPIs', () => {
  const ev = (anon: string, session: string, type: string, day: string, payload: Record<string, unknown> = {}): KpiEvent => ({
    anonId: anon, sessionId: session, gameId: 'g', type, ts: `${day}T10:00:00.000Z`, payload, country: 'IN',
  });
  const events = [
    ev('a', 's1', 'play_click', '2026-11-01'),
    ev('a', 's1', 'gameplay_stop', '2026-11-01', { t: 90 }),
    ev('a', 's1', 'loading_stop', '2026-11-01', { ms: 1200 }),
    ev('b', 's2', 'play_click', '2026-11-01'),
    ev('b', 's2', 'gameplay_stop', '2026-11-01', { t: 30 }),
    ev('b', 's2', 'ad_started', '2026-11-01'),
    ev('a', 's3', 'play_click', '2026-11-02'),
    ev('a', 's3', 'session_end', '2026-11-02', { t: 400 }),
  ];
  it('computes plays, conversion, session length and D1 retention', () => {
    const days = computeDailyKpis(events, [], 'g', '2026-11-01', '2026-11-02');
    expect(days[0]).toMatchObject({ plays: 2, players: 2, newPlayers: 2, conversion1min: 0.5, avgSessionSec: 60, d1Retention: 0.5, adImpressions: 1, loadMsP50: 1200 });
    expect(days[1]).toMatchObject({ plays: 1, newPlayers: 0, conversion1min: 1 });
    const s = summarise(days);
    expect(s.plays).toBe(3);
    expect(s.conversion).toBeCloseTo(2 / 3);
  });
  it('ranks against category peers and grades against the benchmarks', () => {
    expect(percentRank(0.9, [0.9, 0.5, 0.2])).toBe(1);
    expect(percentRank(0.2, [0.9, 0.5, 0.2])).toBe(0);
    expect(grade('conversion', 0.85)).toBe('great');
    expect(grade('d1', 0.07)).toBe('ok');
    expect(grade('avgSessionSec', 100)).toBe('low');
  });
  it('explains a Spark decline with the weakest KPI', () => {
    const verdict = sparkVerdict({ ...summarise([]), conversion: 0.85, d1: 0.02, avgSessionSec: 700 }, true);
    expect(verdict.recommend).toBe('decline');
    expect(verdict.shortfall?.metric).toBe('d1');
    expect(verdict.reason).toContain('Day-1 retention was 2%');
    expect(sparkVerdict({ ...summarise([]), conversion: 0.9, d1: 0.12, avgSessionSec: 700 }, false).recommend).toBe('decline');
    expect(sparkVerdict({ ...summarise([]), conversion: 0.9, d1: 0.12, avgSessionSec: 700 }, true).recommend).toBe('promote');
  });
});

describe('build validation', () => {
  const f = (path: string, size = 100) => ({ path, size, dir: false });
  it('accepts a normal build and strips one wrapping folder', () => {
    const v = validateBuild([f('MyGame/index.html'), f('MyGame/js/game.js'), f('MyGame/assets/a.png'), f('__MACOSX/x'), { path: 'MyGame/', size: 0, dir: true }]);
    expect(v.ok).toBe(true);
    expect(v.files.map((x) => x.path)).toEqual(['index.html', 'js/game.js', 'assets/a.png']);
  });
  it('rejects traversal, absolute paths, symlinks, executables and missing index.html', () => {
    expect(validateBuild([f('index.html'), f('../evil.js')]).errors.join()).toContain('Path traversal');
    expect(validateBuild([f('index.html'), f('/abs.js')]).errors.join()).toContain('Absolute path');
    expect(validateBuild([f('index.html'), { ...f('link.js'), unixPermissions: 0o120777 }]).errors.join()).toContain('Symbolic links');
    expect(validateBuild([f('index.html'), f('setup.exe')]).errors.join()).toContain('Executable');
    expect(validateBuild([f('index.html'), f('server.php')]).ok).toBe(false);
    expect(validateBuild([f('game.html')]).errors.join()).toContain('index.html');
  });
  it('enforces 250 MB, 1,500 files and 50 MB a file', () => {
    expect(validateBuild([f('index.html', 251 * 1024 * 1024)]).ok).toBe(false);
    const big = validateBuild([f('index.html'), f('Build/game.data', 51 * 1024 * 1024)]);
    expect(big.ok).toBe(false);
    expect(big.errors.join()).toContain('Build/game.data');
    expect(validateBuild([f('index.html'), f('Build/game.data', 49 * 1024 * 1024)]).ok).toBe(true);
    expect(validateBuild([f('index.html'), ...Array.from({ length: 1500 }, (_, i) => f(`a/${i}.png`))]).ok).toBe(false);
  });
  it('finds the SDK and absolute paths in HTML', () => {
    expect(mentionsSdk('<script src="https://x/sdk/v1/bg-sdk.js"></script>')).toBe(true);
    expect(mentionsSdk('await BG.init();')).toBe(true);
    expect(mentionsSdk('nothing here')).toBe(false);
    expect(findAbsolutePaths('<img src="/a.png"><script src="js/b.js"></script><a href="//cdn.x/y">')).toEqual(['/a.png']);
  });
});

describe('pre-QA scoring', () => {
  const run = (over: Partial<PreQaRun> = {}): PreQaRun => ({
    device: 'desktop', initialBytes: 2_000_000, timeToGameplayMs: 3000, events: ['loading_start', 'loading_stop', 'gameplay_start'],
    consoleErrors: [], absolute404s: [], externalAds: [], screenshot: null, crashed: false, ...over,
  });
  it('passes a clean build', () => {
    expect(scorePreQa('u', { desktop: run(), mobile: run({ device: 'mobile' }) }).status).toBe('pass');
  });
  it('fails slow, absolute-path and ad-network builds with a fix for each', () => {
    const slow = scorePreQa('u', { desktop: run({ timeToGameplayMs: 25_000 }), mobile: run({ device: 'mobile' }) });
    expect(slow.status).toBe('fail');
    expect(slow.checks.find((c) => c.id === 'time-to-gameplay')?.fix).toBeTruthy();
    expect(scorePreQa('u', { desktop: run({ absolute404s: ['/a.png'] }), mobile: null }).status).toBe('fail');
    expect(scorePreQa('u', { desktop: run({ externalAds: ['doubleclick.net'] }), mobile: null }).status).toBe('fail');
  });
  it('warns when the SDK is missing', () => {
    const r = scorePreQa('u', { desktop: run({ events: [], timeToGameplayMs: null }), mobile: null });
    expect(r.status).toBe('warn');
    expect(r.usesSdk).toBe(false);
  });
  it('recognises ad networks', () => {
    expect(isAdNetwork('https://securepubads.g.doubleclick.net/tag/js/gpt.js')).toBe(true);
    expect(isAdNetwork('https://cdn.example.com/game.js')).toBe(false);
  });
});
