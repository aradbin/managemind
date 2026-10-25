// The courier provider (phase-7-plan §3.2): one adapter per courier, behind
// the same small interface, after Medusa's fulfillment providers. Adapters
// speak the courier's API and turn its statuses into our words; what those
// words do to a shipment is decided in `core`. Money crosses this boundary
// in poisha; couriers take and give whole taka.
import type { Courier, CourierUpdateKind } from '@managemind/shared/orders';

/** What a courier needs to carry a parcel, already in the shape couriers read. */
export interface Parcel {
  /** Our reference: unique per store and courier (§3.4). */
  invoice: string;
  name: string;
  /** 01XXXXXXXXX. */
  phone: string;
  /** The street line, area and district, in English, as couriers read them. */
  address: string;
  areaName: string;
  districtName: string;
  /** Whole taka to collect. */
  codTaka: number;
  /** Whole taka the goods are worth (RedX asks). */
  valueTaka: number;
  weightGrams: number;
  /** "Title x2, Title x1", cut to fit. */
  items: string;
  itemCount: number;
  note: string;
  /** The courier's own place IDs, for couriers that need them (§3.6). */
  place?: CourierPlace | undefined;
}

/** A courier's place: Pathao's city and zone (and area), or RedX's area. */
export interface CourierPlace {
  cityId?: number | undefined;
  zoneId?: number | undefined;
  areaId?: number | undefined;
  /** The courier's own name for it, shown to staff. */
  name?: string | undefined;
}

/** A courier's word about a parcel, in ours. */
export interface CourierStatus {
  /** The courier's own status, as it said it. */
  status: string;
  update: CourierUpdateKind;
  /** The courier's time for it; now when it gives none. */
  at: Date;
  message?: { en?: string; bn?: string } | undefined;
  /** In poisha, when the courier says. */
  codCollected?: number | null | undefined;
  fee?: number | null | undefined;
}

export interface Booked extends CourierStatus {
  /** Null only when a parcel was found by our invoice and the courier didn't say its ID. */
  consignmentId: string | null;
  trackingCode: string | null;
}

export interface ParcelRef {
  /** Null until the courier told us; the invoice finds the parcel meanwhile. */
  consignmentId: string | null;
  invoice?: string | undefined;
  trackingCode?: string | undefined;
}

/**
 * What a webhook names. Nothing in it is believed beyond which parcel it
 * is about (§3.5): the handler asks the courier. Amounts are kept only for a
 * courier whose answer has none, and only after its secret was checked.
 */
export interface WebhookHint {
  consignmentId?: string | undefined;
  invoice?: string | undefined;
  trackingCode?: string | undefined;
  codCollected?: number | null | undefined;
  fee?: number | null | undefined;
}

export interface WebhookRequest {
  headers: Headers;
  /** The raw body, for couriers that sign it. */
  raw: string;
  body: unknown;
}

/** A pickup store at the courier, for staff to choose on connecting. */
export interface PickupStore {
  id: number;
  name: string;
}

export interface CheckResult {
  pickupStores?: PickupStore[];
}

export interface CourierProvider {
  readonly name: Courier;
  /** Proves the credentials work; never stores anything itself. */
  check(): Promise<CheckResult>;
  book(parcel: Parcel): Promise<Booked>;
  status(ref: ParcelRef): Promise<CourierStatus>;
  /** A parcel by our invoice, for a booking that got no answer (§3.4); absent where the API can't. */
  findByInvoice?(invoice: string): Promise<Booked | null>;
  /** Absent where the courier's API can't cancel; staff cancel in its panel. */
  cancel?(ref: ParcelRef): Promise<void>;
  /** Which parcel a webhook is about, or `refused` when its secret or signature is wrong. */
  parseWebhook(req: WebhookRequest, secret: string): WebhookHint | 'refused';
  /** What a webhook must answer, for couriers that ask for a handshake. */
  webhookReply?(secret: string): { status: number; headers: Record<string, string> };
  trackingUrl(trackingCode: string): string;
}

/**
 * A courier call that failed. `refused`: the courier said no (a bad phone,
 * an unknown area), so retrying the same parcel won't help. Otherwise the
 * answer never came, and a booking is unsure (§3.4).
 */
export class CourierError extends Error {
  readonly code: string;
  readonly refused: boolean;

  constructor(code: string, options: { refused: boolean; message?: string }) {
    super(options.message ?? code);
    this.name = 'CourierError';
    this.code = code;
    this.refused = options.refused;
  }
}

export type Fetch = typeof fetch;

/** Taka, as couriers send it (a number or a decimal string), in poisha; null when absent. */
export function takaToPoisha(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** A courier's timestamp, or now when it gives none or one we can't read. */
export function courierTime(value: unknown, now = new Date()): Date {
  if (typeof value !== 'string' && typeof value !== 'number') return now;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? now : d;
}

/** Compares two secrets without leaking where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * One JSON request to a courier. A network error or a 5xx is "no answer";
 * a 4xx is the courier refusing, with its message when it gives one.
 */
export async function courierCall(
  f: Fetch,
  courier: string,
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch {
    throw new CourierError('no_answer', { refused: false, message: `${courier} did not answer` });
  }
  const text = await res.text().catch(() => '');
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (res.status >= 500 || res.status === 429) {
    throw new CourierError(`http_${res.status}`, {
      refused: false,
      message: `${courier} answered ${res.status}`,
    });
  }
  if (res.status >= 400) {
    throw new CourierError(`http_${res.status}`, {
      refused: true,
      message: `${courier}: ${courierMessage(body) ?? `refused (${res.status})`}`,
    });
  }
  return { status: res.status, body };
}

/** The message a courier put in its error body, wherever it put it. */
export function courierMessage(body: Record<string, unknown>): string | null {
  const m = body.message ?? body.error ?? body.errors;
  if (typeof m === 'string') return m.slice(0, 200);
  if (m && typeof m === 'object') {
    const first = Object.values(m as Record<string, unknown>)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0].slice(0, 200);
    if (typeof first === 'string') return first.slice(0, 200);
  }
  return null;
}
