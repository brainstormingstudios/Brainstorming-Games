import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/domain/safeNext';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/dev/games/view/?id=1#versions')).toBe('/dev/games/view/?id=1#versions');
    expect(safeNext('/')).toBe('/');
  });

  it('never sends a player to another website', () => {
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%5Cevil.example',
      '/%2F%2Fevil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      'javascript:alert(1)',
      '/%E0%A4%A',
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});
