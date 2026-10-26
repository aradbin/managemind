// Reading orders (phase-4-plan §3.17, §3.18, §6, §7): the admin's list and
// detail, the shopper's own view (confirmation and tracking), the dashboard,
// and what invoices and packing slips print. Without customers.read, the
// shopper's phone, email and street line are masked (Viewers see orders
// but not shoppers' personal data); cost prices need catalog.cost.
import { AppError, formatPhone } from '@managemind/shared';
import {
  type CancelCode,
  formatOrderNumber,
  type OrderListQuery,
  orderMachine,
  parseOrderNumber,
} from '@managemind/shared/orders';
import { dhakaToUtc } from '@managemind/shared/storefront';
import { type SQL, sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import { storeEntitlements } from '../billing/entitlements';
import type { StoreImage } from '../catalog/published';
import { type PhoneRisk, phoneRisks } from '../fraud/index';
import { orderSettings } from '../pricing/quote';
import { incompleteCounts } from '../recovery/index';
import { monthToDateProfit, orderProfits } from '../reports/back-office';
import type { TenantTx } from '../tenant';
import { type ConfirmationState, confirmationState, inQueueSql } from './confirmation';
import type { Localized } from './variants';

const iso = (d: unknown) =>
  d === null || d === undefined ? null : new Date(d as string).toISOString();
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** "+8801712345678" → "01712-•••678". */
export const maskPhone = (e164: string) => formatPhone(e164).replace(/-(\d{3})(\d{3})$/, '-•••$2');

export interface OrderAddress {
  divisionId: number;
  districtId: number;
  areaId: number;
  line: string;
  names: { division: Localized; district: Localized; area: Localized };
}

export interface OrderSummary {
  id: string;
  number: number;
  displayNumber: string;
  status: string;
  paymentStatus: string;
  deliveryStatus: string;
  source: string;
  name: string;
  phone: string;
  area: Localized | null;
  zoneName: Localized | null;
  total: number;
  itemCount: number;
  tags: string[];
  /** For staff: risky phone, possible duplicate, unreachable and the payment flags. */
  flags: string[];
  cancelledBy: string | null;
  /** The phone's delivery success score now (phase-6-plan §3.3): counts only. */
  risk: PhoneRisk;
  placedAt: string;
  /** With catalog.cost and the back office (phase-8-plan §3.8); null before delivery. */
  grossProfit?: number | null;
  /** Delivered units without a cost: the profit is overstated. */
  missingCostUnits?: number;
}

function dateBound(day: string, end: boolean): string {
  // Dhaka days (§3.17): a date is midnight to midnight in Asia/Dhaka.
  const start = Date.parse(dhakaToUtc(`${day}T00:00`));
  return new Date(end ? start + 86_400_000 : start).toISOString();
}

/** Cursor: the last row's placed_at and id, so pages never skip or repeat. */
const encodeCursor = (placedAt: string, id: string) => btoa(`${placedAt}|${id}`);
function decodeCursor(cursor: string): { placedAt: string; id: string } | null {
  try {
    const [placedAt, id] = atob(cursor).split('|');
    return placedAt && id ? { placedAt, id } : null;
  } catch {
    return null;
  }
}

export async function listOrders(
  tx: TenantTx,
  actor: Actor,
  query: OrderListQuery = {},
): Promise<{ items: OrderSummary[]; nextCursor: string | null }> {
  authorize(actor, 'orders.read');
  const personal = actor.permissions.has('customers.read');
  const { checkout, settings } = await orderSettings(tx);
  const limit = query.limit ?? 50;
  const where: SQL[] = [sql`true`];
  if (query.status) where.push(sql`o.status = ${query.status}`);
  if (query.paymentStatus) where.push(sql`o.payment_status = ${query.paymentStatus}`);
  if (query.returnStatus) where.push(sql`o.return_status = ${query.returnStatus}`);
  if (query.deliveryStatus) where.push(sql`o.delivery_status = ${query.deliveryStatus}`);
  if (query.zoneId) where.push(sql`o.zone_id = ${query.zoneId}`);
  if (query.source) where.push(sql`o.source = ${query.source}`);
  if (query.tag) where.push(sql`${query.tag} = any(o.tags)`);
  if (query.cancelledByShopper)
    where.push(sql`o.status = 'cancelled' and o.cancelled_by = 'shopper'`);
  if (query.flag) where.push(sql`${query.flag} = any(o.flags)`);
  if (query.from) where.push(sql`o.placed_at >= ${dateBound(query.from, false)}`);
  if (query.to) where.push(sql`o.placed_at < ${dateBound(query.to, true)}`);
  const q = query.q?.trim();
  if (q) {
    const n = parseOrderNumber(q);
    const digits = q.replace(/\D/g, '');
    const parts: SQL[] = [];
    if (n !== null && digits.length <= 9) parts.push(sql`o.number = ${n}`);
    // Phone search needs customers.read, or numbers could be found by guessing.
    if (personal && digits.length >= 4)
      parts.push(sql`o.phone like ${`%${digits.replace(/^0/, '')}%`}`);
    if (!/^[\d\s#+-]+$/.test(q)) {
      parts.push(
        sql`app.search_text(o.contact->>'name') like app.search_text(${`%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`})`,
      );
    }
    where.push(parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`);
  }
  const cursor = query.after ? decodeCursor(query.after) : null;
  if (cursor)
    where.push(sql`(o.placed_at, o.id) < (${cursor.placedAt}::timestamptz, ${cursor.id}::uuid)`);
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select o.id, o.number, o.status, o.payment_status, o.delivery_status, o.source, o.contact->>'name' as name,
           o.phone, o.address->'names'->'area' as area, o.zone_name, o.total, o.tags, o.flags, o.cancelled_by, o.placed_at,
           (select coalesce(sum(quantity), 0)::int from store.order_lines l where l.order_id = o.id) as item_count
      from store.orders o where ${sql.join(where, sql` and `)}
     order by o.placed_at desc, o.id desc limit ${limit + 1}`);
  const page = rows.slice(0, limit);
  // Every phone on the page in one query.
  const risks = await phoneRisks(
    tx,
    page.map((r) => r.phone as string),
    settings,
  );
  const items = page.map(
    (r): OrderSummary => ({
      id: r.id as string,
      number: Number(r.number),
      displayNumber: formatOrderNumber(checkout.orderNumberPrefix, Number(r.number)),
      status: r.status as string,
      paymentStatus: r.payment_status as string,
      deliveryStatus: r.delivery_status as string,
      source: r.source as string,
      name: r.name as string,
      phone: personal ? (r.phone as string) : maskPhone(r.phone as string),
      area: (r.area as Localized) ?? null,
      zoneName: (r.zone_name as Localized) ?? null,
      total: Number(r.total),
      itemCount: Number(r.item_count),
      tags: r.tags as string[],
      flags: r.flags as string[],
      cancelledBy: (r.cancelled_by as string) ?? null,
      risk: risks.get(r.phone as string) as PhoneRisk,
      placedAt: iso(r.placed_at) as string,
    }),
  );
  if (actor.permissions.has('catalog.cost') && (await storeEntitlements(tx)).features.backOffice) {
    const profits = await orderProfits(
      tx,
      items.map((i) => i.id),
    );
    for (const item of items) {
      const p = profits.get(item.id);
      item.grossProfit = p?.grossProfit ?? null;
      item.missingCostUnits = p?.missingCostUnits ?? 0;
    }
  }
  const last = rows.length > limit ? items[items.length - 1] : undefined;
  return { items, nextCursor: last ? encodeCursor(last.placedAt, last.id) : null };
}

export interface OrderLineView {
  id: string;
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  image: StoreImage | null;
  unitPrice: number;
  compareAtPrice: number | null;
  costPrice?: number | null;
  quantity: number;
  shippedQuantity: number;
  subtotal: number;
  discount: number;
  vatRateBp: number;
  vat: number;
  total: number;
  weightGrams: number | null;
}

/** A courier's parcel on a shipment. */
export interface ShipmentCourier {
  courier: string;
  /** Our invoice for the parcel, which the courier's panel shows. */
  invoice: string | null;
  consignmentId: string | null;
  trackingCode: string | null;
  bookingState: string | null;
  status: string | null;
  statusAt: string | null;
  message: string | null;
  bookedAt: string | null;
  returnedByCourierAt: string | null;
  codAmount: number | null;
  codCollected: number | null;
  fee: number | null;
  place: { name?: string } | null;
  events: {
    status: string;
    update: string;
    message: { en?: string; bn?: string };
    at: string;
    source: string;
  }[];
}

export interface OrderDetail {
  id: string;
  number: number;
  displayNumber: string;
  status: string;
  paymentStatus: string;
  deliveryStatus: string;
  returnStatus: string;
  source: string;
  locale: string;
  customer: { id: string; name: string; phone: string; email: string | null; orderCount: number };
  contact: { name: string; phone: string; email?: string };
  address: OrderAddress | null;
  zone: { id: string | null; name: Localized | null };
  lines: OrderLineView[];
  adjustments: {
    id: string;
    kind: string;
    target: string;
    title: Localized;
    code: string | null;
    amount: number;
    reason: string | null;
  }[];
  totals: {
    subtotal: number;
    discountTotal: number;
    deliveryFee: number;
    deliveryDiscount: number;
    vatTotal: number;
    vatIncluded: boolean;
    rounding: number;
    total: number;
    paidTotal: number;
    /** What the courier collects. */
    codDue: number;
    refundDue: number;
    refundedTotal: number;
  };
  /** payment_risk, late_payment (phase-5a-plan §3.5), and phase-6-plan's. */
  flags: string[];
  /** The phone's score now, with its counts, and when the order was placed (phase-6-plan §3.3). */
  risk: PhoneRisk;
  phoneScoreAtPlacement: number | null;
  /** The phone's other orders still open, newest first. */
  otherOpenOrders: {
    id: string;
    displayNumber: string;
    status: string;
    total: number;
    placedAt: string;
  }[];
  /** The earlier order this one may duplicate (phase-6-plan §3.4). */
  duplicateOf: { id: string; displayNumber: string; status: string } | null;
  cancelCode: CancelCode | null;
  /** Its place in the confirmation queue, every call, and how it was confirmed (phase-6-plan §3.5). */
  confirmation: ConfirmationState | null;
  /** Refunds, newest last (phase-5a-plan §3.13). */
  refunds: {
    id: string;
    method: string;
    status: string;
    amount: number;
    reference: string | null;
    reason: string | null;
    returnId: string | null;
    gatewayError: string | null;
    createdAt: string;
  }[];
  /** This order's returns (phase-5a-plan §3.12). */
  returns: { id: string; number: number; status: string; resolution: string | null }[];
  payments: {
    id: string;
    provider: string;
    method: string;
    status: string;
    amount: number;
    reference: string | null;
    settledAt: string | null;
    createdAt: string;
    /** SSLCommerz's details (phase-5a-plan §7); null for other providers and without payments.read. */
    gateway: {
      valId: string | null;
      bankTranId: string | null;
      risky: boolean;
      cardType: string | null;
      link: boolean;
    } | null;
  }[];
  shipments: {
    id: string;
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    failedReason: string | null;
    lines: { orderLineId: string; quantity: number }[];
    /** The courier's parcel (phase-7-plan §3.9); null for a manual shipment. */
    courier: ShipmentCourier | null;
    /** A refused booking's reason, kept after the courier is cleared. */
    bookingError: string | null;
  }[];
  timeline: {
    kind: 'history' | 'note';
    id: string;
    machine?: string;
    from?: string | null;
    to?: string | null;
    event?: string;
    reason?: string | null;
    body?: string;
    actorType?: string;
    actorId: string | null;
    data?: unknown;
    createdAt: string;
  }[];
  customerNote: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  cancelReason: string | null;
  cancelledBy: string | null;
  placedAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** What the order machine and the shipments allow now. */
  actions: string[];
}

const money = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function shipmentCourier(s: Record<string, unknown>): ShipmentCourier {
  return {
    courier: s.courier as string,
    invoice: (s.courier_ref as string) ?? null,
    consignmentId: (s.consignment_id as string) ?? null,
    trackingCode: (s.tracking_code as string) ?? null,
    bookingState: (s.booking_state as string) ?? null,
    status: (s.courier_status as string) ?? null,
    statusAt: iso(s.courier_status_at),
    message: (s.courier_message as string) ?? null,
    bookedAt: iso(s.booked_at),
    returnedByCourierAt: iso(s.courier_returned_at),
    codAmount: money(s.cod_amount),
    codCollected: money(s.cod_collected),
    fee: money(s.courier_fee),
    place: (s.courier_area as { name?: string } | null) ?? null,
    events: (s.events as ShipmentCourier['events']).map((e) => ({
      ...e,
      at: new Date(e.at).toISOString(),
    })),
  };
}

const mask = (detail: OrderDetail): OrderDetail => ({
  ...detail,
  customer: { ...detail.customer, phone: maskPhone(detail.customer.phone), email: null },
  contact: {
    name: detail.contact.name,
    phone: maskPhone(detail.contact.phone),
  },
  address: detail.address ? { ...detail.address, line: '•••' } : null,
});

export async function loadOrderDetail(tx: TenantTx, id: string): Promise<OrderDetail | null> {
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
           c.order_count as customer_orders
      from store.orders o join store.customers c on c.id = o.customer_id where o.id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  const { checkout, settings } = await orderSettings(tx);
  const [lines, adjustments, payments, shipments, history, notes, refunds, returns, others] =
    await Promise.all([
      tx.db.execute<Record<string, unknown>>(sql`
      select id, variant_id, product_id, title, option_labels, sku, image, unit_price, compare_at_price, cost_price,
             quantity, shipped_quantity, line_subtotal, discount_total, vat_rate_bp, vat_amount, line_total, weight_grams
        from store.order_lines where order_id = ${id} order by position`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, kind, target, title, code, amount, reason from store.order_adjustments
       where order_id = ${id} order by created_at, id`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, provider, method, status, amount, reference, settled_at, created_at,
             gateway_val_id, gateway_bank_tran_id, risk_level, metadata from store.payments
       where order_id = ${id} order by created_at, id`),
      tx.db.execute<Record<string, unknown>>(sql`
      select s.id, s.status, s.carrier, s.tracking_number, s.tracking_url, s.shipped_at, s.delivered_at, s.failed_reason,
             s.courier, s.courier_ref, s.consignment_id, s.tracking_code, s.booking_state, s.booking_error, s.courier_status,
             s.courier_status_at, s.courier_message, s.booked_at, s.courier_returned_at, s.cod_amount,
             s.cod_collected, s.courier_fee, s.courier_area,
             coalesce((select json_agg(json_build_object('orderLineId', sl.order_line_id, 'quantity', sl.quantity))
                         from store.shipment_lines sl where sl.shipment_id = s.id), '[]'::json) as lines,
             coalesce((select json_agg(json_build_object('status', e.courier_status, 'update', e.update,
                                 'message', e.message, 'at', e.courier_at, 'source', e.source)
                                 order by e.courier_at, e.id)
                         from store.shipment_events e where e.shipment_id = s.id), '[]'::json) as events
        from store.shipments s where s.order_id = ${id} order by s.created_at`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, machine, from_status, to_status, event, actor_type, actor_id, reason, data, created_at
        from store.order_history where order_id = ${id} order by created_at, id`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, author_id, body, created_at from store.order_notes where order_id = ${id} order by created_at, id`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, method, status, amount, reference, reason, return_id, gateway_error, created_at
        from store.refunds where order_id = ${id} order by created_at, id`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, number, status, resolution from store.returns where order_id = ${id} order by number`),
      tx.db.execute<Record<string, unknown>>(sql`
      select id, number, status, total, placed_at from store.orders
       where phone = ${r.phone as string} and id <> ${id}
         and (status in ('pending', 'confirmed', 'processing') or id = ${(r.duplicate_of as string) ?? null}::uuid)
       order by placed_at desc limit 11`),
    ]);
  const risk = (await phoneRisks(tx, [r.phone as string], settings)).get(
    r.phone as string,
  ) as PhoneRisk;
  const display = (n: unknown) => formatOrderNumber(checkout.orderNumberPrefix, Number(n));
  const confirmation = await confirmationState(tx, id, settings);
  const duplicate = others.rows.find((o) => o.id === r.duplicate_of);
  const total = Number(r.total);
  const paidTotal = Number(r.paid_total);
  const codDue = payments.rows
    .filter((p) => p.provider === 'cod' && p.status === 'pending')
    .reduce((a, p) => a + Number(p.amount), 0);
  const shippedQuantity = lines.rows.reduce((a, l) => a + Number(l.shipped_quantity), 0);
  const status = r.status as OrderDetail['status'];
  const actions: string[] = [];
  for (const event of ['confirm', 'process', 'cancel'] as const) {
    if (orderMachine.can(status as never, event, { shippedQuantity })) actions.push(event);
  }
  if (status === 'confirmed' || status === 'processing') actions.push('create_shipment');
  if (
    (status === 'pending' || status === 'confirmed' || status === 'processing') &&
    shipments.rows.length === 0
  ) {
    actions.push('edit');
  }
  if (status !== 'cancelled') actions.push('record_payment');
  const timeline: OrderDetail['timeline'] = [
    ...history.rows.map((h) => ({
      kind: 'history' as const,
      id: h.id as string,
      machine: h.machine as string,
      from: (h.from_status as string) ?? null,
      to: (h.to_status as string) ?? null,
      event: h.event as string,
      reason: (h.reason as string) ?? null,
      actorType: h.actor_type as string,
      actorId: (h.actor_id as string) ?? null,
      data: h.data ?? null,
      createdAt: iso(h.created_at) as string,
    })),
    ...notes.rows.map((n) => ({
      kind: 'note' as const,
      id: n.id as string,
      body: n.body as string,
      actorId: (n.author_id as string) ?? null,
      createdAt: iso(n.created_at) as string,
    })),
  ].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
  );
  return {
    id,
    number: Number(r.number),
    displayNumber: formatOrderNumber(checkout.orderNumberPrefix, Number(r.number)),
    status,
    paymentStatus: r.payment_status as string,
    deliveryStatus: r.delivery_status as string,
    returnStatus: r.return_status as string,
    source: r.source as string,
    locale: r.locale as string,
    customer: {
      id: r.customer_id as string,
      name: r.customer_name as string,
      phone: r.customer_phone as string,
      email: (r.customer_email as string) ?? null,
      orderCount: Number(r.customer_orders),
    },
    contact: r.contact as OrderDetail['contact'],
    address: (r.address as OrderAddress) ?? null,
    zone: { id: (r.zone_id as string) ?? null, name: (r.zone_name as Localized) ?? null },
    lines: lines.rows.map((l) => ({
      id: l.id as string,
      variantId: l.variant_id as string,
      productId: l.product_id as string,
      title: l.title as Localized,
      optionLabels: l.option_labels as Localized[],
      sku: (l.sku as string) ?? null,
      image: (l.image as StoreImage) ?? null,
      unitPrice: Number(l.unit_price),
      compareAtPrice: num(l.compare_at_price),
      costPrice: num(l.cost_price),
      quantity: Number(l.quantity),
      shippedQuantity: Number(l.shipped_quantity),
      subtotal: Number(l.line_subtotal),
      discount: Number(l.discount_total),
      vatRateBp: Number(l.vat_rate_bp),
      vat: Number(l.vat_amount),
      total: Number(l.line_total),
      weightGrams: num(l.weight_grams),
    })),
    adjustments: adjustments.rows.map((a) => ({
      id: a.id as string,
      kind: a.kind as string,
      target: a.target as string,
      title: a.title as Localized,
      code: (a.code as string) ?? null,
      amount: Number(a.amount),
      reason: (a.reason as string) ?? null,
    })),
    totals: {
      subtotal: Number(r.subtotal),
      discountTotal: Number(r.discount_total),
      deliveryFee: Number(r.delivery_fee),
      deliveryDiscount: Number(r.delivery_discount),
      vatTotal: Number(r.vat_total),
      vatIncluded: r.vat_included as boolean,
      rounding: Number(r.rounding),
      total,
      paidTotal,
      codDue,
      refundDue: Math.max(0, paidTotal - Number(r.refunded_total ?? 0) - total),
      refundedTotal: Number(r.refunded_total ?? 0),
    },
    flags: (r.flags as string[] | null) ?? [],
    risk,
    phoneScoreAtPlacement: num(r.phone_score),
    otherOpenOrders: others.rows
      .filter((o) => ['pending', 'confirmed', 'processing'].includes(o.status as string))
      .slice(0, 10)
      .map((o) => ({
        id: o.id as string,
        displayNumber: display(o.number),
        status: o.status as string,
        total: Number(o.total),
        placedAt: iso(o.placed_at) as string,
      })),
    duplicateOf: duplicate
      ? {
          id: duplicate.id as string,
          displayNumber: display(duplicate.number),
          status: duplicate.status as string,
        }
      : null,
    cancelCode: (r.cancel_code as CancelCode) ?? null,
    confirmation,
    refunds: refunds.rows.map((f) => ({
      id: f.id as string,
      method: f.method as string,
      status: f.status as string,
      amount: Number(f.amount),
      reference: (f.reference as string) ?? null,
      reason: (f.reason as string) ?? null,
      returnId: (f.return_id as string) ?? null,
      gatewayError: (f.gateway_error as string) ?? null,
      createdAt: iso(f.created_at) as string,
    })),
    returns: returns.rows.map((x) => ({
      id: x.id as string,
      number: Number(x.number),
      status: x.status as string,
      resolution: (x.resolution as string) ?? null,
    })),
    payments: payments.rows.map((p) => ({
      id: p.id as string,
      provider: p.provider as string,
      method: p.method as string,
      status: p.status as string,
      amount: Number(p.amount),
      reference: (p.reference as string) ?? null,
      settledAt: iso(p.settled_at),
      createdAt: iso(p.created_at) as string,
      gateway:
        p.provider === 'sslcommerz'
          ? {
              valId: (p.gateway_val_id as string) ?? null,
              bankTranId: (p.gateway_bank_tran_id as string) ?? null,
              risky: p.risk_level === 1,
              cardType: ((p.metadata as { cardType?: string } | null)?.cardType as string) ?? null,
              link: Boolean((p.metadata as { link?: boolean } | null)?.link),
            }
          : null,
    })),
    shipments: shipments.rows.map((s) => ({
      id: s.id as string,
      status: s.status as string,
      carrier: (s.carrier as string) ?? null,
      trackingNumber: (s.tracking_number as string) ?? null,
      trackingUrl: (s.tracking_url as string) ?? null,
      shippedAt: iso(s.shipped_at),
      deliveredAt: iso(s.delivered_at),
      failedReason: (s.failed_reason as string) ?? null,
      lines: s.lines as { orderLineId: string; quantity: number }[],
      courier: s.courier ? shipmentCourier(s) : null,
      bookingError: (s.booking_error as string) ?? null,
    })),
    timeline,
    customerNote: (r.customer_note as string) ?? null,
    tags: r.tags as string[],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    cancelReason: (r.cancel_reason as string) ?? null,
    cancelledBy: (r.cancelled_by as string) ?? null,
    placedAt: iso(r.placed_at) as string,
    confirmedAt: iso(r.confirmed_at),
    completedAt: iso(r.completed_at),
    cancelledAt: iso(r.cancelled_at),
    actions,
  };
}

/** The admin's order detail, masked and trimmed by the actor's permissions. */
export async function getOrder(tx: TenantTx, actor: Actor, id: string): Promise<OrderDetail> {
  authorize(actor, 'orders.read');
  const detail = await loadOrderDetail(tx, id);
  if (!detail) throw new AppError('not_found');
  let out = actor.permissions.has('customers.read') ? detail : mask(detail);
  if (!actor.permissions.has('catalog.cost')) {
    out = { ...out, lines: out.lines.map(({ costPrice: _c, ...l }) => l) };
  }
  if (!actor.permissions.has('payments.read')) {
    out = {
      ...out,
      payments: out.payments.map((p) => ({ ...p, reference: null, gateway: null })),
    };
  }
  if (!actor.permissions.has('orders.write')) out = { ...out, actions: [] };
  return out;
}

// ---- The shopper's view ------------------------------------------------------------

export interface ShopperOrderView {
  id: string;
  displayNumber: string;
  status: string;
  paymentStatus: string;
  deliveryStatus: string;
  locale: string;
  contact: { name: string; phone: string };
  address: OrderAddress | null;
  zoneName: Localized | null;
  lines: Pick<
    OrderLineView,
    'title' | 'optionLabels' | 'image' | 'unitPrice' | 'quantity' | 'total'
  >[];
  adjustments: { title: Localized; amount: number; target: string }[];
  totals: Pick<
    OrderDetail['totals'],
    | 'subtotal'
    | 'discountTotal'
    | 'deliveryFee'
    | 'deliveryDiscount'
    | 'vatTotal'
    | 'vatIncluded'
    | 'total'
    | 'codDue'
  >;
  shipments: {
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    /** The courier's events, for the tracking page (phase-7-plan §3.10): never fees or payouts. */
    events: { update: string; message: { en?: string; bn?: string }; at: string }[];
  }[];
  /** Shoppers can cancel until the store confirms (§3.9). */
  cancellable: boolean;
  /** An online payment still waiting: the page offers "pay now" (phase-5a-plan §3.3). */
  onlineDue: number;
  placedAt: string;
}

/** What a shopper sees of their own order: nothing internal, no notes or history. */
export async function shopperOrderView(tx: TenantTx, id: string): Promise<ShopperOrderView | null> {
  const d = await loadOrderDetail(tx, id);
  if (!d) return null;
  return {
    id: d.id,
    displayNumber: d.displayNumber,
    status: d.status,
    paymentStatus: d.paymentStatus,
    deliveryStatus: d.deliveryStatus,
    locale: d.locale,
    contact: { name: d.contact.name, phone: d.contact.phone },
    address: d.address,
    zoneName: d.zone.name,
    lines: d.lines.map((l) => ({
      title: l.title,
      optionLabels: l.optionLabels,
      image: l.image,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      total: l.total,
    })),
    adjustments: d.adjustments.map((a) => ({ title: a.title, amount: a.amount, target: a.target })),
    totals: {
      subtotal: d.totals.subtotal,
      discountTotal: d.totals.discountTotal,
      deliveryFee: d.totals.deliveryFee,
      deliveryDiscount: d.totals.deliveryDiscount,
      vatTotal: d.totals.vatTotal,
      vatIncluded: d.totals.vatIncluded,
      total: d.totals.total,
      codDue: d.totals.codDue,
    },
    shipments: d.shipments
      .filter((s) => s.status !== 'pending')
      .map((s) => ({
        status: s.status,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        trackingUrl: s.trackingUrl,
        events: (s.courier?.events ?? [])
          .filter((e) => e.update !== 'paid_out' && e.update !== 'unknown')
          .map((e) => ({ update: e.update, message: e.message, at: e.at })),
      })),
    cancellable: d.status === 'pending',
    onlineDue:
      d.status === 'cancelled'
        ? 0
        : d.payments
            .filter((p) => p.provider === 'sslcommerz' && p.status === 'pending')
            .reduce((a, p) => a + p.amount, 0),
    placedAt: d.placedAt,
  };
}

/** Tracking by number and phone (§3.16): the order's ID, or null for any mismatch. */
export async function findOrderForTracking(
  tx: TenantTx,
  input: { number: string; phone: string },
): Promise<string | null> {
  const n = parseOrderNumber(input.number);
  if (n === null) return null;
  const { rows } = await tx.db.execute<{ id: string }>(
    sql`select id from store.orders where number = ${n} and phone = ${input.phone}`,
  );
  return rows[0]?.id ?? null;
}

// ---- The dashboard -------------------------------------------------------------------

export interface Dashboard {
  counts: {
    awaitingConfirmation: number;
    toShip: number;
    cancelledByShopper7d: number;
    lowStock: number;
    /** Due to be called now (phase-6-plan §3.8); 0 when the queue is off. */
    toCall: number;
    possibleDuplicates: number;
    /** Courier parcels (phase-7-plan §3.9): waiting for pickup, on the way, coming back, back with the courier's word. */
    booked: number;
    inTransit: number;
    returning: number;
    courierReturns: number;
  };
  /**
   * COD orders placed in the last 7 days that were confirmed, of those
   * decided (confirmed or cancelled); null when the queue is off.
   */
  confirmation: { confirmed: number; decided: number; rate: number | null } | null;
  /** Incomplete orders to call, and today's saved and recovered (phase-6-plan §3.8); null when off. */
  incomplete: { open: number; today: number; recoveredToday: number } | null;
  /** Null without reports.read. */
  sales: {
    today: { orders: number; total: number };
    month: { orders: number; total: number };
    /** The last 7 Dhaka days, oldest first. */
    days: { date: string; orders: number; total: number }[];
  } | null;
  /** This month so far, for catalog.cost holders with the back office (phase-8-plan §3.12). */
  profit: {
    grossProfit: number;
    expenses: number;
    netProfit: number;
    missingCostUnits: number;
  } | null;
}

/** A handful of summary queries on indexed columns (§3.17); Asia/Dhaka days, cancelled orders excluded. */
export async function dashboard(tx: TenantTx, actor: Actor, now = new Date()): Promise<Dashboard> {
  authorize(actor, 'orders.read');
  const { settings } = await orderSettings(tx);
  const queue = settings.confirmation.queue;
  const { rows } = await tx.db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from store.orders where status = 'pending') as "awaitingConfirmation",
      ${
        queue
          ? sql`(select count(*)::int from store.orders o
                  left join store.order_confirmations c on c.order_id = o.id
                 where ${inQueueSql(settings)} and not ('unreachable' = any(o.flags))
                   and (c.due_at is null or c.due_at <= now()))`
          : sql`0`
      } as "toCall",
      (select count(*)::int from store.orders where 'possible_duplicate' = any(flags)
         and status <> 'cancelled') as "possibleDuplicates",
      (select count(*)::int from store.shipments where status = 'booked') as "booked",
      (select count(*)::int from store.shipments where courier is not null
         and status in ('shipped', 'in_transit')) as "inTransit",
      (select count(*)::int from store.shipments where courier is not null and status = 'failed'
         and courier_returned_at is null) as "returning",
      (select count(*)::int from store.shipments where status = 'failed'
         and courier_returned_at is not null) as "courierReturns",
      (select count(*)::int from store.orders o where o.placed_at > now() - interval '7 days'
         and o.confirmed_at is not null
         and exists (select 1 from store.payments p where p.order_id = o.id and p.provider = 'cod'))
        as "confirmed7d",
      (select count(*)::int from store.orders o where o.placed_at > now() - interval '7 days'
         and (o.confirmed_at is not null or o.status = 'cancelled')
         and exists (select 1 from store.payments p where p.order_id = o.id and p.provider = 'cod'))
        as "decided7d",
      (select count(*)::int from store.orders where status in ('confirmed', 'processing')
         and delivery_status in ('not_shipped', 'partially_shipped', 'failed')) as "toShip",
      (select count(*)::int from store.orders where status = 'cancelled' and cancelled_by = 'shopper'
         and cancelled_at > now() - interval '7 days') as "cancelledByShopper7d",
      (select count(*)::int from store.variants v join store.products p on p.id = v.product_id
        where v.archived_at is null and p.status = 'active' and v.track_inventory and v.low_stock_threshold is not null
          and coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l where l.variant_id = v.id), 0)
              <= v.low_stock_threshold) as "lowStock"`);
  const {
    confirmed7d = 0,
    decided7d = 0,
    ...counts
  } = (rows[0] ?? {}) as Dashboard['counts'] & {
    confirmed7d?: number;
    decided7d?: number;
  };
  const confirmation = queue
    ? {
        confirmed: confirmed7d,
        decided: decided7d,
        rate: decided7d ? Math.round((100 * confirmed7d) / decided7d) : null,
      }
    : null;
  const incomplete = actor.permissions.has('customers.read')
    ? await incompleteCounts(tx, settings)
    : null;
  if (!actor.permissions.has('reports.read')) {
    return { counts, confirmation, incomplete, sales: null, profit: null };
  }
  const dhaka = new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
  const today = dateBound(dhaka, false);
  const month = dateBound(`${dhaka.slice(0, 8)}01`, false);
  const weekStart = new Date(Date.parse(today) - 6 * 86_400_000).toISOString();
  const { rows: days } = await tx.db.execute<{ day: string; orders: number; total: string }>(sql`
    select to_char(placed_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD') as day, count(*)::int as orders,
           coalesce(sum(total), 0) as total
      from store.orders where status <> 'cancelled' and placed_at >= ${weekStart < month ? weekStart : month}
     group by 1`);
  const byDay = new Map(days.map((d) => [d.day, { orders: d.orders, total: Number(d.total) }]));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.parse(today) + 6 * 3_600_000 - (6 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, ...(byDay.get(date) ?? { orders: 0, total: 0 }) };
  });
  const monthTotals = days
    .filter((d) => d.day >= `${dhaka.slice(0, 8)}01`)
    .reduce((a, d) => ({ orders: a.orders + d.orders, total: a.total + Number(d.total) }), {
      orders: 0,
      total: 0,
    });
  const profit =
    actor.permissions.has('catalog.cost') && (await storeEntitlements(tx)).features.backOffice
      ? await monthToDateProfit(tx, dhaka)
      : null;
  return {
    counts,
    confirmation,
    incomplete,
    sales: { today: byDay.get(dhaka) ?? { orders: 0, total: 0 }, month: monthTotals, days: last7 },
    profit,
  };
}

/** Selected orders for invoices and packing slips (§3.17), with the store's business details. */
export async function ordersForPrint(tx: TenantTx, actor: Actor, ids: readonly string[]) {
  authorize(actor, 'orders.read');
  if (!ids.length || ids.length > 100)
    throw new AppError('validation_failed', {
      fields: [{ path: 'ids', code: 'count', message: '1 to 100 orders' }],
    });
  const settings = await orderSettings(tx);
  const orders: OrderDetail[] = [];
  for (const id of ids) orders.push(await getOrder(tx, actor, id));
  return {
    store: { name: settings.name, profile: settings.settings.profile, tax: settings.tax },
    orders,
  };
}
