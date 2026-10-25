import { describe, expect, it } from 'vitest';
import {
  deliveryStatusOf,
  formatOrderNumber,
  orderMachine,
  parseOrderNumber,
  paymentMachine,
  paymentStatusOf,
  refundMachine,
  refundShare,
  returnMachine,
  returnStatusOf,
  shipmentMachine,
  shipmentPath,
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

  it('books, unbooks, and carries a courier parcel (phase-7-plan §3.1)', () => {
    expect(shipmentMachine.transition('pending', 'book', undefined).effects).toEqual([]);
    expect(shipmentMachine.transition('booked', 'unbook', undefined).to).toBe('pending');
    expect(shipmentMachine.transition('booked', 'ship', undefined).effects).toEqual([
      'sell_from_reservation',
    ]);
    expect(shipmentMachine.transition('shipped', 'transit', undefined).to).toBe('in_transit');
    expect(shipmentMachine.transition('in_transit', 'deliver', undefined).effects).toEqual([
      'settle_cod',
    ]);
    expect(shipmentMachine.transition('in_transit', 'fail', undefined).to).toBe('failed');
    expect(shipmentMachine.can('booked', 'deliver', undefined)).toBe(false);
    expect(shipmentMachine.can('in_transit', 'unbook', undefined)).toBe(false);
  });

  it("walks the shortest legal path to a courier's state", () => {
    expect(shipmentPath('booked', 'booked')).toEqual([]);
    expect(shipmentPath('booked', 'delivered')).toEqual(['ship', 'deliver']);
    expect(shipmentPath('pending', 'in_transit')).toEqual(['ship', 'transit']);
    expect(shipmentPath('booked', 'failed')).toEqual(['ship', 'fail']);
    expect(shipmentPath('booked', 'returned')).toEqual(['ship', 'fail', 'return']);
    expect(shipmentPath('booked', 'pending')).toEqual(['unbook']);
    expect(shipmentPath('in_transit', 'shipped')).toBeNull();
    expect(shipmentPath('delivered', 'failed')).toBeNull();
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
    expect(deliveryStatusOf(3, [{ status: 'in_transit', quantity: 3 }])).toBe('shipped');
    expect(deliveryStatusOf(3, [{ status: 'booked', quantity: 3 }])).toBe('not_shipped');
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

describe('online payments and refunds (phase-5a-plan §3.2)', () => {
  it('expires a pending session, and still settles a late payment', () => {
    expect(paymentMachine.transition('pending', 'expire', undefined).to).toBe('expired');
    expect(paymentMachine.transition('expired', 'settle', undefined).to).toBe('paid');
    expect(paymentMachine.can('expired', 'void', undefined)).toBe(false);
  });

  it('marks any refund, and refunding everything paid', () => {
    expect(paymentStatusOf(1000, 1000, 300)).toBe('partially_refunded');
    expect(paymentStatusOf(1000, 1000, 1000)).toBe('refunded');
    // An edit left the order overpaid; refunding the difference is still a refund.
    expect(paymentStatusOf(1000, 800, 200)).toBe('partially_refunded');
  });

  it('completes a delivered order that was partly refunded', () => {
    const t = orderMachine.transition('processing', 'complete', {
      shippedQuantity: 1,
      deliveryStatus: 'delivered',
      paymentStatus: 'partially_refunded',
    });
    expect(t.to).toBe('completed');
  });

  it('refunds gateway refunds through processing, and records manual ones at once', () => {
    expect(refundMachine.transition('pending', 'submit', undefined).to).toBe('processing');
    expect(refundMachine.transition('processing', 'succeed', undefined).to).toBe('succeeded');
    expect(refundMachine.transition('pending', 'succeed', undefined).to).toBe('succeeded');
    expect(refundMachine.can('succeeded', 'fail', undefined)).toBe(false);
  });
});

describe('returns (phase-5a-plan §3.12)', () => {
  it('goes requested, approved, in transit or straight to received, inspected, resolved', () => {
    expect(returnMachine.transition('requested', 'approve', undefined).to).toBe('approved');
    expect(returnMachine.transition('approved', 'send', undefined).to).toBe('in_transit');
    expect(returnMachine.transition('approved', 'receive', undefined).to).toBe('received');
    const inspect = returnMachine.transition('received', 'inspect', undefined);
    expect(inspect).toMatchObject({ to: 'inspected', effects: ['restock'] });
    expect(returnMachine.transition('inspected', 'resolve', undefined).to).toBe('resolved');
  });

  it('never inspects what has not arrived, nor reopens a rejection', () => {
    expect(returnMachine.can('approved', 'inspect', undefined)).toBe(false);
    expect(returnMachine.can('rejected', 'approve', undefined)).toBe(false);
  });

  it('derives the order return status', () => {
    expect(returnStatusOf(3, [])).toBe('none');
    expect(returnStatusOf(3, [{ status: 'requested', quantity: 1 }])).toBe('requested');
    expect(returnStatusOf(3, [{ status: 'rejected', quantity: 1 }])).toBe('none');
    expect(returnStatusOf(3, [{ status: 'received', quantity: 1 }])).toBe('partially_returned');
    expect(
      returnStatusOf(3, [
        { status: 'resolved', resolution: 'refunded', quantity: 1 },
        { status: 'inspected', quantity: 2 },
      ]),
    ).toBe('returned');
    expect(returnStatusOf(3, [{ status: 'resolved', resolution: 'rejected', quantity: 3 }])).toBe(
      'none',
    );
  });
});

describe('refund shares (phase-5a-plan §3.13)', () => {
  it('adds up to the line total over any sequence of partial returns', () => {
    // ৳1,000.00 for 3 units after discounts: 333.33, 333.34, 333.33.
    const lineTotal = 100_000;
    const one = refundShare(lineTotal, 3, 0, 1);
    const two = refundShare(lineTotal, 3, 1, 1);
    const three = refundShare(lineTotal, 3, 2, 1);
    expect(one + two + three).toBe(lineTotal);
    expect(refundShare(lineTotal, 3, 0, 1) + refundShare(lineTotal, 3, 1, 2)).toBe(lineTotal);
    expect(refundShare(lineTotal, 3, 0, 3)).toBe(lineTotal);
  });

  it('refuses more units than the line has left', () => {
    expect(() => refundShare(1000, 2, 1, 2)).toThrow(RangeError);
    expect(() => refundShare(1000, 2, 0, 0)).toThrow(RangeError);
  });
});
