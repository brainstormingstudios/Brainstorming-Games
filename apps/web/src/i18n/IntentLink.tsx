'use client';

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, FocusEvent, MouseEvent, TouchEvent } from 'react';
import { usePrefs } from '@/lib/prefs';
import { startNavProgress } from '@/components/shell/NavProgress';

type Props = ComponentProps<typeof NextLink> & { href: string };

/**
 * A client link that loads the next page as soon as the visitor shows intent (pointer over it,
 * keyboard focus, finger down), so the click itself feels instant. Nothing is loaded in advance
 * just because a link scrolls into view, and nothing at all in low-data mode.
 */
export function IntentLink({ href, prefetch, onMouseEnter, onFocus, onTouchStart, onClick, ...rest }: Props) {
  const router = useRouter();
  const { lowData } = usePrefs();
  const warm = () => {
    if (!lowData && href.startsWith('/')) router.prefetch(href);
  };
  return (
    <NextLink
      href={href}
      prefetch={prefetch ?? false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        warm();
        onFocus?.(e);
      }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => {
        warm();
        onTouchStart?.(e);
      }}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        // A plain left click that the router will handle: show the loading bar.
        if (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !rest.target) startNavProgress(href);
      }}
      {...rest}
    />
  );
}
