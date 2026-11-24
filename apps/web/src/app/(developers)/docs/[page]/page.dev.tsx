import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { initLocale, type RouteParams } from '@/i18n/server';
import { Markdown } from '@/lib/domain/markdown';
import { pageMetadata } from '@/lib/seo';

/** Developer docs. Public (developers read them before signing up) and indexed. */
const DOCS = [
  { slug: 'quick-start', title: 'Quick start', file: '../../docs/SDK.md' },
  { slug: 'sdk-rules', title: 'SDK rules', file: '../../docs/SDK_RULES.md' },
  { slug: 'sdk-reference', title: 'SDK reference', file: 'src/generated/sdk-reference.md' },
  { slug: 'ad-rules', title: 'Ad rules', file: 'content/docs/ad-rules.md' },
  { slug: 'requirements', title: 'Requirements', file: 'content/docs/requirements.md' },
  { slug: 'covers', title: 'Cover specs', file: 'content/docs/covers.md' },
  { slug: 'launch-tiers', title: 'Launch tiers', file: 'content/docs/launch-tiers.md' },
  { slug: 'faq', title: 'FAQ', file: 'content/docs/faq.md' },
] as const;

type Params = RouteParams<{ page: string }>;

export function generateStaticParams() {
  return DOCS.map((d) => ({ page: d.slug }));
}

export const dynamicParams = false;

function load(slug: string): { title: string; body: string } | null {
  const doc = DOCS.find((d) => d.slug === slug);
  if (!doc) return null;
  const path = join(process.cwd(), doc.file);
  if (!existsSync(path)) return { title: doc.title, body: 'This page is generated during the build.' };
  return { title: doc.title, body: readFileSync(path, 'utf8').replace(/^# .*\n+/, '') };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, page } = await initLocale(params);
  const doc = load(page);
  if (!doc) return {};
  return pageMetadata({ locale, path: `/dev/docs/${page}`, title: `${doc.title} – Developer docs` });
}

export default async function DocPage({ params }: { params: Params }) {
  const { page } = await initLocale(params);
  const doc = load(page);
  if (!doc) notFound();
  return (
    <div className="page" data-testid="dev-docs">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Developer docs" className="min-w-0 lg:sticky lg:top-20 lg:h-fit">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {DOCS.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/dev/docs/${d.slug}`}
                  aria-current={d.slug === page ? 'page' : undefined}
                  className={`block rounded-control px-3 py-2 text-sm font-bold whitespace-nowrap ${d.slug === page ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose-bg min-w-0 max-w-3xl" lang="en">
          <h1 className="text-3xl font-bold">{doc.title}</h1>
          <Markdown source={doc.body} baseHeading={2} />
        </article>
      </div>
    </div>
  );
}
