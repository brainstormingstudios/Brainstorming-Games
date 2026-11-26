import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CookieChoicesButton } from '@/components/ads/ConsentBanner';
import { defaultLocale, type Locale } from '@/i18n/config';
import { initLocale, type RouteParams } from '@/i18n/server';
import { CONTACT_EMAIL } from '@/lib/config';
import { Markdown } from '@/lib/domain/markdown';
import { pageMetadata } from '@/lib/seo';

export type PolicySlug =
  | 'about'
  | 'contact'
  | 'parents'
  | 'school-safe'
  | 'terms'
  | 'privacy'
  | 'developer-terms'
  | 'cookies';

/** The three legal documents live in /docs so there is exactly one copy of each. */
const REPO_DOCS: Partial<Record<PolicySlug, string>> = {
  terms: 'PLAYER_TERMS.md',
  privacy: 'PRIVACY.md',
  'developer-terms': 'DEVELOPER_TERMS.md',
};


const WEB_ROOT = process.cwd();

function load(slug: PolicySlug, locale: Locale): { source: string; translated: boolean } {
  const candidates: { file: string; translated: boolean }[] = [];
  if (locale !== defaultLocale) {
    candidates.push({ file: join(WEB_ROOT, 'content', 'policies', locale, `${slug}.md`), translated: true });
  }
  const doc = REPO_DOCS[slug];
  candidates.push({
    file: doc ? join(WEB_ROOT, '..', '..', 'docs', doc) : join(WEB_ROOT, 'content', 'policies', `${slug}.md`),
    translated: locale === defaultLocale,
  });
  for (const c of candidates) {
    if (existsSync(c.file)) return { source: readFileSync(c.file, 'utf8'), translated: c.translated };
  }
  throw new Error(`Policy content missing for "${slug}"`);
}

/** Splits `# Title` and an optional `Last updated: ...` line off the top of a document. */
function splitDoc(source: string) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let updated: string | null = null;
  let i = 0;
  if (lines[i]?.startsWith('# ')) i++;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const m = /^_?Last updated:\s*(.+?)_?$/i.exec(lines[i]?.trim() ?? '');
  if (m) {
    updated = m[1]!;
    i++;
  }
  const body = lines
    .slice(i)
    .join('\n')
    .replaceAll('{{CONTACT_EMAIL}}', CONTACT_EMAIL || 'the address on our Contact page');
  return { updated, body };
}

export function createPolicyPage(slug: PolicySlug) {
  async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
    const { locale } = await initLocale(params);
    const t = await getTranslations({ locale, namespace: 'policy' });
    return pageMetadata({ locale, path: `/${slug}`, title: t(`titles.${slug}`) });
  }

  async function Page({ params }: { params: RouteParams }) {
    const { locale } = await initLocale(params);
    const t = await getTranslations({ locale, namespace: 'policy' });
    const { source, translated } = load(slug, locale);
    const { updated, body } = splitDoc(source);
    return (
      <article className="page max-w-3xl!" data-testid="policy-page">
        <h1 className="text-3xl font-bold sm:text-4xl">{t(`titles.${slug}`)}</h1>
        {updated ? <p className="mt-1 text-sm text-fg-muted">{t('updated', { date: updated })}</p> : null}
        {!translated ? <p className="mt-3 text-sm text-fg-muted">{t('englishOnly')}</p> : null}
        <div className="prose-bg mt-2" lang={translated ? undefined : 'en'}>
          <Markdown source={body} baseHeading={2} />
        </div>
        <p className="mt-8 border-t border-border pt-4 text-sm text-fg-muted" data-testid="policy-copyright">
          {t('copyright')}
        </p>
        {slug === 'cookies' ? (
          <div className="mt-6">
            <CookieChoicesButton />
          </div>
        ) : null}
      </article>
    );
  }

  return { generateMetadata, Page };
}
