'use client';

import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before it disappears. Errors stay longer by default. */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
}

type ToastFn = (message: ReactNode, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Returns `toast(message, { tone })`. Messages are announced through an aria-live region. */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

const icons = { info: Info, success: CheckCircle2, error: TriangleAlert } as const;

export function ToastProvider({
  children,
  dismissLabel = 'Dismiss',
}: {
  children: ReactNode;
  dismissLabel?: string;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, options) => {
      const id = nextId.current++;
      const tone = options?.tone ?? 'info';
      setItems((list) => [...list.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), options?.duration ?? (tone === 'error' ? 7000 : 4000));
    },
    [dismiss],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex max-w-md animate-pop-in items-center gap-3 rounded-control border px-4 py-3 text-sm font-semibold shadow-card',
                'border-border bg-surface-3 text-fg',
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  'size-5 shrink-0',
                  t.tone === 'success' && 'text-success',
                  t.tone === 'error' && 'text-danger',
                  t.tone === 'info' && 'text-glow',
                )}
              />
              <span className="min-w-0">{t.message}</span>
              <button
                type="button"
                aria-label={dismissLabel}
                onClick={() => dismiss(t.id)}
                className="ml-1 rounded-md p-1 text-fg-muted hover:text-fg"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
