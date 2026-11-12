/**
 * Locales. English is served at the root (`/game/x/`); every other locale is prefixed
 * (`/hi/game/x/`). To add a language: add it here, add `messages/<code>.json`, run
 * `npm run gen:routes`.
 */
export const locales = ['en', 'hi'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Locales that live under a URL prefix. */
export const prefixedLocales = locales.filter((l) => l !== defaultLocale) as Exclude<Locale, 'en'>[];

/** Names shown in the language switch, each in its own language. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
};

/** BCP 47 tags for `lang` and hreflang. */
export const localeTags: Record<Locale, string> = {
  en: 'en',
  hi: 'hi',
};

/** Open Graph locale codes. */
export const ogLocales: Record<Locale, string> = {
  en: 'en_US',
  hi: 'hi_IN',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Splits `/hi/game/x/` into `{ locale: 'hi', path: '/game/x/' }`. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  const first = match?.[1];
  if (first && first !== defaultLocale && isLocale(first)) {
    const rest = pathname.slice(first.length + 1);
    return { locale: first, path: rest === '' ? '/' : rest };
  }
  return { locale: defaultLocale, path: pathname === '' ? '/' : pathname };
}

/**
 * Turns an app path into a locale-aware href with a trailing slash:
 * `localizePath('/game/x', 'hi')` gives `/hi/game/x/`. Query and hash are kept.
 */
export function localizePath(path: string, locale: Locale): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) return path;
  const [, pathname = '/', suffix = ''] = /^([^?#]*)(.*)$/.exec(path) ?? [];
  let p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const lastSegment = p.slice(p.lastIndexOf('/') + 1);
  // Paths that end in a file name (`/sitemap.xml`) are left without a trailing slash.
  if (!p.endsWith('/') && !lastSegment.includes('.')) p += '/';
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  return `${prefix}${p}${suffix}`;
}
