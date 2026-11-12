import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/** Surface container with the brand's 16px radius. */
export function Card({
  className,
  interactive,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface shadow-card',
        interactive && 'glow-hover hover:-translate-y-0.5',
        className,
      )}
      {...rest}
    />
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'glow';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg',
  primary: 'bg-primary text-primary-fg',
  success: 'bg-success text-navy-950',
  warning: 'bg-warning text-navy-950',
  danger: 'bg-danger text-navy-950',
  glow: 'bg-navy-950 text-cyan-300 ring-1 ring-cyan-300/60',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold leading-5',
        badgeTones[tone],
        className,
      )}
      {...rest}
    />
  );
}

/** Pill used for tags and filters. Render it inside a link or a button. */
export function chipClass(active?: boolean, className?: string) {
  return cn(
    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors',
    active
      ? 'border-transparent bg-primary text-primary-fg'
      : 'border-border bg-surface text-fg hover:bg-surface-2',
    className,
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton', className)} />;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
  tone = 'glow',
}: {
  value: number;
  max?: number;
  label: string;
  className?: string;
  tone?: 'glow' | 'success';
}) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn('h-2.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-(--ease-out-soft)',
          tone === 'glow'
            ? 'bg-cyan-300 shadow-[0_0_12px_rgb(0_232_252/0.7)] light:bg-cyan-500'
            : 'bg-success',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  id,
  as: Tag = 'h2',
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  id?: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <Tag id={id} className="text-xl font-semibold sm:text-2xl">
        {title}
      </Tag>
      {action}
    </div>
  );
}

/** Visually hidden text for screen readers. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
