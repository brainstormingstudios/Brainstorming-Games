import { describe, expect, it } from 'vitest';
import { isLookerEmbedUrl, normaliseLookerUrl } from '@/lib/domain/analytics';

describe('Looker Studio links', () => {
  const want = 'https://lookerstudio.google.com/embed/reporting/d10119ed-ca95-4bd0-a477-eef6f12ebfaf/page/cFZEG';

  it('turns an old Data Studio link (even with a stray colon) into the embed link', () => {
    expect(normaliseLookerUrl('https://datastudio.google.com:/embed/reporting/d10119ed-ca95-4bd0-a477-eef6f12ebfaf/page/cFZEG')).toBe(want);
    expect(normaliseLookerUrl(' https://datastudio.google.com/embed/reporting/d10119ed-ca95-4bd0-a477-eef6f12ebfaf/page/cFZEG ')).toBe(want);
  });

  it('accepts the whole iframe code and a normal report link', () => {
    expect(normaliseLookerUrl(`<iframe width="600" height="450" src="${want}" frameborder="0" allowfullscreen></iframe>`)).toBe(want);
    expect(normaliseLookerUrl('https://lookerstudio.google.com/reporting/d10119ed-ca95-4bd0-a477-eef6f12ebfaf/page/cFZEG')).toBe(want);
  });

  it('still refuses other sites', () => {
    expect(isLookerEmbedUrl(normaliseLookerUrl('https://evil.example/embed/x'))).toBe(false);
    expect(isLookerEmbedUrl(want)).toBe(true);
  });
});
