import { describe, expect, it } from 'vitest';
import { gameLabel, gamePlayUrl, isGameOrigin, labelToFolder, validPattern } from '@/lib/play/gameOrigin';
// @ts-expect-error plain JS module shared by the Node scripts and the Worker
import * as js from '../../scripts/lib/game-origin.mjs';

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const P = 'https://{game}.bgplay.net';

describe('game origins', () => {
  it('gives every game its own origin', () => {
    expect(gamePlayUrl(`${ID}/1.2/index.html`, P, 'https://play.example')).toBe('https://g-3f2a9c1e5b7d4e8f9a0b1c2d3e4f5a6b.bgplay.net/1.2/index.html');
    expect(gamePlayUrl('originals/star-catcher/index.html', P, 'x')).toBe('https://o-star-catcher.bgplay.net/index.html');
    expect(gamePlayUrl(`${ID}/1/index.html`, '', 'https://play.example')).toBe(`https://play.example/${ID}/1/index.html`);
  });

  it('maps labels back to exactly one folder, in the site and the server alike', () => {
    for (const path of [`${ID}/1/index.html`, 'originals/star-catcher/index.html', 'e2e-probe-12/index.html']) {
      const g = gameLabel(path)!;
      const folder = labelToFolder(g.label);
      expect(`${folder}/${g.rest}`).toBe(path);
      expect(js.labelToFolder(g.label)).toBe(folder);
    }
    for (const bad of ['media', 'g-media', 'g-originals', 'x-abc', 'g-', 'o-', 'g-UPPER', 'g--a', 'g-a.b']) {
      expect(labelToFolder(bad)).toBeNull();
      expect(js.labelToFolder(bad)).toBeNull();
    }
    expect(gameLabel('media/x/y.webp')).toBeNull();
  });

  it('never lets a game origin read outside its own folder', () => {
    const label = gameLabel(`${ID}/1/index.html`)!.label;
    expect(js.gameKey(label, '/1/index.html')).toBe(`${ID}/1/index.html`);
    expect(js.gameKey(label, '/1/')).toBe(`${ID}/1/index.html`);
    for (const bad of ['/../other/1/index.html', '/1/%2e%2e/%2e%2e/other/x.js', '/1//x.js', '/1/a%5Cb.js', '/1/%00.js', '/./x']) {
      expect(js.gameKey(label, bad), bad).toBeNull();
    }
  });

  it('only accepts proper patterns and origins', () => {
    expect(validPattern(P)).toBe(true);
    expect(validPattern('https://bgplay.net/{game}')).toBe(false);
    expect(js.validPattern('https://{game}.bgplay.net')).toBe(true);
    expect(isGameOrigin('https://g-3f2a9c1e5b7d4e8f9a0b1c2d3e4f5a6b.bgplay.net', P)).toBe(true);
    expect(isGameOrigin('https://evil.bgplay.net', P)).toBe(false);
    expect(isGameOrigin('https://g-a.bgplay.net.evil.com', P)).toBe(false);
    expect(js.defaultPattern('http://localhost:4100')).toBe('http://{game}.localhost:4100');
  });

  it('sitelocks game pages and strips powerful features', () => {
    const h = js.gameHeaders('text/html; charset=utf-8', ['https://brainstorming.games']);
    expect(h['content-security-policy']).toContain('frame-ancestors https://brainstorming.games');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(js.gameHeaders('text/javascript', [])['content-security-policy']).toBeUndefined();
  });
});
