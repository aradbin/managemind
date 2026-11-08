// shadcn/ui's Calendar on react-day-picker, in the admin's tokens: a month
// with the previous and next arrows at the top, 32 px days, today on a grey
// fill and the chosen day near-black. Months and weekdays are in the admin's
// language. Only the date pickers import it, so it stays out of the entry.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { DayPicker } from 'react-day-picker';
import { bn } from 'react-day-picker/locale/bn';
import { enGB } from 'react-day-picker/locale/en-GB';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const { locale } = useLocale();
  return (
    <DayPicker
      locale={locale === 'bn' ? bn : enGB}
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        root: 'w-fit',
        months: 'relative flex flex-col gap-4',
        month: 'flex w-full flex-col gap-3',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous:
          'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        button_next:
          'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        month_caption: 'flex h-8 items-center justify-center px-8',
        caption_label: 'text-sm font-medium',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-8 text-[12px] font-normal text-muted-foreground',
        week: 'mt-1 flex w-full',
        day: 'relative size-8 p-0 text-center text-sm',
        day_button:
          'inline-flex size-8 items-center justify-center rounded-md tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50',
        selected:
          '[&>button]:!bg-primary [&>button]:font-medium [&>button]:!text-primary-foreground',
        today: '[&>button]:bg-muted [&>button]:font-medium',
        outside: 'text-muted-foreground/60',
        disabled: 'pointer-events-none text-muted-foreground opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevron }) =>
          orientation === 'left' ? (
            <ChevronLeft aria-hidden className={cn('size-4', chevron)} />
          ) : (
            <ChevronRight aria-hidden className={cn('size-4', chevron)} />
          ),
      }}
      {...props}
    />
  );
}
