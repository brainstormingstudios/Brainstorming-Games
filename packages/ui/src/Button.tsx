import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-display font-semibold ' +
  'select-none whitespace-nowrap transition-[transform,box-shadow,background-color,color,border-color] ' +
  'duration-200 ease-(--ease-spring) active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none ' +
  'aria-disabled:opacity-50 aria-disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  // The accent is always a fill with ink text, so it passes contrast on both themes.
  primary: 'bg-primary text-primary-fg hover:-translate-y-px hover:brightness-105 hover:shadow-[0_10px_24px_-12px_var(--primary)]',
  secondary: 'border border-border bg-surface-2 text-fg hover:border-fg-muted',
  outline: 'border border-border bg-transparent text-fg hover:bg-surface-2',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-navy-950 hover:brightness-110',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-[0.95rem]',
  lg: 'h-12 px-6 text-base',
  xl: 'h-14 px-8 text-lg',
};

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}

/** Class string for anything that should look like a button (links included). */
export function buttonClass({ variant = 'primary', size = 'md', block, className }: ButtonStyleProps = {}) {
  return cn(base, variants[variant], sizes[size], block && 'w-full', className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  block,
  className,
  loading,
  icon,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

const iconSizes = { sm: 'size-9', md: 'size-11', lg: 'size-12' } as const;

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  active,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        base,
        variants[variant],
        iconSizes[size],
        'shrink-0 p-0',
        active && 'bg-surface-2 text-primary light:text-navy-600',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}
