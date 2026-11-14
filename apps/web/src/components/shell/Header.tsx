import { useTranslations } from 'next-intl';
import { AccountMenu } from '@/components/auth/AccountMenu';
import { HeaderChips } from '@/components/player/common';
import { IS_MOCK } from '@/lib/config';
import { Logo } from './Logo';
import { SearchBox } from './SearchBox';
import { LocaleSwitch, LowDataToggle, SidebarToggle, ThemeToggle } from './SettingsToggles';

/** Fixed top bar. On phones the switches move into the "More" menu to leave room for search. */
export function Header() {
  const t = useTranslations('shell');
  const tc = useTranslations('common');
  return (
    <header className="app-header" data-testid="header">
      <SidebarToggle />
      <Logo label={t('logoHome')} />
      {IS_MOCK ? (
        <span title={tc('mockModeHint')} className="mock-badge hidden xl:inline">
          {tc('mockMode')}
        </span>
      ) : null}
      <SearchBox className="mx-auto w-full max-w-xl flex-1" />
      <div className="hidden items-center gap-1.5 sm:flex">
        <LowDataToggle />
        <LocaleSwitch />
        <ThemeToggle />
      </div>
      <HeaderChips />
      <AccountMenu />
    </header>
  );
}
