import { describe, expect, it } from 'vitest';
import {
  type ImportCategory,
  mapExpenseHeaders,
  mapSupplierHeaders,
  parseExpenseRow,
  parseImportDate,
  parseSupplierRow,
} from './imports';

describe('supplier rows', () => {
  const columns = mapSupplierHeaders(['Supplier', 'Mobile', 'ঠিকানা', 'শহর', 'শুরুর বাকি', 'Notes']);

  it('recognizes English and Bangla headers', () => {
    expect(columns).toEqual({ name: 0, phone: 1, address: 2, city: 3, openingBalance: 4, note: 5 });
  });

  it('reads a supplier with its opening balance in taka, Bangla digits and all', () => {
    const r = parseSupplierRow(
      [
        'Islampur Wholesale',
        '01711-000001, 01811000002',
        'Shop 12, Islampur',
        'Dhaka',
        '১২,৫০০.৫০',
        '',
      ],
      columns,
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({
      row: 2,
      name: 'Islampur Wholesale',
      phones: ['+8801711000001', '+8801811000002'],
      address: { line1: 'Shop 12, Islampur', city: 'Dhaka' },
      openingBalance: 12_500_50,
    });
  });

  it('needs a name, leaves out a phone that isn’t a mobile, and refuses a bad balance', () => {
    expect(parseSupplierRow(['', '', '', '', '', ''], columns, 3).errors).toEqual([
      expect.objectContaining({ field: 'name', code: 'required' }),
    ]);
    const landline = parseSupplierRow(['Chawkbazar', '02-9551234', '', '', '', ''], columns, 4);
    expect(landline.supplier?.phones).toEqual([]);
    expect(landline.warnings).toEqual([
      expect.objectContaining({ field: 'phone', code: 'invalid' }),
    ]);
    expect(parseSupplierRow(['Chawkbazar', '', '', '', 'a lot', ''], columns, 5).errors).toEqual([
      expect.objectContaining({ field: 'openingBalance' }),
    ]);
  });
});

describe('expense rows', () => {
  const categories: ImportCategory[] = [
    {
      id: '0199d000-0000-7000-8000-000000000001',
      key: 'rent',
      name: { bn: 'ভাড়া', en: 'Rent' },
      archived: false,
    },
    {
      id: '0199d000-0000-7000-8000-000000000002',
      key: 'other',
      name: { bn: 'অন্যান্য', en: 'Other' },
      archived: false,
    },
    {
      id: '0199d000-0000-7000-8000-000000000003',
      key: null,
      name: { bn: 'পুরোনো', en: 'Old' },
      archived: true,
    },
  ];
  const columns = mapExpenseHeaders(['তারিখ', 'Category', 'Amount', 'Paid by', 'Paid to', 'বিবরণ']);
  const row = (cells: string[]) => parseExpenseRow(cells, columns, 2, categories, '2026-10-26');

  it('reads dates as people write them, and refuses impossible or future ones', () => {
    expect(parseImportDate('2026-09-05')).toBe('2026-09-05');
    expect(parseImportDate('05/09/2026')).toBe('2026-09-05');
    expect(parseImportDate('৫-৯-২০২৬')).toBe('2026-09-05');
    expect(parseImportDate('31/02/2026')).toBeNull();
    expect(row(['2026-11-01', 'Rent', '1000', 'cash', '', '']).errors).toEqual([
      expect.objectContaining({ field: 'date', code: 'future' }),
    ]);
  });

  it('matches the category by either name and the method by its usual words', () => {
    const r = row(['01/09/2026', 'ভাড়া', '25,000', 'Bank transfer', 'Landlord', 'September']);
    expect(r.warnings).toEqual([]);
    expect(r.expense).toEqual({
      row: 2,
      spentOn: '2026-09-01',
      categoryId: categories[0]?.id,
      amount: 25_000_00,
      method: 'bank',
      payee: 'Landlord',
      note: 'September',
    });
  });

  it('files an unknown or archived category under Other, and an unknown method as cash', () => {
    const r = row(['2026-09-02', 'Old', '50', 'gold coins', '', '']);
    expect(r.expense).toMatchObject({ categoryId: categories[1]?.id, method: 'cash' });
    expect(r.warnings.map((w) => [w.field, w.code])).toEqual([
      ['category', 'unmatched'],
      ['method', 'unmatched'],
    ]);
  });

  it('needs an amount above zero', () => {
    expect(row(['2026-09-02', 'Rent', '0', 'cash', '', '']).errors).toEqual([
      expect.objectContaining({ field: 'amount' }),
    ]);
  });
});
