import type { ReactNode } from 'react';
import { cn } from './cn';
import { Mascot } from './mascot/Mascot';
import { MascotAvatar, type MascotMood } from './mascot/MascotAvatar';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** `brand` shows the brand mascot; a mood shows the drawn mascot with that expression. */
  art?: 'brand' | MascotMood;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  headingLevel?: 'h1' | 'h2' | 'h3';
}

const artSize = { sm: 72, md: 112, lg: 160 } as const;

/** Friendly "nothing here yet" block with the mascot. */
export function EmptyState({
  title,
  description,
  action,
  art = 'brand',
  size = 'md',
  className,
  headingLevel: Heading = 'h2',
}: EmptyStateProps) {
  const px = artSize[size];
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-surface-3 px-6 text-center',
        size === 'sm' ? 'py-6' : 'py-10',
        className,
      )}
    >
      {art === 'brand' ? (
        <Mascot size={px} eager />
      ) : (
        <MascotAvatar size={px} mood={art} animated />
      )}
      <Heading className={cn('font-semibold', size === 'lg' ? 'text-2xl' : 'text-lg')}>{title}</Heading>
      {description ? <p className="max-w-md text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
