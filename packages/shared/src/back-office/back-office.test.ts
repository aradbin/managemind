import { describe, expect, it } from 'vitest';
import { inventoryAdjustments } from '../catalog/schemas';
import {
  documentNumber,
  goodsReceiptInput,
  purchaseOrderInput,
  purchaseOrderMachine,
  receiveEvent,
  recurringExpenseInput,
  stockCountMachine,
  stockCountScope,
  supplierInput,
} from './index';

const variantId = '01900000-0000-7000-8000-000000000001';
const other = '01900000-0000-7000-8000-000000000002';

describe('the purchase order machine (§3.2)', () => {
  it('places, receives in parts, then receives the rest', () => {
    expect(purchaseOrderMachine.transition('draft', 'place', undefined).to).toBe('ordered');
    expect(purchaseOrderMachine.transition('ordered', receiveEvent(3), undefined).to).toBe(
      'partially_received',
    );
    expect(
      purchaseOrderMachine.transition('partially_received', receiveEvent(1), undefined).to,
    ).toBe('partially_received');
    expect(
      purchaseOrderMachine.transition('partially_received', receiveEvent(0), undefined).to,
    ).toBe('received');
    expect(purchaseOrderMachine.isFinal('received')).toBe(true);
  });

  it('closes only a partly received PO, and cancels only before anything arrived', () => {
    expect(purchaseOrderMachine.can('partially_received', 'close', undefined)).toBe(true);
    expect(purchaseOrderMachine.can('ordered', 'close', undefined)).toBe(false);
    expect(purchaseOrderMachine.can('ordered', 'cancel', undefined)).toBe(true);
    expect(purchaseOrderMachine.can('partially_received', 'cancel', undefined)).toBe(false);
    expect(purchaseOrderMachine.can('draft', 'receive', undefined)).toBe(false);
  });

  it('numbers documents per store', () => {
    expect(documentNumber('PO', 1)).toBe('PO-0001');
    expect(documentNumber('GR', 12345)).toBe('GR-12345');
  });
});

describe('the stock count machine (§3.5)', () => {
  it('submits, reopens, applies and finishes', () => {
    expect(stockCountMachine.transition('counting', 'submit', undefined).to).toBe('review');
    expect(stockCountMachine.transition('review', 'reopen', undefined).to).toBe('counting');
    expect(stockCountMachine.transition('review', 'apply', undefined).to).toBe('applying');
    expect(stockCountMachine.transition('applying', 'finish', undefined).to).toBe('applied');
    expect(stockCountMachine.transition('applying', 'fail', undefined).to).toBe('review');
  });

  it('cancels while counting or in review, never once applied', () => {
    expect(stockCountMachine.can('counting', 'cancel', undefined)).toBe(true);
    expect(stockCountMachine.can('review', 'cancel', undefined)).toBe(true);
    expect(stockCountMachine.can('applying', 'cancel', undefined)).toBe(false);
    expect(stockCountMachine.isFinal('applied')).toBe(true);
  });

  it('normalizes a tag scope and dedupes a hand-picked list', () => {
    expect(stockCountScope.parse({ kind: 'tag', tag: '  Eid  Sale ' })).toEqual({
      kind: 'tag',
      tag: 'eid sale',
    });
    expect(
      stockCountScope.parse({ kind: 'variants', variantIds: [variantId, variantId, other] }),
    ).toEqual({ kind: 'variants', variantIds: [variantId, other] });
  });
});

describe('inputs', () => {
  it('normalizes supplier phones and refuses a foreign number', () => {
    expect(
      supplierInput.parse({
        name: ' Chawkbazar  Traders ',
        phones: ['01711000000', '+8801711000000'],
      }),
    ).toMatchObject({ name: 'Chawkbazar Traders', phones: ['+8801711000000'] });
    expect(supplierInput.safeParse({ name: 'X', phones: ['+14155550100'] }).success).toBe(false);
  });

  it('refuses a PO or receipt with the same variant twice', () => {
    const line = { variantId, quantity: 1, unitCost: 100 };
    expect(purchaseOrderInput.safeParse({ supplierId: other, lines: [line, line] }).success).toBe(
      false,
    );
    expect(goodsReceiptInput.safeParse({ lines: [line, line] }).success).toBe(false);
    expect(goodsReceiptInput.parse({ lines: [line] }).otherCosts).toEqual([]);
  });

  it('takes a weekday from 1 to 7 and an end on or after the start', () => {
    const base = {
      categoryId: variantId,
      amount: 100,
      method: 'cash',
      startsOn: '2026-11-01',
    };
    expect(recurringExpenseInput.safeParse({ ...base, cadence: 'weekly', day: 0 }).success).toBe(
      false,
    );
    expect(recurringExpenseInput.safeParse({ ...base, cadence: 'monthly', day: 0 }).success).toBe(
      true,
    );
    expect(
      recurringExpenseInput.safeParse({ ...base, cadence: 'monthly', day: 1, endsOn: '2026-10-01' })
        .success,
    ).toBe(false);
  });

  it('asks for a note with the reason "other" (§3.4)', () => {
    const line = { mode: 'delta', variantId, quantity: -1 } as const;
    expect(inventoryAdjustments.safeParse([{ ...line, reason: 'other' }]).success).toBe(false);
    expect(
      inventoryAdjustments.safeParse([{ ...line, reason: 'other', note: 'to the supplier' }])
        .success,
    ).toBe(true);
    expect(inventoryAdjustments.safeParse([{ ...line, reason: 'expired' }]).success).toBe(true);
  });
});
