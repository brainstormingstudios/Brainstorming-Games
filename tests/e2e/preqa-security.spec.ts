import { expect, test } from './helpers';

/*
 * Security Phase 2 checks that need no malicious samples. The pre-QA crypto-miner and
 * phishing-form checks are verified online after launch, never with fake malware on this machine.
 */

test('every site sends its security headers, page policy and security.txt', async ({ request }) => {
  for (const site of ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']) {
    const txt = await request.get(`${site}/.well-known/security.txt`);
    expect(txt.ok(), site).toBeTruthy();
    expect(await txt.text()).toMatch(/^Contact: mailto:/m);
    const page = await request.get(`${site}/login/`);
    expect(page.headers()['x-frame-options']).toBe('DENY');
    expect(page.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers()['content-security-policy']).toContain('http://*.localhost:4100');
    // The page's own policy lists only its own inline scripts.
    expect(await page.text()).toMatch(/<meta http-equiv="Content-Security-Policy" data-bg-csp="" content="script-src 'self' 'wasm-unsafe-eval'[^"]*'sha256-/);
  }
});

test('a game origin serves only its own game, never the local tools', async ({ request }) => {
  expect((await request.get('http://o-project-homecoming.localhost:4100/__mock/db/table/users')).status()).toBe(404);
  expect((await request.get('http://g-e2e-x.localhost:4100/..%2F..%2Fpackage.json')).status()).toBe(404);
  expect((await request.put('http://g-e2e-x.localhost:4100/1/index.html', { data: 'x' })).status()).toBe(405);
  // The shared origin (local database and tools) never serves a game page.
  expect((await request.get('http://localhost:4100/originals/project-homecoming/index.html')).status()).toBe(404);
});
