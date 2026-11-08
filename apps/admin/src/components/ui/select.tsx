// A select for a short fixed list (design rule 3; fewer than eight options,
// or names nobody would type; longer lists use the searchable Combobox).
// On desktops it is shadcn/ui's Select (components/ui/shadcn): a 36 px button with the
// up-down chevron, and a popover list drawn in the admin's colours in either
// theme. On phones it stays a native <select>, so the phone shows its own
// picker (ADR 0033); its options take the popover colours too, so the list
// stays readable in the dark theme.
//
// Each option carries its value as data-value, and the button its current
// value, so the E2E helper choose() picks by value on both.
import { ChevronsUpDown } from 'lucide-react';
import { type Ref, useCallback } from 'react';
import { useLocale } from '../../i18n';
import { useWide } from '../../lib/use-wide';
import { cn } from '../../lib/utils';
import { control } from './input';
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Select as ShadSelect,
} from './shadcn/select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

/** Radix can't hold '' as an item's value, so "nothing" travels as this. */
const EMPTY = '\u0000';
const toItem = (value: string) => (value === '' ? EMPTY : value);
const fromItem = (value: string) => (value === EMPTY ? '' : value);

export interface SelectProps {
  /** For the field's <label htmlFor>. */
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Shown while the value matches no option. */
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
  /** Its name when no <label> names it. */
  ariaLabel?: string | undefined;
  describedBy?: string | undefined;
  onBlur?: (() => void) | undefined;
  ref?: Ref<HTMLButtonElement | HTMLSelectElement> | undefined;
}

const field = 'h-10 md:h-9';

export function Select(props: SelectProps) {
  const wide = useWide();
  return wide ? <DesktopSelect {...props} /> : <NativeSelect {...props} />;
}

function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
  className,
  ariaLabel,
  describedBy,
  onBlur,
  ref,
}: SelectProps) {
  const known = options.some((o) => o.value === value);
  return (
    <select
      ref={ref as Ref<HTMLSelectElement>}
      id={id}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={cn(
        control,
        field,
        '[&_option]:bg-popover [&_option]:text-foreground',
        !known && 'text-muted-foreground',
        className,
      )}
    >
      {!known && (
        <option value={value} disabled hidden>
          {placeholder ?? ''}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} data-value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DesktopSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
  className,
  ariaLabel,
  describedBy,
  onBlur,
  ref,
}: SelectProps) {
  const { t } = useLocale();
  const known = options.some((o) => o.value === value);
  // Radix reports closing; that is when a native select would blur.
  const onOpenChange = useCallback((open: boolean) => !open && onBlur?.(), [onBlur]);
  return (
    <ShadSelect
      value={known ? toItem(value) : ''}
      onValueChange={(v) => onChange(fromItem(v))}
      onOpenChange={onOpenChange}
      {...(disabled ? { disabled } : {})}
    >
      <SelectTrigger
        ref={ref as Ref<HTMLButtonElement>}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        data-value={value}
        className={cn(
          control,
          field,
          // The design's up-down chevron in place of shadcn's down arrow.
          'w-full py-0 pr-2.5 text-left hover:bg-accent dark:hover:bg-accent [&>svg:last-child]:hidden',
          className,
        )}
      >
        <SelectValue placeholder={placeholder ?? t('form.choose')} />
        <ChevronsUpDown aria-hidden className="ms-auto size-4 shrink-0 opacity-50" />
      </SelectTrigger>
      <SelectContent
        position="popper"
        collisionPadding={8}
        className="max-h-[min(var(--radix-select-content-available-height),20rem)] min-w-[max(var(--radix-select-trigger-width),8rem)] rounded-lg border-border"
      >
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={toItem(o.value)}
            {...(o.disabled ? { disabled: true } : {})}
            data-value={o.value}
            className="cursor-pointer rounded-md leading-5"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}
