// Labelled date fields on the calendar picker (components/ui/date-picker.tsx),
// laid out like Field and TextField: label, the box, its hint and error.
// Kept apart from field.tsx and form.tsx so the calendar loads only with the
// pages that ask for a date, never with sign-in.
import { useId } from 'react';
import { useController } from 'react-hook-form';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';
import { fieldHint, fieldLabel } from './field-styles';
import { fieldErrorKey } from './form';
import { DatePicker, DateTimePicker } from './ui/date-picker';

interface DateFieldProps {
  label: string;
  /** "2026-10-29", or "2026-10-29T09:30" with `time`; '' for none. */
  value: string;
  onChange: (value: string) => void;
  /** A time box beside the day, for datetime-local values. */
  time?: boolean | undefined;
  /** Adds a muted "(optional)" after the label, and Clear under the month. */
  optional?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
}

export function DateField({
  label,
  value,
  onChange,
  time,
  optional,
  hint,
  error,
  min,
  max,
  disabled,
  invalid,
}: DateFieldProps) {
  const { t } = useLocale();
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  const a11y = {
    id,
    disabled,
    invalid: Boolean(error) || invalid,
    describedBy: described || undefined,
  };
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> ({t('form.optional')})</span>
        )}
      </label>
      {time ? (
        <DateTimePicker
          {...a11y}
          value={value}
          onChange={onChange}
          timeLabel={t('date.timeOf', { field: label })}
        />
      ) : (
        <DatePicker
          {...a11y}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          clearable={optional}
        />
      )}
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

/** A date in a react-hook-form <Form>, like TextField: errors from its schema. */
export function FormDateField({
  name,
  label,
  hint,
  optional,
  min,
  max,
}: {
  name: string;
  label: string;
  hint?: string | undefined;
  optional?: boolean | undefined;
  min?: string | undefined;
  max?: string | undefined;
}) {
  const { t } = useLocale();
  const { field, fieldState } = useController({ name });
  const key = fieldErrorKey(fieldState.error);
  return (
    <DateField
      label={label}
      hint={hint}
      optional={optional}
      min={min}
      max={max}
      value={field.value == null ? '' : String(field.value)}
      onChange={(v) => {
        field.onChange(v);
        field.onBlur();
      }}
      error={key ? t(key) : undefined}
    />
  );
}
