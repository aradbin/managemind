import { describe, expect, it } from 'vitest';
import { csvRows, customerTable, localPhone, orderTable } from './order-export';
import type { OrderDetail } from './orders';

const names = (en: string, bn: string) => ({ en, bn });
const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    number: 1001,
    displayNumber: '#1001',
    status: 'confirmed',
    paymentStatus: 'unpaid',
    deliveryStatus: 'not_shipped',
    source: 'facebook',
    contact: { name: 'Nasrin', phone: '+8801712000111' },
    address: {
      divisionId: 6,
      districtId: 47,
      areaId: 513,
      line: 'Flat 3B, Road 4',
      names: {
        division: names('Dhaka', 'ঢাকা'),
        district: names('Dhaka', 'ঢাকা'),
        area: names('Dhanmondi', 'ধানমন্ডি'),
      },
    },
    zone: { id: null, name: names('Inside Dhaka', 'ঢাকার ভেতরে') },
    lines: [
      {
        id: 'l1',
        title: names('Kurta', 'কুর্তা'),
        optionLabels: [names('M', 'M')],
        sku: 'K-M',
        quantity: 2,
        unitPrice: 150_000,
        discount: 0,
        total: 300_000,
        weightGrams: 400,
      },
      {
        id: 'l2',
        title: names('Scarf', 'স্কার্ফ'),
        optionLabels: [],
        sku: null,
        quantity: 1,
        unitPrice: 50_000,
        discount: 5_000,
        total: 45_000,
        weightGrams: null,
      },
    ],
    totals: {
      subtotal: 350_000,
      discountTotal: 5_000,
      deliveryFee: 7_000,
      deliveryDiscount: 0,
      vatTotal: 0,
      vatIncluded: false,
      rounding: 0,
      total: 352_000,
      paidTotal: 50_000,
      codDue: 302_050,
      refundDue: 0,
    },
    tags: ['vip'],
    customerNote: 'Call first',
    placedAt: '2026-10-17T10:00:00.000Z',
    ...over,
  }) as unknown as OrderDetail;

describe('order export', () => {
  it('writes one row per line, with order totals on the first only', () => {
    const { header, rows } = orderTable('full', [order()], 'en');
    expect(rows).toHaveLength(2);
    const col = (name: string) => header.indexOf(name);
    expect(rows[0]?.[col('item')]).toBe('Kurta / M');
    expect(rows[0]?.[col('total')]).toBe('3520');
    expect(rows[1]?.[col('total')]).toBe('');
    expect(rows[1]?.[col('line_discount')]).toBe('50');
  });

  it('writes Steadfast and Pathao rows with the local phone and the COD to collect', () => {
    const steadfast = orderTable('steadfast', [order()], 'bn');
    expect(steadfast.header).toEqual(['Invoice', 'Name', 'Address', 'Phone', 'Amount', 'Note']);
    expect(steadfast.rows[0]).toEqual([
      '#1001',
      'Nasrin',
      'Flat 3B, Road 4, Dhanmondi, Dhaka',
      '01712000111',
      // Whole taka, rounded up so the courier never collects too little.
      '3021',
      'Call first',
    ]);
    const pathao = orderTable('pathao', [order()], 'en');
    const row = pathao.rows[0] as string[];
    expect(row[pathao.header.indexOf('RecipientCity')]).toBe('Dhaka');
    expect(row[pathao.header.indexOf('RecipientZone')]).toBe('Dhanmondi');
    expect(row[pathao.header.indexOf('ItemQuantity')]).toBe('3');
    expect(row[pathao.header.indexOf('ItemWeight')]).toBe('0.8');
  });

  it('writes customers with the columns the import reads back', () => {
    const { header, rows } = customerTable([
      {
        name: 'Rahim',
        phone: '+8801711000001',
        email: null,
        tags: ['vip', 'dhaka'],
        note: null,
        orderCount: 3,
        totalSpent: 450_050,
        lastOrderAt: '2026-10-01T08:00:00.000Z',
      },
    ]);
    expect(header.slice(0, 3)).toEqual(['name', 'phone', 'email']);
    expect(rows[0]).toEqual([
      'Rahim',
      '01711000001',
      '',
      'vip, dhaka',
      '',
      '3',
      '4500.50',
      '2026-10-01',
    ]);
    expect(localPhone('+8801999000000')).toBe('01999000000');
  });

  it('keeps typed text from running as a formula in the CSV, and the courier files as typed', () => {
    const risky = order({
      contact: { name: '=HYPERLINK("http://x.test")', phone: '+8801712000111' },
      customerNote: '@SUM(A1)',
      tags: ['-vip'],
    } as Partial<OrderDetail>);
    const full = orderTable('full', [risky], 'en');
    const col = (name: string) => full.header.indexOf(name);
    const [first, second] = csvRows(full);
    expect(first?.[col('name')]).toBe(`'=HYPERLINK("http://x.test")`);
    expect(first?.[col('note')]).toBe(`'@SUM(A1)`);
    expect(first?.[col('tags')]).toBe(`'-vip`);
    // The phone the server checked, and money, stay as they are.
    expect(first?.[col('phone')]).toBe('+8801712000111');
    expect(first?.[col('total')]).toBe('3520');
    expect(second?.[col('note')]).toBe('');
    // The Excel file writes text as text: its rows are left alone.
    expect(full.rows[0]?.[col('name')]).toBe('=HYPERLINK("http://x.test")');

    const steadfast = orderTable('steadfast', [risky], 'en');
    expect(csvRows(steadfast)).toEqual(steadfast.rows);

    const customers = customerTable([
      {
        name: '+Rahim',
        phone: '+8801711000001',
        email: null,
        tags: [],
        note: '=1+1',
        orderCount: 1,
        totalSpent: 0,
        lastOrderAt: null,
      },
    ]);
    expect(csvRows(customers)[0]).toEqual([
      "'+Rahim",
      '01711000001',
      '',
      '',
      "'=1+1",
      '1',
      '0',
      '',
    ]);
  });
});
