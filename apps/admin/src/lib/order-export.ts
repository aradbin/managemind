// Order export rows (phase-4-plan §3.17): the full export, one row per line,
// and the Steadfast and Pathao bulk-upload files, one row per order. The
// courier columns follow their public templates; the merchant panels' own
// sample files, when the owner sends them, replace these lists here.
import type { Locale } from '@managemind/shared/i18n';
import { amountToDecimal } from '@managemind/shared/money';
import { formulaSafe } from './download';
import type { OrderDetail } from './orders';
import { pickText } from './orders';

export const EXPORT_FORMATS = ['full', 'steadfast', 'pathao'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportTable {
  header: string[];
  rows: string[][];
  /**
   * The columns of text a shopper or staff typed, which the CSV keeps from
   * running as a formula (csvRows). The courier files have none: their
   * uploads take the text exactly as it is (phase-8-report §5).
   */
  typed?: string[];
}

/** The rows for a CSV: typed text made safe to open in Excel. Excel files write text as text. */
export function csvRows(table: ExportTable): string[][] {
  const typed = new Set(table.typed);
  if (!typed.size) return table.rows;
  const guard = table.header.map((h) => typed.has(h));
  return table.rows.map((r) => r.map((v, i) => (guard[i] ? formulaSafe(v) : v)));
}

/** 01712345678 from +8801712345678: couriers want the local form. */
export const localPhone = (phone: string) => phone.replace(/^\+?88/, '');

const street = (o: OrderDetail) => o.address?.line ?? '';
/** The full address in English, as couriers read it. */
const fullAddress = (o: OrderDetail) =>
  o.address
    ? [o.address.line, o.address.names.area.en, o.address.names.district.en]
        .filter(Boolean)
        .join(', ')
    : '';
const itemSummary = (o: OrderDetail, locale: Locale) =>
  o.lines.map((l) => `${pickText(l.title, locale)} x${l.quantity}`).join(', ');
const weightKg = (o: OrderDetail) => {
  const grams = o.lines.reduce((a, l) => a + (l.weightGrams ?? 0) * l.quantity, 0);
  return grams ? String(Math.max(0.5, Math.round(grams / 100) / 10)) : '0.5';
};
/** What the courier collects: the COD still due, in whole taka. */
const collect = (o: OrderDetail) => String(Math.ceil(o.totals.codDue / 100));

export function orderTable(
  format: ExportFormat,
  orders: readonly OrderDetail[],
  locale: Locale,
): ExportTable {
  if (format === 'steadfast') {
    return {
      header: ['Invoice', 'Name', 'Address', 'Phone', 'Amount', 'Note'],
      rows: orders.map((o) => [
        o.displayNumber,
        o.contact.name,
        fullAddress(o),
        localPhone(o.contact.phone),
        collect(o),
        o.customerNote ?? '',
      ]),
    };
  }
  if (format === 'pathao') {
    return {
      header: [
        'ItemType',
        'StoreName',
        'MerchantOrderId',
        'RecipientName',
        'RecipientPhone',
        'RecipientCity',
        'RecipientZone',
        'RecipientArea',
        'RecipientAddress',
        'AmountToCollect',
        'ItemQuantity',
        'ItemWeight',
        'ItemDesc',
        'SpecialInstruction',
      ],
      rows: orders.map((o) => [
        'Parcel',
        '',
        o.displayNumber,
        o.contact.name,
        localPhone(o.contact.phone),
        o.address?.names.district.en ?? '',
        o.address?.names.area.en ?? '',
        '',
        street(o) || fullAddress(o),
        collect(o),
        String(o.lines.reduce((a, l) => a + l.quantity, 0)),
        weightKg(o),
        itemSummary(o, 'en'),
        o.customerNote ?? '',
      ]),
    };
  }
  const header = [
    'order',
    'placed_at',
    'status',
    'payment_status',
    'delivery_status',
    'source',
    'name',
    'phone',
    'email',
    'division',
    'district',
    'area',
    'address',
    'zone',
    'sku',
    'item',
    'quantity',
    'unit_price',
    'line_discount',
    'line_total',
    'subtotal',
    'discount_total',
    'delivery_fee',
    'vat_total',
    'total',
    'paid',
    'cod_due',
    'tags',
    'note',
  ];
  const money = (n: number) => amountToDecimal(n);
  const rows = orders.flatMap((o) =>
    o.lines.map((l, i) => [
      o.displayNumber,
      o.placedAt,
      o.status,
      o.paymentStatus,
      o.deliveryStatus,
      o.source,
      o.contact.name,
      o.contact.phone,
      o.contact.email ?? '',
      pickText(o.address?.names.division, locale),
      pickText(o.address?.names.district, locale),
      pickText(o.address?.names.area, locale),
      street(o),
      pickText(o.zone.name, locale),
      l.sku ?? '',
      [pickText(l.title, locale), ...l.optionLabels.map((x) => pickText(x, locale))]
        .filter(Boolean)
        .join(' / '),
      String(l.quantity),
      money(l.unitPrice),
      money(l.discount),
      money(l.total),
      // Order totals on the first line only, so a sum of the column is right.
      ...(i === 0
        ? [
            money(o.totals.subtotal),
            money(o.totals.discountTotal),
            money(o.totals.deliveryFee - o.totals.deliveryDiscount),
            money(o.totals.vatTotal),
            money(o.totals.total),
            money(o.totals.paidTotal),
            money(o.totals.codDue),
            o.tags.join(', '),
            o.customerNote ?? '',
          ]
        : ['', '', '', '', '', '', '', '', '']),
    ]),
  );
  // The phone is checked by the server and money is ours: they stay as they are.
  return {
    header,
    rows,
    typed: ['name', 'email', 'address', 'zone', 'sku', 'item', 'tags', 'note'],
  };
}

/** Customers, one row per customer, with the columns the customer import reads back. */
export function customerTable(
  customers: readonly {
    name: string;
    phone: string;
    email: string | null;
    tags: string[];
    note: string | null;
    orderCount: number;
    totalSpent: number;
    lastOrderAt: string | null;
  }[],
): ExportTable {
  return {
    header: ['name', 'phone', 'email', 'tags', 'note', 'orders', 'total_spent', 'last_order'],
    rows: customers.map((c) => [
      c.name,
      localPhone(c.phone),
      c.email ?? '',
      c.tags.join(', '),
      c.note ?? '',
      String(c.orderCount),
      amountToDecimal(c.totalSpent),
      c.lastOrderAt?.slice(0, 10) ?? '',
    ]),
    typed: ['name', 'email', 'tags', 'note'],
  };
}
