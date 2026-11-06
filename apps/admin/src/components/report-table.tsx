// A report's table (phase-5a-plan §3.15), as the canvas draws it (ADR 0034,
// .mm-rtab in a card): the caption and an optional line under it, a ghost
// Export menu, a muted header row, 40 px rows at 13 px with the figures
// right-aligned, and the table scrolling sideways on phones. Cells can be
// muted (a share), bold (a rate, a total) or red, and the first can be
// indented ("…of them after a call"); a row can be a total, on a tint. With
// `exportName` it saves itself as Excel or CSV (phase-8-plan §3.8), from
// `exportRows` (counts and money as numbers) or else the cells as shown.
// Report pages lay their tables out two by two with ReportBlocks.

import type { Locale } from '@managemind/shared/i18n';
import { formatNumber } from '@managemind/shared/i18n';
import { Link } from '@tanstack/react-router';
import { ChevronRight, CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AdminKey } from '../i18n';
import type { ReportCell } from '../lib/report-export';
import { cn } from '../lib/utils';
import { ExportButtons } from './export-buttons';
import { Button } from './ui/button';
import { cardFrame, cardTitle } from './ui/card';

export type Cell =
  | string
  | number
  | {
      text: string | number;
      muted?: boolean;
      strong?: boolean;
      danger?: boolean;
      /** Amber, such as "8 without cost". */
      warn?: boolean;
      /** Green, such as a rise in sales. */
      good?: boolean;
      /** The first cell only: a sub-row of the one above. */
      indent?: boolean;
    };

export type Row = Cell[] | { cells: Cell[]; total?: boolean; rule?: boolean };

const cellsOf = (r: Row) => (Array.isArray(r) ? r : r.cells);
const textOf = (c: Cell) => (typeof c === 'object' ? c.text : c);

export function Table({
  caption,
  sub,
  head,
  rows,
  empty,
  hint,
  link,
  full,
  exportName,
  exportRows,
}: {
  caption: string;
  /** A line under the caption, such as what the figures count. */
  sub?: ReactNode;
  head: string[];
  rows: Row[];
  empty: string;
  /** A note under the table. */
  hint?: ReactNode;
  /** A ghost link under the table, such as to the full list. */
  link?: { to: string; label: string; search?: Record<string, unknown> };
  /** Across both columns of ReportBlocks. */
  full?: boolean;
  exportName?: string;
  exportRows?: ReportCell[][];
}) {
  return (
    <section className={cn(cardFrame, 'flex min-w-0 flex-col gap-3 pt-4', full && 'lg:col-span-2')}>
      <div className="flex items-start gap-2 px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className={cardTitle}>{caption}</h2>
          {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
        </div>
        {exportName && rows.length > 0 && (
          <ExportButtons
            variant="ghost"
            name={exportName}
            what={caption}
            head={head}
            rows={() => exportRows ?? rows.map((r) => cellsOf(r).map(textOf))}
          />
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-muted-foreground">{empty}</p>
      ) : (
        <div
          // Wide tables scroll sideways on phones; keyboard users can scroll them too.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable (WCAG 2.1.1).
          tabIndex={0}
          className="overflow-x-auto rounded-b-[12px] focus-visible:shadow-[inset_0_0_0_2px_var(--color-ring)] md:rounded-b-[14px]"
        >
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn(
                      'h-9 border-t border-border bg-muted px-3 font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4',
                      i ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => {
                const spec: { total?: boolean; rule?: boolean } = Array.isArray(r) ? {} : r;
                return (
                  <tr
                    key={j}
                    className={cn(
                      spec.rule ? 'border-t-2' : 'border-t',
                      'border-border',
                      spec.total && 'bg-muted/50',
                    )}
                  >
                    {cellsOf(r).map((c, i) => {
                      const o = typeof c === 'object' ? c : { text: c };
                      return (
                        <td
                          key={i}
                          className={cn(
                            'h-10 px-3 first:pl-4 last:pr-4',
                            i ? 'text-right whitespace-nowrap' : 'min-w-[120px] text-left',
                            (o.strong || spec.total) && 'font-semibold',
                            o.muted && 'text-muted-foreground',
                            o.danger && 'text-danger',
                            o.warn && 'text-warning-foreground',
                            o.good && 'text-success-foreground',
                            i === 0 && o.indent && 'pl-7 first:pl-7',
                          )}
                        >
                          {o.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hint && <p className="-mt-1 px-4 text-xs text-muted-foreground">{hint}</p>}
      {link && (
        <Button variant="ghost" asChild className="-mt-1 ml-2 h-7 self-start px-2 md:h-7">
          <Link to={link.to} search={link.search as never}>
            {link.label}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      )}
      <span aria-hidden className="h-1" />
    </section>
  );
}

/** Report tables two by two on wide screens, one under another on phones. */
export function ReportBlocks({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-2">{children}</div>;
}

/** A heading between groups of tables, across both columns. */
export function ReportHeading({ children }: { children: ReactNode }) {
  return <h2 className="mt-2 text-base leading-6 font-semibold lg:col-span-2">{children}</h2>;
}

/**
 * A report's title, the line under it and its actions, as drawn. Phones keep
 * the title alone: the line and the actions are for wide screens.
 */
export function ReportHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-muted-foreground max-md:hidden">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-md:hidden">{actions}</div>}
    </div>
  );
}

/** The report's own choices ("Show by", "Products by"), side by side. */
export function ReportControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-3">{children}</div>;
}

/**
 * A note about how the report counts: a muted line with its icon, or an
 * amber banner for something to act on (costs missing, stock unvalued).
 */
export function ReportNote({
  icon: Icon = CircleAlert,
  warn,
  children,
}: {
  icon?: LucideIcon;
  warn?: boolean;
  children: ReactNode;
}) {
  if (warn)
    return (
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-[10px] border border-[color-mix(in_oklch,var(--tone-warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--tone-warn)_7%,transparent)] px-3.5 py-3 text-[13px]"
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--tone-warn)]" />
        <p>{children}</p>
      </div>
    );
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
      <Icon aria-hidden className="mt-[3px] size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * "+16.4% vs. before" under a figure: the change from the same number of
 * days just before, green up, red down; nothing when there was nothing before.
 */
export function changeNote(
  now: number,
  before: number | null | undefined,
  locale: Locale,
  t: (key: AdminKey, params?: Record<string, string | number>) => string,
): ReactNode {
  if (!before) return undefined;
  const c = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
  const sign = c > 0 ? '+' : c < 0 ? '−' : '';
  return (
    <span
      className={
        c > 0 ? 'text-success-foreground' : c < 0 ? 'text-danger' : 'text-muted-foreground'
      }
    >
      {t('reports.vsBefore', { change: `${sign}${formatNumber(locale, Math.abs(c))}%` })}
    </span>
  );
}
