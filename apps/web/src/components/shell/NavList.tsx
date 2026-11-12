'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@brainstorming/ui';
import { splitLocale } from '@/i18n/config';
import { Link } from '@/i18n/navigation';
import { CATEGORIES } from '@/lib/catalogue/categories';
import { CATEGORY_ICONS, PRIMARY_NAV, TAGS_NAV, isActivePath, type NavItem } from './nav';

function Row({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: NavItem['icon'];
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        title={label}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'nav-row flex h-10 items-center gap-3 rounded-control px-3 text-[0.95rem] font-bold transition-colors',
          active
            ? 'bg-primary text-primary-fg'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <span className="nav-label truncate">{label}</span>
      </Link>
    </li>
  );
}

/** The full navigation: primary links, the 15 categories, then "All tags". */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const tc = useTranslations('categories');
  const { path } = splitLocale(usePathname() ?? '/');
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <Row
            key={item.key}
            href={item.href}
            label={t(item.key)}
            icon={item.icon}
            active={isActivePath(path, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      <p className="nav-heading mt-4 mb-1 px-3 text-xs font-extrabold tracking-wide text-fg-muted uppercase">
        {t('categories')}
      </p>
      <ul className="flex flex-col gap-0.5">
        {CATEGORIES.map((c) => (
          <Row
            key={c.slug}
            href={`/c/${c.slug}`}
            label={tc(`${c.slug}.name`)}
            icon={CATEGORY_ICONS[c.slug] ?? TAGS_NAV.icon}
            active={isActivePath(path, `/c/${c.slug}`)}
            onNavigate={onNavigate}
          />
        ))}
        <Row
          href={TAGS_NAV.href}
          label={t(TAGS_NAV.key)}
          icon={TAGS_NAV.icon}
          active={isActivePath(path, TAGS_NAV.href) || isActivePath(path, '/t')}
          onNavigate={onNavigate}
        />
      </ul>
    </>
  );
}
