// A select for a short fixed list (design rule 3; fewer than eight options,
// or names nobody would type; longer lists use the searchable Combobox).
// On desktops it is shadcn/ui's Select on Radix: a 36 px button with the
// up-down chevron, and a popover list drawn in the admin's colours in either
// theme. On phones it stays a native <select>, so the phone shows its own
// picker (ADR 0033); its options take the popover colours too, so the list
// stays readable in the dark theme.
//
// Each option carries its value as data-value, and the button its current
// value, so the E2E helper choose() picks by value on both.
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { type Ref, useCallback } from 'react';
import { useLocale } from '../../i18n';
import { useWide } from '../../lib/use-wide';
import { cn } from '../../lib/utils';
import { control } from './input';
import { menuContent } from './menu';

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
    <RadixSelect.Root
      value={known ? toItem(value) : ''}
      onValueChange={(v) => onChange(fromItem(v))}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        ref={ref as Ref<HTMLButtonElement>}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        data-value={value}
        className={cn(
          control,
          field,
          'flex items-center justify-between gap-2 pr-2.5 text-left hover:bg-accent data-[placeholder]:text-muted-foreground dark:hover:bg-accent [&>span]:truncate',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder ?? t('form.choose')} />
        <RadixSelect.Icon asChild>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-50" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            menuContent,
            'relative min-w-[max(var(--radix-select-trigger-width),8rem)] overflow-hidden p-0',
            'max-h-[min(var(--radix-select-content-available-height),20rem)]',
          )}
        >
          <RadixSelect.ScrollUpButton className="flex h-6 cursor-default items-center justify-center">
            <ChevronUp aria-hidden className="size-4" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={toItem(o.value)}
                disabled={o.disabled}
                data-value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pr-8 pl-2 text-sm leading-5 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check aria-hidden className="size-4" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-6 cursor-default items-center justify-center">
            <ChevronDown aria-hidden className="size-4" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
