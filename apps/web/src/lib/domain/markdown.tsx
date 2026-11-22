import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe Markdown renderer for developer-written content (descriptions, tips, devlogs)
 * and our own docs.
 *
 * It builds React elements directly, so there is no HTML string and no `innerHTML`: raw HTML in
 * the source is shown as text, and links are limited to http(s), mailto and site-relative URLs.
 * Supported: headings, paragraphs, bold, italic, inline code, links, bullet and numbered lists,
 * block quotes, fenced code, tables and horizontal rules.
 */

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?![/\\])|#)/i;

export function isSafeUrl(url: string): boolean {
  const u = url.trim();
  // Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.com" would leave the site.
  for (let i = 0; i < u.length; i++) {
    const c = u.charCodeAt(i);
    if (c === 0x5c || c < 0x20 || c === 0x7f) return false;
  }
  return SAFE_URL.test(u);
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${n++}`;
    if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith('*')) {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const url = link?.[2] ?? '';
      if (link && isSafeUrl(url)) {
        const external = /^https?:/i.test(url);
        out.push(
          <a
            key={key}
            href={url}
            {...(external ? { target: '_blank', rel: 'nofollow ugc noopener noreferrer' } : {})}
          >
            {label}
          </a>,
        );
      } else {
        // Unsafe scheme (javascript:, data: ...): keep the text, drop the link.
        out.push(label);
      }
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface MarkdownOptions {
  /** Heading level that `#` maps to, so content never outranks the page's own headings. */
  baseHeading?: 2 | 3 | 4;
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'rule' };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i++]!);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(splitRow(lines[i++]!));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(re.exec(lines[i++]!)![1]!);
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,4})\s/.test(lines[i]!) &&
      !lines[i]!.trim().startsWith('```') &&
      !bullet.test(lines[i]!) &&
      !numbered.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!)
    ) {
      para.push(lines[i++]!.trim());
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

export function Markdown({ source, baseHeading = 3 }: { source: string } & MarkdownOptions) {
  const blocks = parseMarkdown(source);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.type) {
          case 'heading': {
            const level = Math.min(6, baseHeading + block.level - 1);
            const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
            // Headings get an id so pages can link to a section (`/developers/#launch-tiers`).
            const id = block.text
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, '-')
              .replace(/^-+|-+$/g, '');
            return (
              <Tag key={key} id={id || undefined}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={key}>{renderInline(block.text, key)}</p>;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={key}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={key} className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={`${key}-h${j}`} scope="col">
                          {renderInline(cell, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}-r${r}`}>
                        {row.map((cell, j) => (
                          <td key={`${key}-r${r}-${j}`}>{renderInline(cell, `${key}-r${r}-${j}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'rule':
            return <hr key={key} className="my-4 border-border" />;
          default:
            return <Fragment key={key} />;
        }
      })}
    </>
  );
}

/** Rough word count for the content editors' gentle minimums. */
export function wordCount(source: string): number {
  const words = source.replace(/[#*_`>|[\]()-]/g, ' ').match(/\S+/g);
  return words ? words.length : 0;
}
