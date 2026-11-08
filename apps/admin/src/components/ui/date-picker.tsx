// A date field on shadcn/ui's Calendar (design rule 11): a box like an input
// showing the date day first ("29 Oct", "29 Oct 2025"), which opens a month
// to pick from. The value stays the string a native date input gives,
// "2026-10-29" (and "2026-10-29T09:30" with a time), so forms and the API
// read it as before.
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays } from 'lucide-react';
import { type Ref, useState } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';
import { Calendar } from './calendar';
import { control, Input } from './input';

/** "2026-10-29" as a local date, or undefined. */
function parseDay(value: string | undefined): Date | undefined {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return undefined;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(at.getTime()) ? undefined : at;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDay = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** Day first, with the year only when it isn't this one (ADR 0033). */
function shown(locale: 'bn' | 'en', at: Date) {
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  }).format(at);
}

export interface DatePickerProps {
  id?: string | undefined;
  /** "2026-10-29", or '' for none. */
  value: string;
  onChange: (value: string) => void;
  /** The first and last days that can be picked, as "2026-10-29". */
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
  ariaLabel?: string | undefined;
  placeholder?: string | undefined;
  /** Offers Clear under the month, for a date that can be left empty. */
  clearable?: boolean | undefined;
  onBlur?: (() => void) | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  invalid,
  describedBy,
  ariaLabel,
  placeholder,
  clearable,
  onBlur,
  className,
  ref,
}: DatePickerProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const day = parseDay(value);
  const first = parseDay(min);
  const last = parseDay(max);
  const opensOn = day ?? last;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={ref}
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          aria-haspopup="dialog"
          data-value={value}
          className={cn(
            control,
            'flex h-10 items-center gap-2 text-left hover:bg-accent md:h-9 dark:hover:bg-accent',
            className,
          )}
        >
          <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('truncate tabular-nums', !day && 'text-muted-foreground')}>
            {day ? shown(locale, day) : (placeholder ?? t('date.pick'))}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 rounded-lg border border-border bg-popover text-foreground shadow-md"
        >
          <Calendar
            mode="single"
            autoFocus
            selected={day}
            {...(opensOn ? { defaultMonth: opensOn } : {})}
            {...(first ? { startMonth: first } : {})}
            {...(last ? { endMonth: last } : {})}
            disabled={[...(first ? [{ before: first }] : []), ...(last ? [{ after: last }] : [])]}
            onSelect={(next) => {
              if (next) onChange(toDay(next));
              else if (clearable) onChange('');
              setOpen(false);
            }}
          />
          {clearable && value && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                className="h-8 w-full rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                {t('date.clear')}
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A date and a time: the calendar for the day and a native time box beside
 * it. The value is what a datetime-local input gives, "2026-10-29T09:30";
 * a day picked without a time starts at midnight.
 */
export function DateTimePicker({
  value,
  onChange,
  timeLabel,
  ...props
}: Omit<DatePickerProps, 'min' | 'max'> & {
  /** The time box's name, "Starts, time". */
  timeLabel?: string | undefined;
}) {
  const { t } = useLocale();
  const [dayPart = '', timePart = ''] = value.split('T');
  const [time, setTime] = useState(timePart.slice(0, 5));
  const shownTime = timePart ? timePart.slice(0, 5) : time;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <DatePicker
        {...props}
        value={dayPart}
        clearable
        onChange={(next) => onChange(next ? `${next}T${shownTime || '00:00'}` : '')}
      />
      <Input
        type="time"
        aria-label={timeLabel ?? t('date.time')}
        disabled={props.disabled}
        value={shownTime}
        onChange={(e) => {
          setTime(e.target.value);
          if (dayPart && e.target.value) onChange(`${dayPart}T${e.target.value}`);
        }}
        className="tabular-nums"
      />
    </div>
  );
}
