import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, isSafeUrl, parseMarkdown, wordCount } from '@/lib/domain/markdown';

const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('markdown renderer', () => {
  it('renders the supported blocks', () => {
    const out = html('# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted');
    expect(out).toContain('<h3 id="title">Title</h3>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(out).toContain('<blockquote>quoted</blockquote>');
  });

  it('renders tables', () => {
    const out = html('| Source | Share |\n|---|---|\n| Ads | 70% of net |');
    expect(out).toContain('<th scope="col">Source</th>');
    expect(out).toContain('<td>70% of net</td>');
  });

  it('never lets raw HTML or script through', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('drops links with unsafe schemes but keeps their text', () => {
    const out = html('[click](javascript:alert(1)) and [data](data:text/html,x) and [ok](https://example.com)');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:text');
    expect(out).toContain('click');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="nofollow ugc noopener noreferrer"');
  });

  it('accepts only http, mailto, site-relative and anchor URLs', () => {
    expect(isSafeUrl('https://a.b')).toBe(true);
    expect(isSafeUrl('/privacy/')).toBe(true);
    expect(isSafeUrl('#faq')).toBe(true);
    expect(isSafeUrl('//evil.example')).toBe(false);
    expect(isSafeUrl(' JavaScript:alert(1)')).toBe(false);
  });

  it('parses fenced code without interpreting it', () => {
    expect(parseMarkdown('```\n**not bold**\n```')).toEqual([{ type: 'code', text: '**not bold**' }]);
    expect(wordCount('## Two words\n- and *three* more')).toBe(5);
  });
});
