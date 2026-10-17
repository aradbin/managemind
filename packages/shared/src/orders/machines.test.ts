import { describe, expect, it } from 'vitest';
import {
  deliveryStatusOf,
  formatOrderNumber,
  orderMachine,
  parseOrderNumber,
  paymentMachine,
  paymentStatusOf,
  shipmentMachine,
} from './machines';

describe('order machine', () => {
  const none = { shippedQuantity: 0 };
  it('goes pending → confirmed → processing → completed', () => {
    expect(orderMachine.transition('pending', 'confirm', none).to).toBe('confirmed');
    expect(orderMachine.transition('confirmed', 'process', none).to).toBe('processing');
    const done = {
      shippedQuantity: 2,
      deliveryStatus: 'delivered',
      paymentStatus: 'paid',
    } as const;
    expect(orderMachine.transition('processing', 'complete', done).to).toBe('completed');
  });

  it('completes only when delivered and paid', () => {
    const ctx = {
      shippedQuantity: 2,
      deliveryStatus: 'delivered',
      paymentStatus: 'unpaid',
    } as const;
    expect(() => orderMachine.transition('processing', 'complete', ctx)).toThrow(
      /not delivered and paid/,
    );
  });

  it('cancels while nothing is shipped, releasing stock and voiding payments', () => {
    for (const from of ['pending', 'confirmed', 'processing'] as const) {
      const t = orderMachine.transition(from, 'cancel', none);
      expect(t.to).toBe('cancelled');
      expect(t.effects).toEqual(['release_stock', 'void_payments', 'return_promotion_uses']);
    }
    expect(() => orderMachine.transition('processing', 'cancel', { shippedQuantity: 1 })).toThrow(
      /already shipped/,
    );
    expect(orderMachine.isFinal('cancelled')).toBe(true);
    expect(orderMachine.isFinal('completed')).toBe(true);
    expect(() => orderMachine.transition('completed', 'cancel', none)).toThrow();
  });

  it('refuses skipping steps', () => {
    expect(orderMachine.can('pending', 'process', none)).toBe(false);
    expect(orderMachine.can('pending', 'complete', none)).toBe(false);
  });
});

describe('shipment machine', () => {
  it('ships, delivers, or fails and returns', () => {
    expect(shipmentMachine.transition('pending', 'ship', undefined).effects).toEqual([
      'sell_from_reservation',
    ]);
    expect(shipmentMachine.transition('shipped', 'deliver', undefined).to).toBe('delivered');
    expect(shipmentMachine.transition('shipped', 'fail', undefined).to).toBe('failed');
    expect(shipmentMachine.transition('failed', 'return', undefined).effects).toEqual(['restock']);
    expect(shipmentMachine.can('pending', 'deliver', undefined)).toBe(false);
    expect(shipmentMachine.can('delivered', 'fail', undefined)).toBe(false);
  });
});

describe('payment rows', () => {
  it('settle or void once', () => {
    expect(paymentMachine.transition('pending', 'settle', undefined).to).toBe('paid');
    expect(paymentMachine.can('paid', 'void', undefined)).toBe(false);
  });
});

describe('derived statuses', () => {
  it('payment follows settled payments against the total', () => {
    expect(paymentStatusOf(0, 1000)).toBe('unpaid');
    expect(paymentStatusOf(400, 1000)).toBe('partially_paid');
    expect(paymentStatusOf(1000, 1000)).toBe('paid');
    expect(paymentStatusOf(0, 0)).toBe('paid');
  });

  it('delivery follows shipments', () => {
    expect(deliveryStatusOf(3, [])).toBe('not_shipped');
    expect(deliveryStatusOf(3, [{ status: 'pending', quantity: 3 }])).toBe('not_shipped');
    expect(deliveryStatusOf(3, [{ status: 'shipped', quantity: 1 }])).toBe('partially_shipped');
    expect(deliveryStatusOf(3, [{ status: 'shipped', quantity: 3 }])).toBe('shipped');
    expect(
      deliveryStatusOf(3, [
        { status: 'delivered', quantity: 1 },
        { status: 'shipped', quantity: 2 },
      ]),
    ).toBe('shipped');
    expect(
      deliveryStatusOf(3, [
        { status: 'delivered', quantity: 1 },
        { status: 'delivered', quantity: 2 },
      ]),
    ).toBe('delivered');
    expect(deliveryStatusOf(3, [{ status: 'failed', quantity: 3 }])).toBe('failed');
    expect(
      deliveryStatusOf(3, [
        { status: 'returned', quantity: 3 },
        { status: 'shipped', quantity: 3 },
      ]),
    ).toBe('shipped');
  });
});

describe('order numbers', () => {
  it('format with the prefix and parse what shoppers type', () => {
    expect(formatOrderNumber('#', 1001)).toBe('#1001');
    expect(formatOrderNumber('AR-', 1001)).toBe('AR-1001');
    expect(parseOrderNumber('#1001')).toBe(1001);
    expect(parseOrderNumber(' AR-1001 ')).toBe(1001);
    expect(parseOrderNumber('১০০১')).toBe(1001);
    expect(parseOrderNumber('order')).toBeNull();
    expect(parseOrderNumber('0')).toBeNull();
  });
});
