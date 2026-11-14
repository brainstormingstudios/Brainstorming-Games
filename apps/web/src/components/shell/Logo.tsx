import type { CSSProperties } from 'react';
import { Mascot } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';

const NAME = 'Brainstorming';

/**
 * The brand lockup: the mascot, a clear gap, then the name set in the display face with a
 * "Games" tag (or the name of a portal). On hover the mascot hops and blinks, the letters do a
 * small wave and the tag tilts: all CSS (`.brand-lockup` in globals.css), nothing to download.
 * On very narrow screens only the mascot is shown.
 */
export function Logo({ label, tag = 'Games', href = '/' }: { label: string; tag?: string; href?: string }) {
  return (
    <Link href={href} aria-label={label} prefetch className="brand-lockup" data-testid="logo">
      <span className="brand-mark">
        <Mascot size={38} animated={false} eager />
      </span>
      <span className="brand-word" aria-hidden="true">
        <span className="brand-name">
          {NAME.split('').map((letter, i) => (
            <span key={i} style={{ '--i': i } as CSSProperties}>
              {letter}
            </span>
          ))}
        </span>
        <span className="brand-tag">{tag}</span>
      </span>
    </Link>
  );
}
