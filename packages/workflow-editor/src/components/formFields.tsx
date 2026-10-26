import React, { useId } from 'react';
import { cn } from '@tiphys/ui-platform';

export const fieldControlClassName =
  'w-full rounded-xl border border-[rgb(var(--wb-color-border-subtle)/0.38)] bg-[rgb(var(--wb-color-bg-surface))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))] placeholder:text-[rgb(var(--wb-color-text-secondary)/0.7)] outline-none transition-colors focus-visible:border-[rgb(var(--wb-color-border-subtle)/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.22)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--wb-color-bg-base))] disabled:opacity-50';

type FieldShellProps = {
  label: string;
  helperText?: string;
  className?: string;
  children: (id: string) => React.ReactNode;
};

function FieldShell({ label, helperText, className, children }: FieldShellProps) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-[rgb(var(--wb-color-text-secondary))]">
        {label}
      </label>
      {children(id)}
      {helperText ? (
        <p className="text-xs text-[rgb(var(--wb-color-text-secondary))]">{helperText}</p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  helperText?: string;
  wrapperClassName?: string;
};

export function TextField({ label, helperText, wrapperClassName, className, ...props }: TextFieldProps) {
  return (
    <FieldShell label={label} helperText={helperText} className={wrapperClassName}>
      {(id) => <input id={id} className={cn(fieldControlClassName, className)} {...props} />}
    </FieldShell>
  );
}

type SelectFieldProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  helperText?: string;
  wrapperClassName?: string;
};

export function SelectField({ label, helperText, wrapperClassName, className, children, ...props }: SelectFieldProps) {
  return (
    <FieldShell label={label} helperText={helperText} className={wrapperClassName}>
      {(id) => (
        <select id={id} className={cn(fieldControlClassName, className)} {...props}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  helperText?: string;
  wrapperClassName?: string;
};

export function TextAreaField({ label, helperText, wrapperClassName, className, ...props }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} helperText={helperText} className={wrapperClassName}>
      {(id) => <textarea id={id} className={cn(fieldControlClassName, 'resize-y', className)} {...props} />}
    </FieldShell>
  );
}
