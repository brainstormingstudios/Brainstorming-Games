import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SOCIAL_LINKS } from '@/lib/config';

interface FooterLink {
  key: string;
  href: string;
}

/** Links are added here as their pages ship, so every footer link always works. */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'play',
    links: [
      { key: 'nav.new', href: '/new' },
      { key: 'nav.trending', href: '/trending' },
      { key: 'nav.multiplayer', href: '/multiplayer' },
      { key: 'nav.allTags', href: '/tags' },
    ],
  },
  {
    title: 'company',
    links: [
      { key: 'footer.about', href: '/about' },
      { key: 'footer.parents', href: '/parents' },
      { key: 'footer.schoolSafe', href: '/school-safe' },
      { key: 'footer.contact', href: '/contact' },
    ],
  },
  {
    title: 'legal',
    links: [
      { key: 'footer.terms', href: '/terms' },
      { key: 'footer.privacy', href: '/privacy' },
      { key: 'footer.cookies', href: '/cookies' },
      { key: 'footer.developerTerms', href: '/developer-terms' },
    ],
  },
];

const SOCIAL_LABELS: Record<keyof typeof SOCIAL_LINKS, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  x: 'X',
  discord: 'Discord',
};

export function Footer() {
  const t = useTranslations();
  const social = (Object.keys(SOCIAL_LINKS) as (keyof typeof SOCIAL_LINKS)[]).filter((k) => SOCIAL_LINKS[k]);
  return (
    <footer aria-label={t('footer.label')} className="mt-12 border-t border-border bg-surface-3 px-4 py-8 sm:px-6">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 md:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="mb-2 text-sm font-semibold">{t(`footer.${col.title}`)}</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                    {t(l.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="font-display text-base font-semibold">{t('footer.tagline')}</p>
          {social.length > 0 ? (
            <>
              <h2 className="mt-4 mb-2 text-sm font-semibold">{t('footer.social')}</h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                {social.map((k) => (
                  <li key={k}>
                    <a
                      href={SOCIAL_LINKS[k]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                    >
                      {SOCIAL_LABELS[k]}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-6xl text-xs text-fg-muted">
        {t('footer.rights', { year: new Date().getUTCFullYear() })}
      </p>
    </footer>
  );
}
