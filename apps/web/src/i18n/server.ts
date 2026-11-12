import { setRequestLocale } from 'next-intl/server';
import { defaultLocale, isLocale, type Locale } from './config';

/** Route params as Next passes them. `locale` is absent in the un-prefixed English tree. */
export type RouteParams<T extends Record<string, string> = Record<never, never>> = Promise<
  T & { locale?: string }
>;

/**
 * Every page and layout calls this first. It resolves the locale from the route and registers it
 * with next-intl, which is what keeps rendering static (no headers, no cookies).
 */
export async function initLocale<T extends Record<string, string>>(
  params: RouteParams<T>,
): Promise<T & { locale: Locale }> {
  const resolved = await params;
  const locale = isLocale(resolved.locale) ? resolved.locale : defaultLocale;
  setRequestLocale(locale);
  return { ...resolved, locale };
}
