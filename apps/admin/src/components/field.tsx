// A labelled input with its hint and error wired up for screen readers
// (WCAG 1.3.1, 3.3.1): the error is announced and linked to the input.
import { type ComponentProps, useId } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';
import { fieldHint, fieldLabel } from './field-styles';
import { Input } from './ui/input';

interface FieldProps extends ComponentProps<'input'> {
  label: string;
  /** Adds a muted "(optional)" after the label, as the boards do. */
  optional?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Field({ label, optional, hint, error, ...props }: FieldProps) {
  const { t } = useLocale();
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> ({t('form.optional')})</span>
        )}
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
