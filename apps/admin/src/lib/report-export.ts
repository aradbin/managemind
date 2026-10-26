// A report's table as a file (phase-8-plan §3.8): built in the browser from
// the JSON the page already has, as the catalog and order exports are. CSV
// is UTF-8 with a byte-order mark so Excel shows Bangla; Excel keeps counts
// and money as numbers.
import { download, toCsv } from './download';
import type { ReportCell } from './xlsx';

export type { ReportCell };
export type ReportFormat = 'xlsx' | 'csv';

const text = (cell: ReportCell) =>
  cell === null ? '' : typeof cell === 'object' ? (cell.money / 100).toFixed(2) : String(cell);

/** The CSV text: money as taka with two decimals and no separators, so Excel reads numbers. */
export const reportCsv = (header: string[], rows: ReportCell[][]) =>
  toCsv(
    header,
    rows.map((r) => r.map(text)),
  );

/** Saves `name-YYYY-MM-DD.xlsx` or `.csv`. */
export async function saveReport(
  name: string,
  header: string[],
  rows: ReportCell[][],
  format: ReportFormat,
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    const { writeReportXlsx } = await import('./xlsx');
    download(`${name}-${stamp}.xlsx`, await writeReportXlsx(header, rows));
  } else {
    download(
      `${name}-${stamp}.csv`,
      new Blob(
        [
          toCsv(
            header,
            rows.map((r) => r.map(text)),
          ),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
    );
  }
}

/** Every page of a cursor list, for an export: at most `max` pages. */
export async function allPages<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  max = 100,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < max; i++) {
    const p = await page(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}
