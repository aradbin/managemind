// Excel files in the browser (phase-2-plan §3.7, §3.11): write-excel-file
// for the export, read-excel-file for the import. Loaded only by the screens
// that use them (a dynamic import), so no other screen downloads them.
import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';

/** An .xlsx with one sheet: the header row in bold, every cell as text (prices stay exact). */
export async function writeXlsx(header: string[], rows: string[][]): Promise<Blob> {
  return writeXlsxFile(
    [
      header.map((value) => ({ value, fontWeight: 'bold' as const })),
      ...rows.map((row) => row.map((value) => ({ value, type: String }))),
    ],
    { stickyRowsCount: 1 },
  ).toBlob();
}

/**
 * The first sheet as text: numbers as typed (no float noise for prices),
 * dates as YYYY-MM-DD, empty cells as ''.
 */
export async function readXlsx(file: File): Promise<string[][]> {
  const [sheet] = await readXlsxFile(file);
  return (sheet?.data ?? []).map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return '';
      if (cell instanceof Date) return cell.toISOString().slice(0, 10);
      if (typeof cell === 'number')
        return Number.isInteger(cell) ? String(cell) : String(Number(cell.toFixed(6)));
      return String(cell);
    }),
  );
}
