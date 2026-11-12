'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Dialog, cn } from '@brainstorming/ui';
import { splitLocale } from '@/i18n/config';
import { Link } from '@/i18n/navigation';
import { NavList } from './NavList';
import { SettingsToggles } from './SettingsToggles';
import { TAB_NAV, isActivePath } from './nav';

/** Desktop sidebar. Its width and label visibility are pure CSS driven by `data-sidebar`. */
export function Sidebar() {
  const t = useTranslations('nav');
  return (
    <aside className="app-sidebar" data-testid="sidebar">
      <nav aria-label={t('primary')} className="h-full overflow-y-auto overscroll-contain px-2 py-3">
        <NavList />
      </nav>
    </aside>
  );
}

/** Mobile tab bar: four pinned destinations plus "More", which opens the full menu. */
export function BottomTabs() {
  const t = useTranslations('nav');
  const ts = useTranslations('shell');
  const { path } = splitLocale(usePathname() ?? '/');
  const [open, setOpen] = useState(false);
  const tabClass = (active: boolean) =>
    cn(
      'flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-bold',
      active ? 'text-primary light:text-navy-600' : 'text-fg-muted',
    );
  return (
    <>
      <nav aria-label={t('primary')} className="app-tabs" data-testid="bottom-tabs">
        {TAB_NAV.map((item) => {
          const active = isActivePath(path, item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              <item.icon aria-hidden="true" className="size-5" />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={tabClass(false)}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu aria-hidden="true" className="size-5" />
          <span>{t('more')}</span>
        </button>
      </nav>
      <Dialog open={open} onClose={() => setOpen(false)} title={ts('menu')} size="sm">
        <SettingsToggles className="mb-4" />
        <nav aria-label={t('categories')}>
          <NavList onNavigate={() => setOpen(false)} />
        </nav>
      </Dialog>
    </>
  );
}
