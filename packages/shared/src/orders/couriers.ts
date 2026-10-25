// Couriers (phase-7-plan §3): the couriers a store can connect, the words a
// courier's update is turned into, what each word does to a shipment, the
// store's courier settings, and the parcel's numbers as couriers want them.
// The adapters that speak each courier's API live in `providers`.
import { z } from 'zod';
import type { ShipmentStatus } from './machines';

/** `fake` is for previews, local development and tests; never offered in production. */
export const COURIERS = ['steadfast', 'pathao', 'redx', 'fake'] as const;
export type Courier = (typeof COURIERS)[number];
export const LIVE_COURIERS = ['steadfast', 'pathao', 'redx'] as const satisfies readonly Courier[];

export const COURIER_NAMES: Record<Courier, string> = {
  steadfast: 'Steadfast',
  pathao: 'Pathao',
  redx: 'RedX',
  fake: 'Test courier',
};

/** Couriers that need our area matched to theirs (§3.6); Steadfast reads the address. */
export const AREA_COURIERS = ['pathao', 'redx'] as const satisfies readonly Courier[];
export type AreaCourier = (typeof AREA_COURIERS)[number];

export const isCourier = (value: unknown): value is Courier =>
  typeof value === 'string' && (COURIERS as readonly string[]).includes(value);

export const needsAreas = (courier: Courier): courier is AreaCourier =>
  (AREA_COURIERS as readonly string[]).includes(courier);

/**
 * A courier's status, in our words (§3.2). Each adapter maps its courier's
 * statuses to one of these; `on_hold` and `unknown` are events only.
 */
export const COURIER_UPDATES = [
  'booked',
  'picked_up',
  'in_transit',
  'on_hold',
  'delivered',
  'partial_delivered',
  'returning',
  'returned',
  'cancelled',
  'paid_out',
  'unknown',
] as const;
export type CourierUpdateKind = (typeof COURIER_UPDATES)[number];

export const isCourierUpdate = (value: unknown): value is CourierUpdateKind =>
  typeof value === 'string' && (COURIER_UPDATES as readonly string[]).includes(value);

/**
 * The shipment state each update leads to; null when it moves nothing.
 * `returned` keeps the shipment failed and waits for staff (§3.5, Q9), and
 * `paid_out` is money, not a move.
 */
export const UPDATE_STATUS: Record<CourierUpdateKind, ShipmentStatus | null> = {
  booked: 'booked',
  picked_up: 'shipped',
  in_transit: 'in_transit',
  on_hold: null,
  delivered: 'delivered',
  partial_delivered: 'delivered',
  returning: 'failed',
  returned: 'failed',
  cancelled: 'pending',
  paid_out: null,
  unknown: null,
};

/** Shipments a courier still has: polled while quiet (§3.5). */
export const OPEN_COURIER_STATUSES = [
  'booked',
  'shipped',
  'in_transit',
  'failed',
] as const satisfies readonly ShipmentStatus[];

/** Where we heard about a courier's status. */
export const EVENT_SOURCES = ['booking', 'webhook', 'poll', 'staff'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** A booking in flight, or one that got no answer (§3.4). */
export const BOOKING_STATES = ['booking', 'unsure'] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export const PAYOUT_SOURCES = ['courier', 'import', 'manual'] as const;
export type PayoutSource = (typeof PAYOUT_SOURCES)[number];

export const AUTO_BOOK_RULES = ['never', 'on_confirm'] as const;

export const COURIER_LIMITS = {
  /** Orders in one bulk booking (§3.4). */
  bulkMax: 100,
  /** Shipments booked in one queue message: under the Free plan's 50 subrequests. */
  bookBatch: 10,
  /** Shipments asked about in one poll message. */
  pollBatch: 20,
  /** Hours without news before a shipment is polled. */
  quietHours: 6,
  /** Days an open courier shipment is polled before it is called stuck. */
  stuckDays: 30,
  /** The lightest parcel couriers price. */
  minWeightGrams: 500,
  maxWeightGrams: 50_000,
  noteMax: 200,
  itemsMax: 250,
} as const;

/** The store's courier settings (§3.8). Each courier's own options sit with its credentials. */
export const courierSettings = z
  .object({
    /** The courier the order page offers first; the first connected when null. */
    default: z.enum(COURIERS).nullable().default(null),
    defaultWeightGrams: z
      .int()
      .min(100)
      .max(COURIER_LIMITS.maxWeightGrams)
      .default(COURIER_LIMITS.minWeightGrams),
    /** Added to every parcel's note. */
    note: z.string().trim().max(COURIER_LIMITS.noteMax).default(''),
    /** Book with the default courier when an order is confirmed (Q8). */
    autoBook: z.enum(AUTO_BOOK_RULES).default('never'),
    /** Restock a parcel the courier says it returned, without staff confirming (Q9). */
    autoReceive: z.boolean().default(false),
  })
  .strict();
export type CourierSettings = z.infer<typeof courierSettings>;

/** What the courier collects, in whole taka: the COD still due, rounded up (phase-4-plan Q7). */
export const codTaka = (poisha: number) => Math.max(0, Math.ceil(poisha / 100));

/** The parcel's weight: its lines' weights, at least the lightest a courier prices. */
export function parcelWeightGrams(
  lines: ReadonlyArray<{ weightGrams: number | null; quantity: number }>,
  defaultGrams: number,
): number {
  const known = lines.reduce((sum, l) => sum + (l.weightGrams ?? 0) * l.quantity, 0);
  const grams = known > 0 ? known : defaultGrams;
  return Math.min(
    COURIER_LIMITS.maxWeightGrams,
    Math.max(COURIER_LIMITS.minWeightGrams, Math.round(grams)),
  );
}

/** Our reference for a parcel: the order number and the shipment's place, unique per store. */
export function parcelInvoice(displayNumber: string, shipmentNumber: number): string {
  const number = displayNumber.replace(/[^A-Za-z0-9-]/g, '') || 'order';
  return `${number}-${shipmentNumber}`;
}

/** 01712345678 from +8801712345678: couriers want the local form. */
export const localPhone = (phone: string) => phone.replace(/^\+?88/, '');

/** A courier's text, cut to fit and without control characters. */
export function courierText(text: string, max: number): string {
  const clean = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch === '\u007f' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** A courier's place chosen by staff at booking (§3.4, §3.6). */
export const courierPlaceInput = z
  .object({
    cityId: z.int().positive().optional(),
    zoneId: z.int().positive().optional(),
    areaId: z.int().positive().optional(),
  })
  .strict();
export type CourierPlaceInput = z.infer<typeof courierPlaceInput>;

/** Booking one order's parcel (§3.4); `shipmentId` tries an earlier one again. */
export const bookInput = z
  .object({
    courier: z.enum(COURIERS),
    shipmentId: z.uuid().optional(),
    lines: z
      .array(z.object({ orderLineId: z.uuid(), quantity: z.int().min(1).max(10_000) }).strict())
      .min(1)
      .max(50)
      .optional(),
    weightGrams: z.int().min(100).max(COURIER_LIMITS.maxWeightGrams).optional(),
    note: z.string().trim().max(COURIER_LIMITS.noteMax).optional(),
    place: courierPlaceInput.optional(),
  })
  .strict();
export type BookInput = z.infer<typeof bookInput>;

export const bulkBookInput = z
  .object({
    courier: z.enum(COURIERS),
    orderIds: z.array(z.uuid()).min(1).max(COURIER_LIMITS.bulkMax),
  })
  .strict();

/** Couriers whose API can't cancel ask staff to cancel in the panel first (§3.4). */
export const cancelBookingInput = z
  .object({ cancelledAtCourier: z.boolean().default(false) })
  .strict();
