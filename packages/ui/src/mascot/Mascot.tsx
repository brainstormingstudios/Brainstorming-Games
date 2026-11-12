import type { CSSProperties } from 'react';
import { cn } from '../cn';

const SIZES = [64, 128, 256, 512] as const;

function pick(target: number): number {
  return SIZES.find((s) => s >= target) ?? 512;
}

export interface MascotProps {
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Idle float, blink and brain glow (CSS only; honours reduced motion). */
  animated?: boolean;
  /** Plays the celebration bounce. */
  celebrate?: boolean;
  /** Load eagerly with high priority. Use for the one mascot above the fold. */
  priority?: boolean;
  /** Load eagerly at normal priority (likely above the fold, but not the main image). */
  eager?: boolean;
  /** Accessible name. Leave empty when the mascot is decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Folder that holds the generated brand files. */
  basePath?: string;
}

/** The brand mascot (processed PNG) with CSS-only animation overlays. */
export function Mascot({
  size = 160,
  animated = true,
  celebrate = false,
  priority = false,
  eager = false,
  label,
  className,
  style,
  basePath = '/brand',
}: MascotProps) {
  const x1 = pick(size);
  const x2 = pick(size * 2);
  const set = (ext: string) =>
    x1 === x2
      ? `${basePath}/mascot-${x1}.${ext}`
      : `${basePath}/mascot-${x1}.${ext} 1x, ${basePath}/mascot-${x2}.${ext} 2x`;
  return (
    <span
      className={cn(
        'bg-mascot',
        animated && !celebrate && 'bg-mascot--animated',
        celebrate && 'bg-mascot--celebrate',
        className,
      )}
      style={{ width: size, height: size, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <picture>
        <source type="image/avif" srcSet={set('avif')} />
        <source type="image/webp" srcSet={set('webp')} />
        <img
          src={`${basePath}/mascot-256.png`}
          alt=""
          width={size}
          height={size}
          decoding="async"
          loading={priority || eager ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          draggable={false}
        />
      </picture>
      <span className="bg-mascot__glow" />
      <span className="bg-mascot__blink bg-mascot__blink--l" />
      <span className="bg-mascot__blink bg-mascot__blink--r" />
    </span>
  );
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 14 - Math.PI / 2;
  const distance = 90 + (i % 3) * 34;
  return {
    i,
    x: `${Math.round(Math.cos(angle) * distance)}px`,
    y: `${Math.round(Math.sin(angle) * distance - 20)}px`,
    r: `${(i % 2 === 0 ? 1 : -1) * (180 + i * 26)}deg`,
  };
});

/** A one-shot cyan confetti burst. Mount it to play it; position the parent `relative`. */
export function ConfettiBurst({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('bg-confetti', className)}>
      {CONFETTI.map((c) => (
        <i
          key={c.i}
          style={{ '--i': c.i, '--x': c.x, '--y': c.y, '--r': c.r } as CSSProperties}
        />
      ))}
    </span>
  );
}
