// A report's date range (phase-8-plan §3.12): from and to as Dhaka dates,
// with this month, last month and the last 30 days one tap away.
import { useState } from 'react';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import { Field } from './field';
import { Button } from './ui/button';

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

export function ReportRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { t } = useLocale();
  const quick = presets(dhakaDay(new Date()));
  const valid = value.from <= value.to;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5">
      <div className="grid grid-cols-2 gap-3 md:max-w-md">
        <Field
          label={t('reports.from')}
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <Field
          label={t('reports.to')}
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          error={valid ? undefined : t('form.invalid')}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {(['thisMonth', 'lastMonth', 'last30'] as const).map((k) => {
          const active = quick[k].from === value.from && quick[k].to === value.to;
          return (
            <Button
              key={k}
              type="button"
              variant={active ? 'primary' : 'secondary'}
              aria-pressed={active}
              onClick={() => onChange(quick[k])}
            >
              {t(`reports.preset.${k}`)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
