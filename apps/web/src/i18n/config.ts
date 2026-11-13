/**
 * Locales. The site is English-only for now. English is served at the root (`/game/x/`); any
 * language added later is prefixed (`/xx/game/x/`): add it here, add `messages/<code>.json`
 * and run `npm run gen:routes`.
 */
export const locales = ['en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Locales that live under a URL prefix. */
export const prefixedLocales = locales.filter((l) => l !== defaultLocale) as Exclude<Locale, 'en'>[];

/** Names shown in the language switch, each in its own language. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
};

/** BCP 47 tags for `lang` and hreflang. */
export const localeTags: Record<Locale, string> = {
  en: 'en',
};

/** Open Graph locale codes. */
export const ogLocales: Record<Locale, string> = {
  en: 'en_US',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Splits a prefixed path (`/xx/game/x/`) into its locale and the rest. Unknown prefixes are part of the path. */
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
 * `localizePath('/game/x', 'en')` gives `/game/x/`. Query and hash are kept.
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
