// Server-side events for Meta's Conversions API (phase-9-plan §3.1.6, ADR
// 0032). An outbox event becomes at most one row in store.meta_events per
// order and event name, so a redelivered event never reports a purchase
// twice. Nothing is sent without the shopper's consent, which checkout
// records on the order as its attribution. This module plans the event and
// builds its payload; the API sends it and records the outcome.
import { tenantSettings } from '@managemind/shared/settings';
import { sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import type { OutboxEvent } from '../outbox';
import type { TenantTx } from '../tenant';

export type MetaEventName = 'Purchase' | 'Delivered';

/** Outbox events that can report to Meta. */
export const META_EVENT_TRIGGERS = new Set([
  'order.placed',
  'order.confirmed',
  'shipment.delivered',
]);

/** The Meta event an outbox event may report, and its order. */
export function metaEventOf(e: OutboxEvent): { name: MetaEventName; orderId: string } | null {
  if (e.eventType === 'order.placed' || e.eventType === 'order.confirmed') {
    return e.aggregateId ? { name: 'Purchase', orderId: e.aggregateId } : null;
  }
  if (e.eventType === 'shipment.delivered') {
    const orderId = (e.payload as { orderId?: string }).orderId;
    return orderId ? { name: 'Delivered', orderId } : null;
  }
  return null;
}

export interface PlannedMetaEvent {
  id: string;
  orderId: string;
  name: MetaEventName;
  /** Reported at placement: the event's time is the order's; otherwise now. */
  atPlacement: boolean;
}

/**
 * Records what the outbox event should report, once per order and name, and
 * returns it when it should be sent now. A row already sent, skipped or
 * failed for good returns null; one still queued (an earlier send that can
 * be retried) is returned again.
 */
export async function planMetaEvent(
  tx: TenantTx,
  e: OutboxEvent,
  options: { hasToken: boolean },
): Promise<PlannedMetaEvent | null> {
  const which = metaEventOf(e);
  if (!which) return null;
  const { rows: tenant } = await tx.db.execute<{ settings: unknown }>(
    sql`select settings from platform.tenants where id = ${tx.tenantId}`,
  );
  const { meta } = tenantSettings.parse(tenant[0]?.settings ?? {});
  if (which.name === 'Purchase') {
    // The store chose when a purchase counts (Q5): placed, or confirmed.
    const when = e.eventType === 'order.placed' ? 'placed' : 'confirmed';
    if (meta.purchaseAt !== when) return null;
  } else if (!meta.deliveredEvent) {
    return null;
  }
  const { rows: orders } = await tx.db.execute<{
    source: string;
    delivery_status: string;
    consented: boolean;
  }>(sql`
    select source, delivery_status, attribution ->> 'consentedAt' is not null as consented
      from store.orders where id = ${which.orderId}`);
  const order = orders[0];
  // Staff orders send nothing until stage 5 knows which ad started their chat.
  if (order?.source !== 'website') return null;
  // Delivered once the whole order is: a later shipment's event will come.
  if (which.name === 'Delivered' && order.delivery_status !== 'delivered') return null;
  const skip = !order.consented ? 'no_consent' : !options.hasToken ? 'no_token' : null;
  const { rows: inserted } = await tx.db.execute<{ id: string }>(sql`
    insert into store.meta_events (order_id, name, status, reason)
    values (${which.orderId}, ${which.name}, ${skip ? 'skipped' : 'queued'}, ${skip})
    on conflict (tenant_id, order_id, name) do nothing
    returning id`);
  const atPlacement = e.eventType === 'order.placed';
  if (inserted[0]) return skip ? null : { id: inserted[0].id, ...which, atPlacement };
  const { rows: existing } = await tx.db.execute<{ id: string; status: string }>(sql`
    select id, status from store.meta_events where order_id = ${which.orderId} and name = ${which.name}`);
  return existing[0]?.status === 'queued' ? { id: existing[0].id, ...which, atPlacement } : null;
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of a value normalized as Meta asks: trimmed and lower case. */
export async function metaHash(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)));
}

/** The event as the Conversions API takes it (providers/meta's CapiEvent). */
export interface MetaEventPayload {
  event_name: MetaEventName;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: Record<string, string | string[]>;
  custom_data: {
    currency: 'BDT';
    value: number;
    order_id: string;
    content_type: 'product';
    contents: { id: string; quantity: number; item_price: number }[];
    num_items: number;
  };
}

/**
 * The payload for a planned event. Contact details are hashed; the IP and
 * browser go as they are, as Meta requires, and only because the shopper
 * consented. A purchase's event ID is the order's, the browser pixel's too,
 * so Meta keeps one of the two.
 */
export async function metaEventPayload(
  tx: TenantTx,
  planned: PlannedMetaEvent,
  options: { sourceUrl: string; now?: Date },
): Promise<MetaEventPayload | null> {
  const { rows } = await tx.db.execute<{
    id: string;
    number: string;
    phone: string;
    contact: { name?: string; email?: string };
    address: { names?: { district?: { en?: string } } } | null;
    customer_id: string;
    total: string;
    refunded_total: string;
    ip: string | null;
    user_agent: string | null;
    attribution: { fbp?: string; fbc?: string } | null;
    placed_at: string;
  }>(sql`
    select id, number, phone, contact, address, customer_id, total, refunded_total,
           host(ip) as ip, user_agent, attribution, placed_at
      from store.orders where id = ${planned.orderId}`);
  const o = rows[0];
  if (!o?.attribution) return null;
  const { rows: lines } = await tx.db.execute<{
    variant_id: string;
    quantity: number;
    unit_price: string;
  }>(sql`
    select variant_id, quantity, unit_price from store.order_lines
     where order_id = ${planned.orderId} order by position, id`);
  const names = (o.contact.name ?? '').trim().split(/\s+/).filter(Boolean);
  const district = o.address?.names?.district?.en?.toLowerCase().replace(/[^a-z]/g, '');
  const user: Record<string, string | string[]> = {
    // Meta's phone format: country code and number, digits only.
    ph: [await metaHash(o.phone.replace(/\D/g, ''))],
    country: [await metaHash('bd')],
    external_id: [await metaHash(o.customer_id)],
  };
  if (o.contact.email) user.em = [await metaHash(o.contact.email)];
  if (names[0]) user.fn = [await metaHash(names[0])];
  if (names.length > 1) user.ln = [await metaHash(names.at(-1) as string)];
  if (district) user.ct = [await metaHash(district)];
  if (o.ip) user.client_ip_address = o.ip;
  if (o.user_agent) user.client_user_agent = o.user_agent;
  if (o.attribution.fbp) user.fbp = o.attribution.fbp;
  if (o.attribution.fbc) user.fbc = o.attribution.fbc;
  const purchase = planned.name === 'Purchase';
  // A purchase reported at placement keeps the placement's time; the rest happen now.
  const at = planned.atPlacement ? new Date(o.placed_at) : (options.now ?? new Date());
  const value = Number(o.total) - (purchase ? 0 : Number(o.refunded_total));
  return {
    event_name: planned.name,
    event_time: Math.floor(at.getTime() / 1000),
    event_id: purchase ? o.id : `${o.id}:delivered`,
    action_source: 'website',
    event_source_url: options.sourceUrl,
    user_data: user,
    custom_data: {
      currency: 'BDT',
      value: Math.max(0, value) / 100,
      order_id: String(o.number),
      content_type: 'product',
      contents: lines.map((l) => ({
        id: l.variant_id,
        quantity: l.quantity,
        item_price: Number(l.unit_price) / 100,
      })),
      num_items: lines.reduce((n, l) => n + l.quantity, 0),
    },
  };
}

/** Records a send's outcome: sent, a failure to retry (stays queued), or a final one. */
export async function recordMetaEvent(
  tx: TenantTx,
  id: string,
  outcome: { status: 'sent' } | { status: 'queued' | 'failed'; reason: string },
): Promise<void> {
  await tx.db.execute(sql`
    update store.meta_events
       set status = ${outcome.status}, attempts = attempts + 1,
           reason = ${outcome.status === 'sent' ? null : outcome.reason.slice(0, 300)},
           sent_at = case when ${outcome.status} = 'sent' then now() else sent_at end
     where id = ${id}`);
}

export interface MetaEventRow {
  id: string;
  orderId: string;
  orderNumber: number;
  name: MetaEventName;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  reason: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** The latest events, for the settings page (settings.read). */
export async function listMetaEvents(tx: TenantTx, actor: Actor): Promise<MetaEventRow[]> {
  authorize(actor, 'settings.read');
  const { rows } = await tx.db.execute<{
    id: string;
    order_id: string;
    number: string;
    name: MetaEventName;
    status: MetaEventRow['status'];
    reason: string | null;
    created_at: string;
    sent_at: string | null;
  }>(sql`
    select e.id, e.order_id, o.number, e.name, e.status, e.reason, e.created_at, e.sent_at
      from store.meta_events e join store.orders o on o.id = e.order_id
     order by e.created_at desc limit 20`);
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    orderNumber: Number(r.number),
    name: r.name,
    status: r.status,
    reason: r.reason,
    createdAt: new Date(r.created_at).toISOString(),
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  }));
}

export interface CapiConnection {
  connected: boolean;
  pixelId: string | null;
  testEventCode: string | null;
  /** The token's last four characters. */
  hint: string | null;
  checkError: string | null;
}

/** Whether the Conversions API is connected, without its token (settings.read). */
export async function capiConnection(tx: TenantTx, actor: Actor): Promise<CapiConnection> {
  authorize(actor, 'settings.read');
  const { rows } = await tx.db.execute<{
    config: { pixelId?: string; testEventCode?: string };
    hint: string;
    check_error: string | null;
  }>(
    sql`select config, hint, check_error from store.provider_credentials where kind = 'meta_capi'`,
  );
  const r = rows[0];
  return {
    connected: Boolean(r),
    pixelId: r?.config.pixelId ?? null,
    testEventCode: r?.config.testEventCode ?? null,
    hint: r?.hint ?? null,
    checkError: r?.check_error ?? null,
  };
}
