'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Gauge, Languages, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';
import { IconButton, cn, useToast } from '@brainstorming/ui';
import { localeNames, locales, localizePath, splitLocale } from '@/i18n/config';
import { useLocale } from '@/i18n/navigation';
import { setPrefs, usePrefs } from '@/lib/prefs';

export function LowDataToggle() {
  const t = useTranslations('shell');
  const toast = useToast();
  const { lowData } = usePrefs();
  return (
    <IconButton
      label={lowData ? t('lowDataOn') : t('lowDataOff')}
      aria-pressed={lowData}
      active={lowData}
      data-testid="low-data-toggle"
      onClick={() => {
        setPrefs({ lowData: !lowData });
        toast(lowData ? t('lowDataTurnedOff') : t('lowDataTurnedOn'));
      }}
    >
      <Gauge aria-hidden="true" className="size-5" />
    </IconButton>
  );
}

export function ThemeToggle() {
  const t = useTranslations('shell');
  const { theme } = usePrefs();
  const dark = theme === 'dark';
  return (
    <IconButton
      label={dark ? t('themeToLight') : t('themeToDark')}
      data-testid="theme-toggle"
      onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
    >
      {dark ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
    </IconButton>
  );
}

/** Links to the same page in each language. A plain link: the two trees have different roots. */
export function LocaleSwitch({ className }: { className?: string }) {
  const t = useTranslations('shell');
  const current = useLocale();
  const pathname = usePathname() ?? '/';
  const { path } = splitLocale(pathname);
  // Nothing to switch between while the site has one language.
  if (locales.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn('flex h-11 items-center gap-0.5 rounded-control border border-border bg-surface-3 p-1', className)}
    >
      <Languages aria-hidden="true" className="mx-1.5 hidden size-4 text-fg-muted lg:block" />
      {locales.map((l) => (
        <a
          key={l}
          href={localizePath(path, l)}
          hrefLang={l}
          lang={l}
          aria-current={l === current ? 'true' : undefined}
          data-testid={`locale-${l}`}
          className={cn(
            'flex h-full items-center rounded-[9px] px-2.5 text-sm font-bold',
            l === current ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          {localeNames[l]}
        </a>
      ))}
    </div>
  );
}

export function SidebarToggle() {
  const t = useTranslations('shell');
  const { sidebarCollapsed } = usePrefs();
  return (
    <IconButton
      label={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
      aria-expanded={!sidebarCollapsed}
      className="hidden lg:inline-flex"
      data-testid="sidebar-toggle"
      onClick={() => setPrefs({ sidebarCollapsed: !sidebarCollapsed })}
    >
      {sidebarCollapsed ? (
        <PanelLeftOpen aria-hidden="true" className="size-5" />
      ) : (
        <PanelLeftClose aria-hidden="true" className="size-5" />
      )}
    </IconButton>
  );
}

/** The header's switches, repeated inside the mobile menu where the header has no room. */
export function SettingsToggles({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <LocaleSwitch />
      <LowDataToggle />
      <ThemeToggle />
    </div>
  );
}
