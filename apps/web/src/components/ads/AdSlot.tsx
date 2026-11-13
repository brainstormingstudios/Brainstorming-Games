'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@brainstorming/ui';
import { splitLocale } from '@/i18n/config';
import { loadAdsense } from '@/lib/ads/adsense';
import { ADSENSE_CLIENT, IS_DEV, IS_MOCK } from '@/lib/config';

export type AdPlacement = 'game-side' | 'game-content' | 'home-rail' | 'grid';

const SIZES: Record<AdPlacement, { label: string; className: string; slotEnv: 'side' | 'responsive' }> = {
  // Desktop only, beside the frame. Never over or inside the game.
  'game-side': { label: '300×600', className: 'hidden xl:flex w-[300px] h-[600px]', slotEnv: 'side' },
  'game-content': { label: 'responsive', className: 'w-full h-[100px] sm:h-[120px]', slotEnv: 'responsive' },
  'home-rail': { label: 'responsive', className: 'w-full h-[100px] sm:h-[120px]', slotEnv: 'responsive' },
  grid: { label: 'responsive', className: 'col-span-full w-full h-[100px] sm:h-[120px]', slotEnv: 'responsive' },
};

const SLOT_IDS = {
  side: (process.env.NEXT_PUBLIC_ADSENSE_SLOT_GAME_SIDE ?? '').trim(),
  responsive: (process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESPONSIVE ?? '').trim(),
};

/** Pages that never show display ads: the developer portal, the admin console and policies. */
const NO_ADS = /^\/(dev|admin|about|contact|parents|school-safe|terms|privacy|developer-terms|cookies|settings|login)(\/|$)/;

/**
 * A display-ad position with its space reserved up front (no layout shift).
 *   - no AdSense client configured: a labelled placeholder in dev and mock mode, nothing otherwise;
 *   - with `NEXT_PUBLIC_ADSENSE_CLIENT`: the unit loads only when it is about to scroll into view.
 */
export function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const t = useTranslations('ads');
  const { path } = splitLocale(usePathname() ?? '/');
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const size = SIZES[placement];
  const slot = SLOT_IDS[size.slotEnv];
  const live = Boolean(ADSENSE_CLIENT && slot);

  useEffect(() => {
    if (!live || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [live]);

  useEffect(() => {
    if (!visible) return;
    void loadAdsense()
      .then(() => (window.adsbygoogle = window.adsbygoogle || ([] as never)).push({}))
      .catch(() => {});
  }, [visible]);

  if (NO_ADS.test(path)) return null;
  const showPlaceholder = !live && (IS_DEV || IS_MOCK);
  if (!live && !showPlaceholder) return null;
  return (
    <aside ref={ref} aria-label={t('label')} data-ad-placement={placement} data-testid="ad-slot" className={cn('ad-slot rounded-control', size.className, className)}>
      {showPlaceholder ? (
        <span className="flex size-full items-center justify-center rounded-control border border-dashed border-border px-3 text-center text-xs font-bold text-fg-muted">
          {t('placeholder', { size: size.label, placement })}
        </span>
      ) : visible ? (
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%', height: '100%' }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          {...(placement === 'game-side' ? {} : { 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' })}
        />
      ) : null}
    </aside>
  );
}
