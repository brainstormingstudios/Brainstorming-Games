'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  BookOpen,
  Bug,
  CalendarDays,
  Clapperboard,
  ClipboardCheck,
  CreditCard,
  Mail,
  Database,
  ExternalLink,
  Gamepad2,
  Home,
  LayoutDashboard,
  Megaphone,
  PlusCircle,
  Rocket,
  BadgeCheck,
  ScrollText,
  ShieldAlert,
  Store,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ToastProvider, cn } from '@brainstorming/ui';
import { AccountMenu, LoginDialog } from '@/components/auth/AccountMenu';
import { Logo } from '@/components/shell/Logo';
import { ThemeToggle } from '@/components/shell/SettingsToggles';
import { Link } from '@/i18n/navigation';
import { productPath } from '@/lib/sites';

export type PortalKind = 'developers' | 'manage';

interface PortalNavItem {
  /** Message key under `dev.nav` or `admin.nav`. */
  key: string;
  /** Product path (`/dev/...`, `/admin/...`, or a player-site path). */
  href: string;
  icon: LucideIcon;
  /** Also active on these path prefixes. */
  match?: string[];
}

const NAV: Record<PortalKind, PortalNavItem[]> = {
  developers: [
    { key: 'dashboard', href: '/dev', icon: LayoutDashboard, match: ['/dev/games/view', '/dev/games/edit', '/dev/games/kpi'] },
    { key: 'newGame', href: '/dev/games/new', icon: PlusCircle },
    { key: 'feedback', href: '/dev/feedback', icon: Bug },
    { key: 'devlogs', href: '/dev/devlogs', icon: Megaphone },
    { key: 'studio', href: '/dev/studio', icon: Store },
    { key: 'boost', href: '/dev/boost', icon: Rocket },
    { key: 'verified', href: '/dev/verified', icon: BadgeCheck },
    { key: 'payouts', href: '/dev/payouts', icon: Wallet },
    { key: 'jams', href: '/jams', icon: CalendarDays },
    { key: 'docs', href: '/dev/docs/quick-start', icon: BookOpen, match: ['/dev/docs'] },
  ],
  manage: [
    { key: 'overview', href: '/admin', icon: LayoutDashboard },
    { key: 'qa', href: '/admin/qa', icon: ClipboardCheck },
    { key: 'spark', href: '/admin/spark', icon: Rocket },
    { key: 'games', href: '/admin/games', icon: Gamepad2 },
    { key: 'featured', href: '/admin/home', icon: Home },
    { key: 'jams', href: '/admin/jams', icon: CalendarDays },
    { key: 'moderation', href: '/admin/moderation', icon: ShieldAlert },
    { key: 'progression', href: '/admin/progression', icon: Target },
    { key: 'promotions', href: '/admin/promotions', icon: Megaphone },
    { key: 'creators', href: '/admin/creators', icon: Clapperboard },
    { key: 'payments', href: '/admin/payments', icon: CreditCard },
    { key: 'revenue', href: '/admin/revenue', icon: BarChart3 },
    { key: 'emails', href: '/admin/emails', icon: Mail },
    { key: 'database', href: '/admin/database', icon: Database },
    { key: 'audit', href: '/admin/audit', icon: ScrollText },
  ],
};

const ROOT: Record<PortalKind, string> = { developers: '/dev', manage: '/admin' };

function PortalNav({ kind }: { kind: PortalKind }) {
  const t = useTranslations(kind === 'developers' ? 'dev.nav' : 'admin.nav');
  const current = productPath((usePathname() ?? '/').replace(/\/+$/, '') || '/');
  const isActive = (item: PortalNavItem) => {
    if (item.href === ROOT[kind]) return current === item.href || (item.match ?? []).some((m) => current.startsWith(m));
    return current.startsWith(item.href) || (item.match ?? []).some((m) => current.startsWith(m));
  };
  return (
    <nav aria-label={t('label')} className="portal-nav" data-testid="portal-nav">
      {NAV[kind].map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        const external = !item.href.startsWith(ROOT[kind]);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            data-testid={`nav-${item.key}`}
            className={cn('portal-nav-link', active && 'is-active')}
          >
            <Icon aria-hidden="true" className="size-[18px] shrink-0" />
            <span className="truncate">{t(item.key as 'label')}</span>
            {external ? <ExternalLink aria-hidden="true" className="ml-auto hidden size-3.5 opacity-60 lg:block" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The frame of the two private portals: a brand bar, a side navigation and the page. The player
 * site's chrome (search, categories, ads, mascot greeting) is deliberately absent: these are
 * separate websites with their own job.
 */
export function PortalFrame({ kind, dismissLabel, children }: { kind: PortalKind; dismissLabel: string; children: ReactNode }) {
  const t = useTranslations('portal');
  const tc = useTranslations('common');
  return (
    <ToastProvider dismissLabel={dismissLabel}>
      <a href="#main" className="skip-link">
        {tc('skipToContent')}
      </a>
      <div className="portal" data-portal={kind} data-testid={kind === 'developers' ? 'dev-portal' : 'admin-console'}>
        <header className="portal-bar">
          <Logo label={t(`${kind}.home`)} href={ROOT[kind]} tag={t(`${kind}.name`)} />
          <span className="ml-auto flex items-center gap-1.5">
            <Link href="/" className="portal-site-link" data-testid="open-player-site">
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">{t('playerSite')}</span>
            </Link>
            <ThemeToggle />
            <AccountMenu />
          </span>
        </header>
        <aside className="portal-side">
          <PortalNav kind={kind} />
        </aside>
        <main id="main" tabIndex={-1} className="portal-main">
          {children}
        </main>
      </div>
      <LoginDialog />
    </ToastProvider>
  );
}
