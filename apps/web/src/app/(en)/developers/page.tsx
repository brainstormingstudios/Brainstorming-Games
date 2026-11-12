import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Mascot, buttonClass } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { initLocale, type RouteParams } from '@/i18n/server';
import { Markdown } from '@/lib/domain/markdown';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'developers' });
  return pageMetadata({ locale, path: '/developers', title: t('metaTitle'), description: t('metaDescription') });
}

function loadContent(locale: string): { source: string; translated: boolean } {
  const localized = join(process.cwd(), 'content', `developers.${locale}.md`);
  if (locale !== 'en' && existsSync(localized)) return { source: readFileSync(localized, 'utf8'), translated: true };
  return { source: readFileSync(join(process.cwd(), 'content', 'developers.md'), 'utf8'), translated: locale === 'en' };
}

/** Landing page for developers: the published revenue share, launch tiers, SDK and FAQ. */
export default async function DevelopersPage({ params }: { params: RouteParams }) {
  const { locale } = await initLocale(params);
  const t = await getTranslations({ locale, namespace: 'developers' });
  const { source, translated } = loadContent(locale);
  return (
    <div className="page" data-testid="developers-page">
      <header className="relative overflow-hidden rounded-card border border-border bg-linear-to-br from-navy-800 to-navy-600 px-5 py-8 text-white sm:px-9 sm:py-11">
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-3xl leading-tight font-bold sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 text-base text-white/90 sm:text-lg">{t('lead')}</p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/dev" className={buttonClass({ size: 'lg' })} data-testid="start-publishing">
              {t('cta')}
            </Link>
            <Link
              href="/dev/docs/quick-start"
              className={buttonClass({ size: 'lg', variant: 'outline', className: 'border-white/50 text-white hover:bg-white/10' })}
            >
              {t('docs')}
            </Link>
          </div>
        </div>
        <Mascot size={210} priority className="absolute -right-4 -bottom-8 hidden md:block lg:right-10 lg:bottom-3" />
      </header>
      <div className="prose-bg mx-auto mt-4 max-w-3xl" lang={translated ? undefined : 'en'}>
        <Markdown source={source} baseHeading={2} />
      </div>
      <section className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-between gap-4 rounded-card border border-border bg-surface p-5">
        <div>
          <h2 className="text-xl font-semibold">{t('footerCta')}</h2>
          <p className="text-sm text-fg-muted">{t('footerBody')}</p>
        </div>
        <Link href="/dev" className={buttonClass({ size: 'lg' })}>
          {t('cta')}
        </Link>
      </section>
    </div>
  );
}
