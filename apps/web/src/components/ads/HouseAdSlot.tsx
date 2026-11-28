'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@brainstorming/ui';
import { HOUSE_AD, VERTICAL_PROMO, creativesFor, loadAdSettings } from '@/lib/ads/houseAd';
import type { AdCreative } from '@/lib/data/growthTypes';
import { loadCountry } from '@/lib/hooks/useCountry';
import { useSession } from '@/lib/hooks/useSession';
import { usePrefs } from '@/lib/prefs';
import type { AdPlacement } from './AdSlot';

/**
 * Our own ad in a display-ad space (no ad network yet): the Brainstorming Studios promo.
 * - Beside the game (300×600): the vertical video fills the space.
 * - Wide strips: the video small on the left, the channel name and a "Watch on YouTube" button.
 * The video is muted, loops, loads only when the space is near the screen, and stays a still
 * picture for people who ask for reduced motion. A click opens the channel in a new tab.
 */
export function HouseAdSlot({ placement, className, sizeClass }: { placement: AdPlacement; className?: string; sizeClass: string }) {
  const t = useTranslations('ads');
  const ref = useRef<HTMLAnchorElement>(null);
  const [near, setNear] = useState(false);
  const [still, setStill] = useState(false);
  const { user } = useSession();
  const { schoolSafe } = usePrefs();
  // One of our own ads from the portal for this space (picked once), or the channel ad.
  const [custom, setCustom] = useState<AdCreative | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([loadAdSettings(), loadCountry()]).then(([, country]) => {
      if (!live) return;
      const list = creativesFor(placement, { kid: schoolSafe || Boolean(user?.isMinor), country });
      setCustom(list.length ? list[Math.floor(Math.random() * list.length)]! : null);
    });
    return () => {
      live = false;
    };
  }, [placement, schoolSafe, user?.isMinor]);

  useEffect(() => {
    setStill(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    if (!ref.current) return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  const tall = placement === 'game-side';
  // Tall slots show the vertical promo; wide ones the 16:9 channel ad.
  const clip = tall ? VERTICAL_PROMO : HOUSE_AD;
  const media =
    near && !still ? (
      <video src={clip.video} poster={clip.poster} muted loop autoPlay playsInline preload="none" className="size-full object-cover" aria-hidden="true" />
    ) : (
      <img src={clip.poster} alt="" className="size-full object-cover" loading="lazy" />
    );

  if (custom) {
    return (
      <a
        ref={ref}
        href={custom.href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label={`${t('house')}: ${custom.title}, ${custom.cta}`}
        data-ad-placement={placement}
        data-testid="house-ad-slot"
        className={cn('ad-slot relative overflow-hidden rounded-control bg-navy-950 text-white', sizeClass, className)}
      >
        {custom.kind === 'video' && near && !still ? (
          <video src={custom.media} muted loop autoPlay playsInline preload="none" className="size-full object-cover" aria-hidden="true" />
        ) : custom.kind === 'image' ? (
          <img src={custom.media} alt="" className="size-full object-cover" loading="lazy" />
        ) : null}
        <span className="absolute top-2 left-2 rounded-sm bg-black/60 px-2 py-0.5 text-[11px] font-bold">{t('house')}</span>
        <span className="absolute right-2 bottom-2 rounded-control bg-primary px-3 py-1.5 text-sm font-bold text-primary-fg">{custom.cta}</span>
      </a>
    );
  }
  return (
    <a
      ref={ref}
      href={HOUSE_AD.href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      aria-label={`${t('house')}: ${HOUSE_AD.title}, ${HOUSE_AD.cta}`}
      data-ad-placement={placement}
      data-testid="house-ad-slot"
      className={cn('ad-slot relative overflow-hidden rounded-control bg-[#1a0608] text-white', sizeClass, tall ? 'flex-col' : 'flex items-stretch gap-3 p-2', className)}
    >
      {tall ? (
        <>
          {media}
          <span className="absolute top-2 left-2 rounded-sm bg-black/60 px-2 py-0.5 text-[11px] font-bold">{t('house')}</span>
          <span className="absolute inset-x-3 bottom-3 rounded-control bg-[#ff2a2a] px-3 py-2 text-center text-sm font-bold">{HOUSE_AD.cta}</span>
        </>
      ) : (
        <>
          <span className="block aspect-[9/16] h-full shrink-0 overflow-hidden rounded-sm">{media}</span>
          <span className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="text-[11px] font-bold text-white/60">{t('house')}</span>
            <span className="truncate font-display text-base font-bold sm:text-lg">{HOUSE_AD.title}</span>
            <span className="line-clamp-2 text-xs text-white/80 sm:text-sm">{HOUSE_AD.tagline}</span>
          </span>
          <span className="hidden shrink-0 items-center self-center rounded-control bg-[#ff2a2a] px-4 py-2 text-sm font-bold sm:flex">{HOUSE_AD.cta}</span>
        </>
      )}
    </a>
  );
}
