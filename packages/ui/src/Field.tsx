import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

export const controlClass =
  'w-full rounded-control border border-border bg-surface-3 px-3.5 text-fg placeholder:text-fg-muted/70 ' +
  'transition-colors hover:border-navy-400 disabled:opacity-60 aria-[invalid=true]:border-danger';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Right-aligned text beside the label, e.g. a character counter. */
  meta?: ReactNode;
  className?: string;
  hideLabel?: boolean;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  meta,
  className,
  hideLabel,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
        <label htmlFor={id} className="text-sm font-bold">
          {label}
        </label>
        {meta ? <span className="text-xs text-fg-muted">{meta}</span> : null}
      </div>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: ReactNode, error?: ReactNode) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export type TextFieldProps = FieldShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export function TextField({ label, hint, error, meta, className, hideLabel, id, ...rest }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell {...{ label, hint, error, meta, className, hideLabel }} id={fieldId}>
      <input
        id={fieldId}
        className={cn(controlClass, 'h-11')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
}

export type TextAreaFieldProps = FieldShellProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export function TextAreaField({
  label,
  hint,
  error,
  meta,
  className,
  hideLabel,
  id,
  rows = 5,
  ...rest
}: TextAreaFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell {...{ label, hint, error, meta, className, hideLabel }} id={fieldId}>
      <textarea
        id={fieldId}
        rows={rows}
        className={cn(controlClass, 'py-2.5 leading-relaxed')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
}

export type SelectFieldProps = FieldShellProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
    options: { value: string; label: string; disabled?: boolean }[];
    placeholder?: string;
  };

export function SelectField({
  label,
  hint,
  error,
  meta,
  className,
  hideLabel,
  id,
  options,
  placeholder,
  ...rest
}: SelectFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell {...{ label, hint, error, meta, className, hideLabel }} id={fieldId}>
      <select
        id={fieldId}
        className={cn(controlClass, 'h-11 pr-8')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  /** Hides the visible label (it stays available to screen readers). */
  compact?: boolean;
}

/** An accessible toggle built on a native checkbox with role="switch". */
export function Switch({ label, description, className, compact, id, ...rest }: SwitchProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <label htmlFor={fieldId} className={cn('flex cursor-pointer items-center gap-3', className)}>
      <span className="relative inline-flex h-7 w-12 shrink-0 items-center">
        <input id={fieldId} type="checkbox" role="switch" className="peer sr-only" {...rest} />
        <span className="absolute inset-0 rounded-full border border-border bg-surface-3 transition-colors peer-checked:border-transparent peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
        <span className="pointer-events-none absolute left-1 size-5 rounded-full bg-fg shadow transition-transform duration-200 ease-(--ease-spring) peer-checked:translate-x-5 peer-checked:bg-navy-950" />
      </span>
      <span className={cn('min-w-0', compact && 'sr-only')}>
        <span className="block text-sm font-bold">{label}</span>
        {description ? <span className="block text-xs text-fg-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: ReactNode;
  className?: string;
}

export function Checkbox({ label, className, id, ...rest }: CheckboxProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <label htmlFor={fieldId} className={cn('flex cursor-pointer items-start gap-2.5 text-sm', className)}>
      <input
        id={fieldId}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 rounded border-border accent-(--primary)"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}
