// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { codeMakesPasswordFields, findCredentialFields, isMiningUrl, scanForMiner, scorePreQa, type PreQaRun } from '@/lib/domain/preqa';

/*
 * No malware samples here on purpose: the scoring is tested with plain labels, and the scanners
 * only with honest game code. Detection of real miners is verified online after launch.
 */
const run = (extra: Partial<PreQaRun> = {}): PreQaRun => ({
  device: 'desktop',
  initialBytes: 1000,
  timeToGameplayMs: 2000,
  events: ['loading_start', 'loading_stop', 'gameplay_start'],
  calls: ['hello'],
  consoleErrors: [],
  absolute404s: [],
  externalAds: [],
  screenshot: null,
  crashed: false,
  ...extra,
});
const check = (r: ReturnType<typeof scorePreQa>, id: string) => r.checks.find((c) => c.id === id)!;

describe('pre-QA: crypto-mining', () => {
  it('leaves honest game code alone', () => {
    // Placeholder rules: the real lists are online-only secrets.
    const rules = { hosts: ['pool.test-only.invalid'], signatures: ['test-only-marker'] };
    expect(scanForMiner('let randomX = Math.random(); const crypto = window.crypto; mine(); // dig for gold', rules)).toEqual([]);
    expect(scanForMiner('/* test-only-marker */', rules)).toEqual(['test-only-marker']);
    expect(isMiningUrl('https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js', rules)).toBe(false);
    expect(isMiningUrl('wss://pool.test-only.invalid/', rules)).toBe(true);
  });

  it('fails the build when the bot reports a mining signal', () => {
    const r = scorePreQa('u', { desktop: run({ miningSignals: ['test signal'] }), mobile: run() });
    expect(check(r, 'no-mining').status).toBe('fail');
    expect(r.status).toBe('fail');
    expect(check(scorePreQa('u', { desktop: run(), mobile: run() }), 'no-mining').status).toBe('pass');
  });
});

describe('pre-QA: password and card fields', () => {
  it('finds sensitive fields and ignores ordinary ones', () => {
    document.body.innerHTML = `<input type="password"><input autocomplete="cc-number"><input type="hidden" name="password">`;
    expect(findCredentialFields(document).sort()).toEqual(['password field', 'payment card field (cc-number)']);
    document.body.innerHTML = `<input name="player" placeholder="Your name"><input type="range">`;
    expect(findCredentialFields(document)).toEqual([]);
  });

  it('fails when shown, warns when only the code can make one', () => {
    expect(check(scorePreQa('u', { desktop: run({ credentialFields: ['password field'] }), mobile: run() }), 'no-credentials').status).toBe('fail');
    expect(check(scorePreQa('u', { desktop: run({ passwordInCode: true }), mobile: run() }), 'no-credentials').status).toBe('warn');
    expect(codeMakesPasswordFields(`const msg = "Forgot your password?"`)).toBe(false);
  });
});
