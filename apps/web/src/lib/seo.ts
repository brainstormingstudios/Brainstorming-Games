import type { Metadata } from 'next';
import { defaultLocale, localeTags, locales, localizePath, ogLocales, type Locale } from '@/i18n/config';
import { SITE_NAME, SITE_URL } from '@/lib/config';

export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export interface PageMetaInput {
  locale: Locale;
  /** App path without a locale prefix, e.g. `/game/my-game`. */
  path: string;
  title: string;
  description?: string;
  /** Absolute or site-relative image URL for Open Graph and X cards. */
  image?: string;
  noindex?: boolean;
  /** Use the title exactly as given instead of appending the site name. */
  absoluteTitle?: boolean;
  type?: 'website' | 'article';
}

/** Canonical URL, hreflang alternates and social cards for one page. */
export function pageMetadata({
  locale,
  path,
  title,
  description,
  image = '/brand/og-default.png',
  noindex = false,
  absoluteTitle = false,
  type = 'website',
}: PageMetaInput): Metadata {
  const canonical = localizePath(path, locale);
  const languages: Record<string, string> = {};
  for (const l of locales) languages[localeTags[l]] = localizePath(path, l);
  languages['x-default'] = localizePath(path, defaultLocale);
  const fullTitle = absoluteTitle ? title : `${title} – ${SITE_NAME}`;
  const imageUrl = image.startsWith('http') ? image : absoluteUrl(image);
  return {
    title: { absolute: fullTitle },
    description,
    alternates: noindex ? undefined : { canonical, languages },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type,
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      url: canonical,
      locale: ogLocales[locale],
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [imageUrl] },
  };
}

/** Serialises JSON-LD safely for a <script> tag (no `</script>` break-out). */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
