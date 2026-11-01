// A labelled input with its hint and error wired up for screen readers
// (WCAG 1.3.1, 3.3.1): the error is announced and linked to the input.
import { type ComponentProps, useId } from 'react';
import { cn } from '../lib/utils';
import { fieldHint, fieldLabel } from './form';
import { Input } from './ui/input';

interface FieldProps extends ComponentProps<'input'> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Field({ label, hint, error, ...props }: FieldProps) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className={fieldHint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className={cn(fieldHint, 'text-danger')}>
          {error}
        </p>
      )}
    </div>
  );
}
