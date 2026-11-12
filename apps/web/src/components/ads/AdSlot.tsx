import { useTranslations } from 'next-intl';
import { cn } from '@brainstorming/ui';
import { ADSENSE_CLIENT, IS_DEV, IS_MOCK } from '@/lib/config';

export type AdPlacement = 'game-side' | 'game-content' | 'home-rail' | 'grid';

const SIZES: Record<AdPlacement, { label: string; className: string }> = {
  // Desktop only, beside the frame. Never over or inside the game.
  'game-side': { label: '300×600', className: 'hidden xl:flex w-[300px] h-[600px]' },
  'game-content': { label: 'responsive', className: 'w-full h-[100px] sm:h-[120px]' },
  'home-rail': { label: 'responsive', className: 'w-full h-[100px] sm:h-[120px]' },
  grid: { label: 'responsive', className: 'col-span-full w-full h-[100px] sm:h-[120px]' },
};

/**
 * A display-ad position with its space reserved up front (no layout shift).
 *
 * - No AdSense client configured in production: renders nothing at all.
 * - Dev and mock mode: a labelled placeholder box, so layouts can be judged with ads in place.
 * - With `NEXT_PUBLIC_ADSENSE_CLIENT`: the live unit is mounted by the ads module (phase 4).
 */
export function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const t = useTranslations('ads');
  const size = SIZES[placement];
  const showPlaceholder = IS_DEV || IS_MOCK;
  if (!ADSENSE_CLIENT && !showPlaceholder) return null;
  return (
    <aside
      aria-label={t('label')}
      data-ad-placement={placement}
      data-testid="ad-slot"
      className={cn('ad-slot rounded-control', size.className, className)}
    >
      {showPlaceholder && !ADSENSE_CLIENT ? (
        <span className="flex size-full items-center justify-center rounded-control border border-dashed border-border px-3 text-center text-xs font-bold text-fg-muted">
          {t('placeholder', { size: size.label, placement })}
        </span>
      ) : null}
    </aside>
  );
}
