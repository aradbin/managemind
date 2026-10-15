// A labelled input with its hint and error wired up for screen readers
// (WCAG 1.3.1, 3.3.1): the error is announced and linked to the input.
import { type ComponentProps, useId } from 'react';
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
