import { useLocale as useIntlLocale } from 'next-intl';
import type { ComponentProps } from 'react';
import { defaultLocale, isLocale, localizePath, type Locale } from './config';
import { IntentLink } from './IntentLink';

/** The active locale. Works in server and client components. */
export function useLocale(): Locale {
  const locale = useIntlLocale();
  return isLocale(locale) ? locale : defaultLocale;
}

export interface LinkProps extends Omit<ComponentProps<typeof IntentLink>, 'href' | 'locale'> {
  href: string;
  /** Link to another language version instead of the current one. */
  locale?: Locale;
  /**
   * Render a plain anchor (full page load, no prefetch). Use it for pages that are not part of
   * this build, such as a game published after the last deploy: the client router would 404 on
   * the missing payload before falling back.
   */
  hard?: boolean;
}

/**
 * Locale-aware link. Nothing loads in advance just because a link is on screen (mobile data);
 * the next page loads as soon as the visitor points at, focuses or touches the link (IntentLink).
 */
export function Link({ href, locale, hard, prefetch = false, children, ...rest }: LinkProps) {
  const current = useLocale();
  const target = localizePath(href, locale ?? current);
  if (hard) {
    return (
      <a href={target} {...(rest as ComponentProps<'a'>)}>
        {children}
      </a>
    );
  }
  return (
    <IntentLink href={target} prefetch={prefetch} {...rest}>
      {children}
    </IntentLink>
  );
}
