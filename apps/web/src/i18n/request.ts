import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale } from './config';

type Messages = Record<string, unknown>;

/** Missing keys fall back to English (the staff-only admin namespace is English-only). */
function withFallback(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const b = base[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object'
        ? withFallback(b as Messages, v as Messages)
        : v;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;
  const english = (await import('../../messages/en.json')).default as Messages;
  const messages =
    locale === defaultLocale
      ? english
      : withFallback(english, (await import(`../../messages/${locale}.json`)).default as Messages);
  return {
    locale,
    messages,
    // Static export: there is no request clock, so pin one for deterministic output.
    timeZone: 'Asia/Kolkata',
  };
});
