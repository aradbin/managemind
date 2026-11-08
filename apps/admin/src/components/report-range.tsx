// A report's date range (phase-8-plan §3.12), as the canvas draws it (ADR
// 0034): segmented presets (this month, last month, the last 30 days,
// custom) with the dates beside them; Custom opens From and To in a small
// panel. Phones scroll the presets sideways and put the dates under them,
// with Change for custom dates. Dates are Dhaka dates, as the server reads.
import type { Locale } from '@managemind/shared/i18n';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '../i18n';
import { formatDateTime } from '../lib/dates';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { DateField } from './date-field';
import { Button } from './ui/button';
import { Segmented } from './ui/segmented';

// The server reads the range as Dhaka dates, so today is Dhaka's today.
const DHAKA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });
export const dhakaDay = (d: Date) => DHAKA_DAY.format(d);

const DAY_MS = 86_400_000;
function presets(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = `${today.slice(0, 8)}01`;
  const lastMonthEnd = dhakaDay(new Date(Date.UTC(y, m - 1, 0, 12)));
  return {
    thisMonth: { from: first, to: today },
    lastMonth: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    last30: { from: dhakaDay(new Date(Date.parse(`${today}T12:00:00Z`) - 29 * DAY_MS)), to: today },
  };
}

export interface Range {
  from: string;
  to: string;
}

/** The range and its setter, starting at this month. */
export function useRange(): [Range, (r: Range) => void] {
  const [range, setRange] = useState(() => presets(dhakaDay(new Date())).thisMonth);
  return [range, setRange];
}

/** "1 Oct – 29 Oct, 2026": the year once, unless the range spans two. */
export function rangeText(value: Range, locale: Locale) {
  const date = (iso: string, year: boolean) =>
    formatDateTime(locale, new Date(`${iso}T12:00:00+06:00`), {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
    });
  const sameYear = value.from.slice(0, 4) === value.to.slice(0, 4);
  return `${date(value.from, !sameYear)} – ${date(value.to, true)}`;
}

type Key = 'thisMonth' | 'lastMonth' | 'last30' | 'custom';

export function ReportRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { t, locale } = useLocale();
  const quick = presets(dhakaDay(new Date()));
  const [customPicked, setCustomPicked] = useState(false);
  const [open, setOpen] = useState(false);
  const valid = value.from <= value.to;
  const matched = (['thisMonth', 'lastMonth', 'last30'] as const).find(
    (k) => quick[k].from === value.from && quick[k].to === value.to,
  );
  const active: Key = customPicked || !matched ? 'custom' : matched;
  const text = valid ? rangeText(value, locale) : t('reports.checkDates');
  const pick = (k: Key) => {
    if (k === 'custom') {
      setCustomPicked(true);
      setOpen(true);
      return;
    }
    setCustomPicked(false);
    setOpen(false);
    onChange(quick[k]);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <Popover.Anchor asChild>
          {/* Phones scroll the presets sideways, edge to edge, as drawn. */}
          <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none]">
            <Segmented<Key>
              label={t('reports.dates')}
              value={active}
              options={[
                { value: 'thisMonth', label: t('reports.preset.thisMonth') },
                { value: 'lastMonth', label: t('reports.preset.lastMonth') },
                { value: 'last30', label: t('reports.preset.last30') },
                { value: 'custom', label: t('reports.preset.custom') },
              ]}
              onChange={pick}
            />
          </div>
        </Popover.Anchor>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <CalendarDays aria-hidden className="size-4" />
          <span aria-live="polite">{text}</span>
          {active === 'custom' && (
            <Popover.Trigger asChild>
              <Button variant="ghost" className="-my-1 ml-auto h-7 px-2 md:ml-1 md:h-7">
                {t('reports.change')}
              </Button>
            </Popover.Trigger>
          )}
        </p>
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={t('reports.customDates')}
          className="z-50 flex w-[320px] max-w-[calc(100vw-16px)] flex-col gap-3 rounded-lg border border-border bg-popover p-3 text-foreground shadow-md"
        >
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label={t('reports.from')}
              value={value.from}
              onChange={(from) => onChange({ ...value, from })}
            />
            <DateField
              label={t('reports.to')}
              value={value.to}
              invalid={!valid}
              onChange={(to) => onChange({ ...value, to })}
            />
          </div>
          {!valid && <p className="text-[13px] text-danger">{t('reports.endBeforeStart')}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
