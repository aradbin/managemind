// Columns on a scale, as the canvas draws them (ADR 0034, .mm-plot): a 44 px
// axis of round taka amounts with gridlines, blue bars from the bottom, and
// labels under them. Each bar names its day and amount (role img) and shows
// it on hover or focus, so no figure depends on seeing the bar; reports also
// offer the same figures as a table. Home and the reports draw it.
import { formatNumber, type Locale } from '@managemind/shared/i18n';
import { useLocale } from '../i18n';
import { formatPrice } from '../lib/catalog';
import { cn } from '../lib/utils';

export interface Bar {
  key: string;
  /** Poisha. */
  value: number;
  /** Under the bar; empty to leave a gap between labels. */
  label: string;
  /** What the bar says to a screen reader and in its tooltip. */
  tip: string;
}

/** A round top for the scale, in poisha: 55,000 taka → 60,000 (one significant step). */
export function niceMax(max: number) {
  // At least ৳1, so a scale over days of nothing still reads in whole taka.
  const v = Math.max(max, 100);
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return ([1.2, 1.6, 2, 3, 4, 6, 8, 10].find((x) => x >= m) ?? 10) * p;
}

/** "৳60K" from ৳10,000 up, the amount itself under it. */
export function axisLabel(poisha: number, locale: Locale, thousands: (n: string) => string) {
  return poisha >= 1_000_000
    ? thousands(formatNumber(locale, Math.round(poisha / 100_000)))
    : formatPrice(Math.round(poisha), locale);
}

export function BarChart({
  label,
  bars,
  top,
  steps,
  height,
  narrow,
}: {
  label: string;
  bars: readonly Bar[];
  /** The scale's top, in poisha. */
  top: number;
  /** Gridlines: 2 for 0 / half / top (Home), 4 for quarters (reports). */
  steps: number;
  /** The plot's height in px: 180 on Home, 200 in reports. */
  height: number;
  /** Few bars, spaced 16 px apart and at most 24 px wide (Home). */
  narrow?: boolean;
}) {
  const { t, locale } = useLocale();
  const ticks = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const gap = narrow ? 'gap-2 md:gap-4' : 'gap-0.5';
  return (
    <figure aria-label={label} className="m-0 flex flex-col gap-1.5">
      <div className="relative ml-11" style={{ height }}>
        {ticks.map((f) => (
          <div
            key={f}
            aria-hidden
            className="absolute inset-x-0 h-0 border-t border-border"
            style={{ bottom: `${f * 100}%` }}
          >
            <span className="absolute -top-2 right-[calc(100%+8px)] text-[11px] leading-4 whitespace-nowrap text-muted-foreground tabular-nums">
              {axisLabel(top * f, locale, (n) => t('dashboard.thousands', { n }))}
            </span>
          </div>
        ))}
        <div className={cn('absolute inset-0 flex items-end', gap)}>
          {bars.map((b) => (
            <div
              key={b.key}
              role="img"
              aria-label={b.tip}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a bar takes focus to show its amount, as drawn.
              tabIndex={0}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-ring)]"
            >
              <i
                className={cn(
                  'block w-full rounded-t bg-bar group-hover:opacity-80 group-focus-visible:opacity-80',
                  narrow && 'max-w-6',
                )}
                style={{ height: `${Math.min(100, (b.value / top) * 100).toFixed(1)}%` }}
              />
              <b
                aria-hidden
                className="absolute bottom-[calc(100%+6px)] left-1/2 z-[5] hidden -translate-x-1/2 rounded-lg border border-border bg-popover px-2 py-1.5 text-xs leading-4 font-medium whitespace-nowrap shadow-[0_4px_12px_rgb(0_0_0/.1)] group-hover:block group-focus-visible:block"
              >
                {b.tip}
              </b>
            </div>
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className={cn('ml-11 flex text-[11px] leading-4 text-muted-foreground', gap)}
      >
        {bars.map((b) => (
          <span
            key={b.key}
            className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap"
          >
            {b.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
