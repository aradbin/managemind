// A report's table (phase-5a-plan §3.15): a caption, a header row and
// right-aligned figures, scrolling sideways on phones. With `exportName`
// it saves itself as Excel or CSV (phase-8-plan §3.8), from `exportRows`
// (counts and money as numbers) or else the cells as shown.
import type { ReportCell } from '../lib/report-export';
import { ExportButtons } from './export-buttons';

export function Table({
  caption,
  head,
  rows,
  empty,
  exportName,
  exportRows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
  empty: string;
  exportName?: string;
  exportRows?: ReportCell[][];
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{caption}</h2>
        {exportName && rows.length > 0 && (
          <ExportButtons
            name={exportName}
            what={caption}
            head={head}
            rows={() => exportRows ?? rows}
          />
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div
          // Wide tables scroll sideways on phones; keyboard users can scroll them too.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable (WCAG 2.1.1).
          tabIndex={0}
          className="-mx-4 overflow-x-auto border-y border-border md:-mx-5"
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted-foreground">
              <tr>
                {head.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={`px-4 py-2.5 font-medium md:px-5 ${i ? 'text-right' : ''}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j} className="border-t border-border">
                  {r.map((cell, i) => (
                    <td
                      key={i}
                      className={`px-4 py-2.5 md:px-5 ${i ? 'whitespace-nowrap text-right tabular-nums' : ''}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
