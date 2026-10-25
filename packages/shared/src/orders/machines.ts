// An order's four statuses (phase-4-plan §3.6, after Shopify): its own
// lifecycle, plus payment, delivery and returns. The order, each shipment,
// each payment, each return and each refund are state machines; the order's
// payment, delivery and return statuses are derived from those rows, stored
// as columns and recalculated in the same transaction.
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
          (c.deliveryStatus === 'delivered' &&
            (c.paymentStatus === 'paid' || c.paymentStatus === 'partially_refunded')) ||
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

export const SHIPMENT_STATUSES = [
  'pending',
  'booked',
  'shipped',
  'in_transit',
  'delivered',
  'failed',
  'returned',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const SHIPMENT_EVENTS = [
  'book',
  'unbook',
  'ship',
  'transit',
  'deliver',
  'fail',
  'return',
] as const;
export type ShipmentEvent = (typeof SHIPMENT_EVENTS)[number];

/**
 * A shipment's life (phase-4-plan §3.7; phase-7-plan §3.1). A courier's
 * parcel is `booked` while the goods are still in the store; `shipped` is
 * the pickup, where stock leaves; `in_transit` is the courier carrying it.
 * A manual shipment goes pending → shipped → delivered as before.
 */
export const shipmentMachine = defineMachine<ShipmentStatus, ShipmentEvent>({
  name: 'shipment',
  initial: 'pending',
  states: SHIPMENT_STATUSES,
  transitions: {
    pending: {
      book: { to: 'booked' },
      ship: { to: 'shipped', effects: ['sell_from_reservation'] },
    },
    booked: {
      unbook: { to: 'pending' },
      ship: { to: 'shipped', effects: ['sell_from_reservation'] },
    },
    shipped: {
      transit: { to: 'in_transit' },
      deliver: { to: 'delivered', effects: ['settle_cod'] },
      fail: { to: 'failed' },
    },
    in_transit: {
      deliver: { to: 'delivered', effects: ['settle_cod'] },
      fail: { to: 'failed' },
    },
    failed: { return: { to: 'returned', effects: ['restock'] } },
  },
});

/** Shipments whose goods are with the courier or the shopper's door: on their way. */
export const SHIPMENT_OUT: readonly ShipmentStatus[] = ['shipped', 'in_transit'];

/**
 * The events that take a shipment from `from` to `to`, in order, by the
 * shortest legal path (§3.1): a courier that reports "delivered" for a parcel
 * still booked here means ship, then deliver. Empty when already there, null
 * when `to` can't be reached.
 */
export function shipmentPath(from: ShipmentStatus, to: ShipmentStatus): ShipmentEvent[] | null {
  if (from === to) return [];
  const seen = new Set<ShipmentStatus>([from]);
  let frontier: Array<{ at: ShipmentStatus; path: ShipmentEvent[] }> = [{ at: from, path: [] }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { at, path } of frontier) {
      for (const event of shipmentMachine.events(at)) {
        // A sync never cancels a booking on its way to somewhere else.
        if (event === 'unbook' && to !== 'pending') continue;
        const target = shipmentMachine.transition(at, event, undefined).to;
        if (seen.has(target)) continue;
        if (target === to) return [...path, event];
        seen.add(target);
        next.push({ at: target, path: [...path, event] });
      }
    }
    frontier = next;
  }
  return null;
}

export const PAYMENT_PROVIDERS = ['cod', 'manual', 'sslcommerz'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_RECORD_STATUSES = ['pending', 'paid', 'voided', 'failed', 'expired'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/**
 * One payment row: settled once, never changed after; refunds are their own
 * rows (phase-5a-plan §3.2). An online session that runs out is `expired`,
 * and still settles if the gateway later reports the money (§3.5, a late payment).
 */
export const paymentMachine = defineMachine<
  PaymentRecordStatus,
  'settle' | 'void' | 'fail' | 'expire'
>({
  name: 'payment',
  initial: 'pending',
  states: PAYMENT_RECORD_STATUSES,
  transitions: {
    pending: {
      settle: { to: 'paid' },
      void: { to: 'voided' },
      fail: { to: 'failed' },
      expire: { to: 'expired' },
    },
    expired: { settle: { to: 'paid' } },
  },
});

export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The order's payment status from what settled payments cover and what was
 * refunded since (after Shopify's financial status): any refund makes it
 * `partially_refunded`, and refunding everything paid makes it `refunded`.
 */
export function paymentStatusOf(
  paidTotal: number,
  total: number,
  refundedTotal = 0,
): PaymentStatus {
  if (refundedTotal > 0) return refundedTotal >= paidTotal ? 'refunded' : 'partially_refunded';
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
    if (SHIPMENT_OUT.includes(s.status)) out += s.quantity;
    if (s.status === 'delivered') delivered += s.quantity;
    if (s.status === 'failed' || s.status === 'returned') failed = true;
  }
  if (orderedQuantity > 0 && delivered >= orderedQuantity) return 'delivered';
  if (orderedQuantity > 0 && out + delivered >= orderedQuantity) return 'shipped';
  if (out + delivered > 0) return 'partially_shipped';
  return failed ? 'failed' : 'not_shipped';
}

/** The order's return status, derived from its returns like delivery status. */
export const RETURN_STATUSES = ['none', 'requested', 'partially_returned', 'returned'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** One return (phase-5a-plan §3.12). */
export const RETURN_RECORD_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'in_transit',
  'received',
  'inspected',
  'resolved',
] as const;
export type ReturnRecordStatus = (typeof RETURN_RECORD_STATUSES)[number];
export const RETURN_EVENTS = [
  'approve',
  'reject',
  'send',
  'receive',
  'inspect',
  'resolve',
] as const;
export type ReturnEvent = (typeof RETURN_EVENTS)[number];

/**
 * requested → approved | rejected; approved → in_transit → received, or
 * straight to received for a walk-in; received → inspected (which restocks
 * by condition) → resolved.
 */
export const returnMachine = defineMachine<ReturnRecordStatus, ReturnEvent>({
  name: 'return',
  initial: 'requested',
  states: RETURN_RECORD_STATUSES,
  transitions: {
    requested: { approve: { to: 'approved' }, reject: { to: 'rejected' } },
    approved: { send: { to: 'in_transit' }, receive: { to: 'received' } },
    in_transit: { receive: { to: 'received' } },
    received: { inspect: { to: 'inspected', effects: ['restock'] } },
    inspected: { resolve: { to: 'resolved' } },
  },
});

/** Returns that no longer ask for anything and returned nothing. */
const RETURN_CLOSED_EMPTY: readonly ReturnRecordStatus[] = ['rejected'];
/** Returns whose goods are back in the store. */
const RETURN_BACK: readonly ReturnRecordStatus[] = ['received', 'inspected', 'resolved'];

export const RETURN_REASONS = [
  'wrong_size',
  'damaged',
  'wrong_item',
  'not_as_described',
  'changed_mind',
  'other',
  /** The shopper turned items away at the door; staff open it from a partial delivery (phase-7-plan §3.5). */
  'refused_at_door',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** What a shopper can pick on the tracking page: everything but the staff-only reason. */
export const SHOPPER_RETURN_REASONS = [
  'wrong_size',
  'damaged',
  'wrong_item',
  'not_as_described',
  'changed_mind',
  'other',
] as const satisfies readonly ReturnReason[];

/** Reasons the store is at fault for: it pays the return delivery (Q9) and may refund the fee (Q10). */
export const STORE_FAULT_REASONS: readonly ReturnReason[] = [
  'damaged',
  'wrong_item',
  'not_as_described',
];

export const RETURN_RESOLUTIONS = ['refunded', 'exchanged', 'store_credit', 'rejected'] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];

/** What inspection finds for a unit (§3.12). */
export const RETURN_CONDITIONS = ['sellable', 'damaged'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export interface ReturnQuantities {
  status: ReturnRecordStatus;
  /** The resolution, once resolved. */
  resolution?: ReturnResolution | null;
  /** Units of the order in this return. */
  quantity: number;
}

/**
 * The order's return status from its returns: units back in the store count
 * as returned (all of the order's units: `returned`), and a return still on
 * its way or waiting for approval makes the order `requested`.
 */
export function returnStatusOf(
  orderedQuantity: number,
  returns: readonly ReturnQuantities[],
): ReturnStatus {
  let back = 0;
  let open = false;
  for (const r of returns) {
    if (RETURN_CLOSED_EMPTY.includes(r.status)) continue;
    if (r.status === 'resolved' && r.resolution === 'rejected') continue;
    if (RETURN_BACK.includes(r.status)) back += r.quantity;
    else open = true;
  }
  if (orderedQuantity > 0 && back >= orderedQuantity) return 'returned';
  if (back > 0) return 'partially_returned';
  return open ? 'requested' : 'none';
}

export const REFUND_METHODS = [
  'gateway',
  'gateway_manual',
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'cash',
  'store_credit',
] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** What a store can offer; `gateway_manual` records a refund made in the gateway's panel, not a choice. */
export const OFFERED_REFUND_METHODS = [
  'gateway',
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'cash',
  'store_credit',
] as const satisfies readonly RefundMethod[];

export const REFUND_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * One refund (§3.13): a gateway refund goes pending → processing →
 * succeeded or failed; a manual one is recorded as succeeded.
 */
export const refundMachine = defineMachine<RefundStatus, 'submit' | 'succeed' | 'fail'>({
  name: 'refund',
  initial: 'pending',
  states: REFUND_STATUSES,
  transitions: {
    pending: { submit: { to: 'processing' }, succeed: { to: 'succeeded' }, fail: { to: 'failed' } },
    processing: { succeed: { to: 'succeeded' }, fail: { to: 'failed' } },
  },
});

/**
 * What returning `units` more of a line refunds when `alreadyRefunded` of its
 * `quantity` units were refunded before (§3.13). Shares are cumulative, so
 * any sequence of partial returns adds up to exactly `lineTotal`, which
 * already carries the line's allocated discounts and VAT.
 */
export function refundShare(
  lineTotal: number,
  quantity: number,
  alreadyRefunded: number,
  units: number,
): number {
  if (!Number.isInteger(units) || units < 1) throw new RangeError('units must be at least 1');
  if (alreadyRefunded < 0 || alreadyRefunded + units > quantity) {
    throw new RangeError('more units than the line has left');
  }
  const upTo = (n: number) => Math.round((lineTotal * n) / quantity);
  return upTo(alreadyRefunded + units) - upTo(alreadyRefunded);
}

/**
 * Flags an order can carry for staff (phase-5a-plan §3.5, §3.11; phase-6-plan
 * §3.4, §3.5; phase-7-plan §3.5): a possible duplicate of an earlier order, an
 * order nobody answered for after the store's number of calls, a courier that
 * collected a different amount, and a parcel the shopper took only part of.
 */
export const ORDER_FLAGS = [
  'payment_risk',
  'late_payment',
  'flagged_phone',
  'possible_duplicate',
  'unreachable',
  'cod_difference',
  'partial_delivery',
] as const;
export type OrderFlag = (typeof ORDER_FLAGS)[number];

/** History rows name the machine they belong to. */
export const HISTORY_MACHINES = [
  'order',
  'payment',
  'delivery',
  'shipment',
  'edit',
  'return',
  'refund',
  'confirmation',
] as const;
export type HistoryMachine = (typeof HISTORY_MACHINES)[number];

export const ORDER_SOURCES = [
  'website',
  'facebook',
  'phone',
  'walk_in',
  'other',
  'exchange',
] as const;

/** Where staff say a manual order came from; website and exchange orders are made by the system. */
export const MANUAL_ORDER_SOURCES = ['facebook', 'phone', 'walk_in', 'other'] as const;
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
