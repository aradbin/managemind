// Saving a file the browser built: CSV text for Excel, and the download itself.

// Text a spreadsheet would read as a formula (=, +, -, @, or a tab or
// return first) gets a leading apostrophe, so a shopper's name or a note
// can't run as one when the CSV opens in Excel (OWASP's CSV injection).
// Only for text people typed: numbers and money we write stay as they are.
const FORMULA = /^[=+\-@\t\r]/;

/** A text cell made safe to open in a spreadsheet. */
export const formulaSafe = (value: string): string => (FORMULA.test(value) ? `'${value}` : value);

/** CSV with a byte-order mark, so Excel shows Bangla. */
export function toCsv(header: string[], rows: string[][]): string {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
