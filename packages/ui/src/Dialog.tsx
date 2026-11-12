'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
  /** Set to false for flows the player must answer (age gate, consent). */
  dismissable?: boolean;
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const;

/**
 * Modal built on the native <dialog>: focus trap, Escape and inert background come from the
 * browser, so there is no focus-management code to get wrong.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeLabel = 'Close',
  dismissable = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // The click handler only catches clicks on the backdrop; Escape is handled natively by
    // <dialog> through the cancel event below.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissable) e.preventDefault();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (dismissable && e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] rounded-card border border-border bg-surface-3 p-0 text-fg shadow-card',
        'backdrop:bg-overlay backdrop:backdrop-blur-sm open:animate-pop-in',
        widths[size],
      )}
    >
      {open ? (
        <div className="flex max-h-[min(88dvh,48rem)] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-0.5 text-sm text-fg-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissable ? (
              <IconButton label={closeLabel} size="sm" onClick={onClose}>
                <X className="size-5" aria-hidden="true" />
              </IconButton>
            ) : null}
          </header>
          {children ? <div className="overflow-y-auto px-5 py-4">{children}</div> : null}
          {footer ? (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">
              {footer}
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
