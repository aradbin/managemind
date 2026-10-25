// A spreadsheet staff upload (catalog and customer imports, courier
// statements): the first sheet of an .xlsx, or a CSV, as text cells. Each
// parser loads only when a file needs it.

export interface Parsed {
  fileName: string;
  header: string[];
  rows: string[][];
}

/** The file's first sheet (xlsx) or the CSV, as text cells; each parser loads only when needed. */
export async function parseFile(file: File): Promise<Parsed> {
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readXlsx } = await import('./xlsx');
    table = await readXlsx(file);
  } else {
    const Papa = (await import('papaparse')).default;
    const text = (await file.text()).replace(/^﻿/, '');
    table = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
  }
  const [header = [], ...rows] = table;
  return { fileName: file.name, header: header.map((h) => String(h ?? '').trim()), rows };
}
