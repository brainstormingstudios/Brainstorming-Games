import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS Worker module
import worker, { handle } from '../../workers/play/index.mjs';

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

  it('serves games on one shared address for the free launch, still folder by folder', async () => {
    const shared = { ...env, GAMES_DOMAIN: '', SHARED_HOST: 'bg-play.acct.workers.dev' };
    const ok = (await handle(new Request(`https://bg-play.acct.workers.dev/${ID}/1/game.js`), shared)) as Response;
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    for (const bad of [`/${ID}/1/%2e%2e/%2e%2e/x.js`, `/${ID}/1/a%5Cb.js`, '/media/x.webp', '/', '/package.json']) {
      expect(((await handle(new Request(`https://bg-play.acct.workers.dev${bad}`), shared)) as Response).status, bad).toBe(404);
    }
    // Another host is refused.
    expect(((await handle(new Request(`https://evil.example/${ID}/1/game.js`), shared)) as Response).status).toBe(404);
  });

  it('answers repeat visits from the browser cache', async () => {
    const res = await get(`https://${LABEL}.bgplay.example/1/game.js`, { headers: { 'if-none-match': '"e1"' } });
    expect(res.status).toBe(304);
  });

  describe('reading Supabase Storage (free launch)', () => {
    afterEach(() => vi.unstubAllGlobals());
    const supa = {
      GAMES_DOMAIN: '',
      SHARED_HOST: 'bg-play.acct.workers.dev',
      SITE_ORIGINS: 'https://brainstorming.example',
      SUPABASE_URL: 'https://proj.supabase.co/',
      SUPABASE_STORAGE_KEY: 'sb_secret_test',
    };
    const stubStorage = () => {
      const calls: { url: string; headers: Record<string, string> }[] = [];
      vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        const prefix = 'https://proj.supabase.co/storage/v1/object/authenticated/builds/';
        const key = decodeURIComponent(url.slice(prefix.length));
        if (!url.startsWith(prefix) || !(key in files)) return new Response('{"error":"not_found"}', { status: 400 });
        return new Response(files[key], { status: 200, headers: { etag: '"s1"', 'content-length': String(files[key]!.length) } });
      });
      return calls;
    };

    it('serves a file from the private builds bucket with the secret key', async () => {
      const calls = stubStorage();
      const res = (await handle(new Request(`https://bg-play.acct.workers.dev/${ID}/1/game.js`), supa)) as Response;
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('console.log(1)');
      expect(res.headers.get('etag')).toBe('"s1"');
      expect(res.headers.get('content-type')).toContain('text/javascript');
      expect(calls[0]!.url).toBe(`https://proj.supabase.co/storage/v1/object/authenticated/builds/${ID}/1/game.js`);
      expect(calls[0]!.headers).toEqual({ apikey: 'sb_secret_test' });
    });

    it('answers 404 for a missing file and 500 when storage is not set up', async () => {
      stubStorage();
      expect(((await handle(new Request(`https://bg-play.acct.workers.dev/${ID}/1/missing.js`), supa)) as Response).status).toBe(404);
      const res = (await worker.fetch(new Request(`https://bg-play.acct.workers.dev/${ID}/1/game.js`), { ...supa, SUPABASE_STORAGE_KEY: '' })) as Response;
      expect(res.status).toBe(500);
    });
  });
});
