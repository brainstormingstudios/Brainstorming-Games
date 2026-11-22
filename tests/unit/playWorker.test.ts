import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS Worker module
import { handle } from '../../workers/play/index.mjs';

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const LABEL = 'g-3f2a9c1e5b7d4e8f9a0b1c2d3e4f5a6b';
const OTHER = '9f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const files: Record<string, string> = {
  [`${ID}/1/index.html`]: '<h1>game</h1>',
  [`${ID}/1/game.js`]: 'console.log(1)',
  [`${OTHER}/1/secret.js`]: 'other game',
};
const env = {
  GAMES_DOMAIN: 'bgplay.example',
  SITE_ORIGINS: 'https://brainstorming.example',
  BUILDS: {
    get: async (key: string) => (key in files ? { body: files[key], size: files[key]!.length, httpEtag: '"e1"' } : null),
  },
};
const get = (url: string, init?: RequestInit) => handle(new Request(url, init), env) as Promise<Response>;

describe('game origins Worker', () => {
  it('serves a game from its own origin with the sitelock', async () => {
    const res = await get(`https://${LABEL}.bgplay.example/1/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>game</h1>');
    expect(res.headers.get('content-security-policy')).toContain('frame-ancestors https://brainstorming.example');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const js = await get(`https://${LABEL}.bgplay.example/1/game.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
  });

  it('never serves another game, a traversal or anything outside the games domain', async () => {
    for (const url of [
      `https://${LABEL}.bgplay.example/../${OTHER}/1/secret.js`,
      `https://${LABEL}.bgplay.example/1/%2e%2e/%2e%2e/${OTHER}/1/secret.js`,
      `https://g-media.bgplay.example/x.webp`,
      `https://a.${LABEL}.bgplay.example/1/index.html`,
      `https://${LABEL}.evil.example/1/index.html`,
      `https://${LABEL}.bgplay.example/1/missing.js`,
      `https://${LABEL}.bgplay.example/1/index.php`,
    ]) {
      expect((await get(url)).status, url).toBe(404);
    }
    expect((await get(`https://${LABEL}.bgplay.example/1/game.js`, { method: 'PUT', body: 'x' })).status).toBe(405);
  });

  it('answers repeat visits from the browser cache', async () => {
    const res = await get(`https://${LABEL}.bgplay.example/1/game.js`, { headers: { 'if-none-match': '"e1"' } });
    expect(res.status).toBe(304);
  });
});
