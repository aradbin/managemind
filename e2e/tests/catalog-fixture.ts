// Products of the 500-product import fixture as a CSV file with the export's English
// headers, built from the same rows the API's import test uses
// (apps/api/test/import-fixture.ts). Image links are left out: the fixture's
// hosts don't exist, and the image step is covered with an upload instead.
import { fixtureRows } from '../../apps/api/test/import-fixture';
import { type ColumnRef, exportHeader } from '../../packages/shared/src/catalog/import';

function refOf(id: string): ColumnRef {
  const [field, a, b] = id.split(':');
  if (field === 'attribute') {
    return b
      ? { field, attributeKey: a as string, locale: b as 'bn' | 'en' }
      : { field, attributeKey: a as string };
  }
  return (a ? { field, locale: a } : { field }) as ColumnRef;
}

const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function fixtureCsv(count: number, prefix: string): string {
  const rows = fixtureRows(count, prefix);
  const ids = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((id) => id !== 'images');
  const lines = [
    ids.map((id) => cell(exportHeader(refOf(id), 'en'))).join(','),
    ...rows.map((r) => ids.map((id) => cell(r[id] ?? '')).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
