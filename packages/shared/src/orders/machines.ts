// An order's four statuses (phase-4-plan §3.6, after Shopify): its own
// lifecycle, plus payment, delivery and returns. The order and each shipment
// are state machines; payment and delivery are derived from the payments and
// shipments, stored as columns and recalculated in the same transaction.
import { toLatinDigits } from '../digits';
import { defineMachine } from '../state-machine';

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_EVENTS = ['confirm', 'process', 'complete', 'cancel'] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export interface OrderContext {
  /** Units of the order in shipments that left the store (shipped, delivered, failed or returned). */
  shippedQuantity: number;
  deliveryStatus?: DeliveryStatus;
  paymentStatus?: PaymentStatus;
}

const nothingShipped = (c: OrderContext) =>
  c.shippedQuantity === 0 || 'something is already shipped';

export const orderMachine = defineMachine<OrderStatus, OrderEvent, OrderContext>({
  name: 'order',
  initial: 'pending',
  states: ORDER_STATUSES,
  transitions: {
    pending: {
      confirm: { to: 'confirmed' },
      cancel: {
        to: 'cancelled',
        guard: nothingShipped,
        effects: ['release_stock', 'void_payments', 'return_promotion_uses'],
      },
    },
    confirmed: {
      process: { to: 'processing' },
      cancel: {
        to: 'cancelled',
        guard: nothingShipped,
        effects: ['release_stock', 'void_payments', 'return_promotion_uses'],
      },
    },
    processing: {
      complete: {
        to: 'completed',
        guard: (c) =>
          (c.deliveryStatus === 'delivered' && c.paymentStatus === 'paid') ||
          'not delivered and paid yet',
      },
      cancel: {
        to: 'cancelled',
        guard: nothingShipped,
        effects: ['release_stock', 'void_payments', 'return_promotion_uses'],
      },
    },
  },
});

export const SHIPMENT_STATUSES = ['pending', 'shipped', 'delivered', 'failed', 'returned'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const SHIPMENT_EVENTS = ['ship', 'deliver', 'fail', 'return'] as const;
export type ShipmentEvent = (typeof SHIPMENT_EVENTS)[number];

/** Phase 7 adds booked, picked_up and in_transit, driven by courier APIs. */
export const shipmentMachine = defineMachine<ShipmentStatus, ShipmentEvent>({
  name: 'shipment',
  initial: 'pending',
  states: SHIPMENT_STATUSES,
  transitions: {
    pending: { ship: { to: 'shipped', effects: ['sell_from_reservation'] } },
    shipped: {
      deliver: { to: 'delivered', effects: ['settle_cod'] },
      fail: { to: 'failed' },
    },
    failed: { return: { to: 'returned', effects: ['restock'] } },
  },
});

export const PAYMENT_RECORD_STATUSES = ['pending', 'paid', 'voided', 'failed'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/** One payment row: settled once, never changed after (Phase 5A's refunds are new rows). */
export const paymentMachine = defineMachine<PaymentRecordStatus, 'settle' | 'void' | 'fail'>({
  name: 'payment',
  initial: 'pending',
  states: PAYMENT_RECORD_STATUSES,
  transitions: {
    pending: { settle: { to: 'paid' }, void: { to: 'voided' }, fail: { to: 'failed' } },
  },
});

/** Phase 5A adds partially_refunded and refunded. */
export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The order's payment status from what settled payments cover. */
export function paymentStatusOf(paidTotal: number, total: number): PaymentStatus {
  if (paidTotal >= total) return 'paid';
  return paidTotal > 0 ? 'partially_paid' : 'unpaid';
}

export const DELIVERY_STATUSES = [
  'not_shipped',
  'partially_shipped',
  'shipped',
  'delivered',
  'failed',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface ShipmentQuantities {
  status: ShipmentStatus;
  /** Units of the order in this shipment. */
  quantity: number;
}

/**
 * The order's delivery status from its shipments. A failed or returned
 * shipment's units count as not shipped again, so the store can send them
 * once more; the order shows `failed` while nothing else is on its way.
 */
export function deliveryStatusOf(
  orderedQuantity: number,
  shipments: readonly ShipmentQuantities[],
): DeliveryStatus {
  let out = 0;
  let delivered = 0;
  let failed = false;
  for (const s of shipments) {
    if (s.status === 'shipped') out += s.quantity;
    if (s.status === 'delivered') delivered += s.quantity;
    if (s.status === 'failed' || s.status === 'returned') failed = true;
  }
  if (orderedQuantity > 0 && delivered >= orderedQuantity) return 'delivered';
  if (orderedQuantity > 0 && out + delivered >= orderedQuantity) return 'shipped';
  if (out + delivered > 0) return 'partially_shipped';
  return failed ? 'failed' : 'not_shipped';
}

/** Phase 5A adds requested, partially_returned and returned. */
export const RETURN_STATUSES = ['none'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** History rows name the machine they belong to. */
export const HISTORY_MACHINES = ['order', 'payment', 'delivery', 'shipment', 'edit'] as const;
export type HistoryMachine = (typeof HISTORY_MACHINES)[number];

export const ORDER_SOURCES = ['website', 'facebook', 'phone', 'walk_in', 'other'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** "#" and 1001 by default (Q4): "#1001". */
export const DEFAULT_ORDER_PREFIX = '#';
export const FIRST_ORDER_NUMBER = 1001;

export const formatOrderNumber = (prefix: string, number: number) => `${prefix}${number}`;

/**
 * The number in what a shopper typed on the tracking page: "#1001", "1001",
 * "AR-1001" or Bangla digits. Null when there is no number.
 */
export function parseOrderNumber(input: string): number | null {
  const latin = toLatinDigits(input);
  const match = /(\d{1,12})\s*$/.exec(latin.trim());
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
