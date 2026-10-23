import { describe, expect, it } from 'vitest';
import {
  addDays,
  billingPeriod,
  checkLimit,
  dhakaDate,
  draftInvoiceLines,
  dunningDue,
  type Entitlements,
  invoiceMachine,
  invoiceNumber,
  isOverdue,
  mergeEntitlements,
  PLACEHOLDER_PLANS,
  planInput,
  previousPeriod,
  readEntitlements,
  UNLIMITED,
  usageLevel,
  withTotals,
} from './index';

const starter = PLACEHOLDER_PLANS.find(
  (p) => p.code === 'starter',
) as (typeof PLACEHOLDER_PLANS)[0];

describe('entitlements', () => {
  it('lays a store override over its plan, limit by limit and feature by feature', () => {
    const e = mergeEntitlements(starter.entitlements, {
      limits: { staff: 10, products: null },
      features: { sslcommerz: true },
    });
    expect(e.limits).toMatchObject({ staff: 10, products: null, ordersPerMonth: 500 });
    expect(e.features).toMatchObject({ sslcommerz: true, sms: false });
    expect(mergeEntitlements(starter.entitlements, null)).toEqual(starter.entitlements);
  });

  it('reads an empty value as unlimited, so stores from before plans lose nothing', () => {
    expect(readEntitlements({})).toEqual(UNLIMITED);
    expect(readEntitlements(starter.entitlements)).toEqual(starter.entitlements);
  });

  it('checks a hard limit: product 301 on a 300-product plan is refused', () => {
    const e: Entitlements = starter.entitlements;
    expect(checkLimit(e, 'products', 299)).toEqual({ ok: true, limit: 300 });
    expect(checkLimit(e, 'products', 300)).toEqual({ ok: false, limit: 300, used: 300 });
    expect(checkLimit(e, 'products', 290, 20)).toMatchObject({ ok: false });
    expect(checkLimit(UNLIMITED, 'products', 1e6)).toEqual({ ok: true, limit: null });
  });

  it('warns a soft limit at 80% and 100%', () => {
    expect(usageLevel(399, 500)).toBe('ok');
    expect(usageLevel(400, 500)).toBe('warn');
    expect(usageLevel(500, 500)).toBe('over');
    expect(usageLevel(9e9, null)).toBe('ok');
  });

  it('every placeholder plan is valid input', () => {
    for (const p of PLACEHOLDER_PLANS) expect(planInput.parse(p)).toEqual(p);
  });
});

describe('invoice drafting', () => {
  const base = {
    plan: starter,
    priceOverride: null,
    firstInvoice: false,
    setupFeeOverride: null,
    period: billingPeriod('2026-11-05'),
    trialEndsOn: null,
    overage: [],
    vatRateBp: null,
  };

  it('bills the coming month, and the setup fee on the first invoice only', () => {
    const first = draftInvoiceLines({ ...base, firstInvoice: true });
    expect(first.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['setup', 5_000_00],
      ['plan', 1_500_00],
    ]);
    expect(first.total).toBe(6_500_00);
    expect(draftInvoiceLines(base).lines.map((l) => l.kind)).toEqual(['plan']);
  });

  it('uses negotiated prices', () => {
    const d = draftInvoiceLines({
      ...base,
      firstInvoice: true,
      priceOverride: 1_000_00,
      setupFeeOverride: 0,
    });
    expect(d.lines.map((l) => [l.kind, l.amount])).toEqual([['plan', 1_000_00]]);
  });

  it('charges nothing for the plan while on trial, but still the overage', () => {
    const d = draftInvoiceLines({
      ...base,
      trialEndsOn: '2026-11-30',
      overage: [{ metric: 'orders', used: 520, included: 500, unitPrice: 5_00 }],
    });
    expect(d.lines.map((l) => [l.kind, l.quantity, l.amount])).toEqual([['overage', 20, 100_00]]);
  });

  it('bills only the units beyond the plan, and nothing for unlimited metrics', () => {
    const d = draftInvoiceLines({
      ...base,
      overage: [
        { metric: 'orders', used: 499, included: 500, unitPrice: 5_00 },
        { metric: 'emails', used: 9_000, included: null, unitPrice: 1_00 },
      ],
    });
    expect(d.lines.map((l) => l.kind)).toEqual(['plan']);
  });

  it('adds VAT as a line, rounded half up on the subtotal', () => {
    // 1,500.00 + 3 × 3.33 = 1,509.99; 15% = 226.4985 -> 226.50
    const d = draftInvoiceLines({
      ...base,
      overage: [{ metric: 'orders', used: 503, included: 500, unitPrice: 3_33 }],
      vatRateBp: 1_500,
    });
    expect(d.subtotal).toBe(1_509_99);
    expect(d.vat).toBe(226_50);
    expect(d.total).toBe(1_736_49);
    expect(d.lines.at(-1)).toMatchObject({ kind: 'vat', amount: 226_50 });
    expect(withTotals(d.lines, 1_500)).toEqual(d);
  });

  it('numbers an invoice by its year and the platform sequence', () => {
    expect(invoiceNumber('2026-11-07', 1)).toBe('INV-2026-0001');
    expect(invoiceNumber('2027-01-02', 12_345)).toBe('INV-2027-12345');
  });

  it('moves draft -> issued -> paid, and either to void, never back', () => {
    expect(invoiceMachine.transition('draft', 'issue', undefined).to).toBe('issued');
    expect(invoiceMachine.transition('issued', 'pay', undefined).to).toBe('paid');
    expect(invoiceMachine.can('draft', 'void', undefined)).toBe(true);
    expect(invoiceMachine.can('paid', 'void', undefined)).toBe(false);
    expect(invoiceMachine.can('void', 'issue', undefined)).toBe(false);
  });

  it('is overdue only when issued and past its due date', () => {
    expect(isOverdue('issued', '2026-11-12', '2026-11-12')).toBe(false);
    expect(isOverdue('issued', '2026-11-12', '2026-11-13')).toBe(true);
    expect(isOverdue('paid', '2026-11-12', '2026-12-01')).toBe(false);
  });
});

describe('billing dates (Asia/Dhaka)', () => {
  it('takes the Dhaka date of an instant', () => {
    expect(dhakaDate(new Date('2026-10-31T18:30:00Z'))).toBe('2026-11-01');
    expect(dhakaDate(new Date('2026-10-31T17:59:59Z'))).toBe('2026-10-31');
  });

  it('runs a period to the day before the same day next month, across years', () => {
    expect(billingPeriod('2026-12-28')).toEqual({ start: '2026-12-28', end: '2027-01-27' });
    expect(billingPeriod('2027-01-28')).toEqual({ start: '2027-01-28', end: '2027-02-27' });
    expect(previousPeriod('2027-01-05')).toEqual({ start: '2026-12-05', end: '2027-01-04' });
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
  });
});

describe('reminders and suspension (Q9)', () => {
  const due = '2026-11-12';
  it('reaches each step on its day, and every earlier step too', () => {
    expect(dunningDue(due, addDays(due, -4))).toEqual([]);
    expect(dunningDue(due, addDays(due, -3))).toEqual(['due_soon']);
    expect(dunningDue(due, due)).toEqual(['due_soon', 'due_today']);
    expect(dunningDue(due, addDays(due, 3))).toContain('past_due');
    expect(dunningDue(due, addDays(due, 13))).not.toContain('suspend');
    expect(dunningDue(due, addDays(due, 14))).toEqual([
      'due_soon',
      'due_today',
      'past_due',
      'final_notice',
      'suspend',
    ]);
  });

  it('takes no step while a hold lasts, and catches up after', () => {
    expect(dunningDue(due, addDays(due, 20), addDays(due, 20))).toEqual([]);
    expect(dunningDue(due, addDays(due, 21), addDays(due, 20))).toContain('suspend');
  });
});
