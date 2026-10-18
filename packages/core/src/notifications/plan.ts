// Which messages an outbox event sends (phase-5a-plan §3.6): to the shopper
// by email and SMS as the store's settings say, and to staff by push and
// email as each of them chose. Messages that can't go out (no SMS gateway,
// no address, no device) are planned as skipped, so the delivery log says
// why. Planning reads the order as it is now, so a redelivered event plans
// the same messages with the same keys and sends nothing twice.
import { schema } from '@managemind/db';
import { permissionsOf } from '@managemind/shared';
import { format, type Locale, money } from '@managemind/shared/money';
import {
  type Channel,
  DEFAULT_STAFF_CHANNELS,
  type MessageEvent,
  type ShopperEvent,
  type StaffEvent,
} from '@managemind/shared/notifications';
import { formatOrderNumber } from '@managemind/shared/orders';
import { tenantSettings } from '@managemind/shared/settings';
import { eq, sql } from 'drizzle-orm';
import type { OutboxEvent } from '../outbox';
import type { TenantTx } from '../tenant';

export type SkipReason = 'no_gateway' | 'no_address' | 'no_device';

export interface PlannedMessage {
  /** event ID, message event, channel and recipient: one row per message, ever. */
  idempotencyKey: string;
  event: MessageEvent;
  channel: Channel;
  recipientType: 'shopper' | 'staff';
  /** A phone, an email address, or a staff user's ID for push. */
  recipient: string;
  orderId: string;
  locale: Locale;
  values: Record<string, string>;
  skip: SkipReason | null;
}

export interface PlanOptions {
  /** The store's tracking page, on its own host. */
  trackUrl: string;
  /** Whether the store has a working SMS gateway. */
  smsGateway: boolean;
}

interface Triggered {
  orderId: string;
  shopper: ShopperEvent[];
  staff: StaffEvent[];
  shipmentId?: string;
  paymentId?: string;
}

/** Which message events an outbox event triggers, or null for none. */
export function triggeredBy(event: OutboxEvent): Triggered | null {
  const p = (event.payload ?? {}) as { orderId?: string; by?: string };
  const id = event.aggregateId ?? '';
  switch (event.eventType) {
    case 'order.placed':
      return { orderId: id, shopper: ['order_placed'], staff: ['new_order'] };
    case 'order.confirmed':
      return { orderId: id, shopper: ['order_confirmed'], staff: [] };
    case 'order.cancelled':
      return {
        orderId: id,
        shopper: ['order_cancelled'],
        staff: p.by === 'shopper' ? ['shopper_cancelled'] : [],
      };
    case 'shipment.shipped':
      return { orderId: p.orderId ?? '', shopper: ['order_shipped'], staff: [], shipmentId: id };
    case 'shipment.delivered':
      return { orderId: p.orderId ?? '', shopper: ['order_delivered'], staff: [], shipmentId: id };
    case 'payment.settled':
      // Only online payments: COD settles at delivery, which has its own message.
      return {
        orderId: p.orderId ?? '',
        shopper: ['payment_received'],
        staff: ['online_payment'],
        paymentId: id,
      };
    default:
      return null;
  }
}

/** "৳600", not "৳600.00": whole taka without the zeros, as the storefront shows them. */
export const formatTaka = (amount: number, locale: Locale) =>
  format(money(amount), locale).replace(/[.,]?[0০]{2}(?=[^0-9০-৯]*$)/u, '');

export async function planMessages(
  tx: TenantTx,
  event: OutboxEvent,
  options: PlanOptions,
): Promise<PlannedMessage[]> {
  const triggered = triggeredBy(event);
  if (!triggered?.orderId) return [];
  const o = schema.orders;
  const [order] = await tx.db
    .select({
      id: o.id,
      number: o.number,
      phone: o.phone,
      contact: o.contact,
      locale: o.locale,
      source: o.source,
      total: o.total,
      paidTotal: o.paidTotal,
      refundedTotal: o.refundedTotal,
    })
    .from(o)
    .where(eq(o.id, triggered.orderId));
  if (!order) return [];

  const values: Record<string, string> = {};
  let amount: number | null = null;
  if (triggered.paymentId) {
    const pay = schema.payments;
    const [payment] = await tx.db
      .select({ provider: pay.provider, amount: pay.amount })
      .from(pay)
      .where(eq(pay.id, triggered.paymentId));
    if (payment?.provider !== 'sslcommerz') return [];
    amount = Number(payment.amount);
  }
  if (triggered.shipmentId) {
    const s = schema.shipments;
    const [shipment] = await tx.db
      .select({ carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl })
      .from(s)
      .where(eq(s.id, triggered.shipmentId));
    values.carrier = shipment?.carrier ?? '';
    values.tracking_number = shipment?.trackingNumber ?? '';
    values.tracking_url = shipment?.trackingUrl ?? '';
  }

  const t = schema.tenants;
  const [tenant] = await tx.db
    .select({ name: t.name, settings: t.settings })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  const settings = tenantSettings.parse(tenant?.settings ?? {});
  const contact = order.contact as { name?: string; email?: string };
  const due = Math.max(
    0,
    Number(order.total) - Number(order.paidTotal) + Number(order.refundedTotal),
  );
  const valuesFor = (locale: Locale): Record<string, string> => ({
    ...values,
    store_name: tenant?.name ?? '',
    order_number: formatOrderNumber(settings.checkout.orderNumberPrefix, Number(order.number)),
    customer_name: contact.name ?? '',
    total: formatTaka(Number(order.total), locale),
    amount_due: formatTaka(due, locale),
    order_url: options.trackUrl,
    source: order.source,
    ...(amount === null ? {} : { amount: formatTaka(amount, locale) }),
  });

  const planned: PlannedMessage[] = [];
  const key = (e: MessageEvent, channel: Channel, recipient: string) =>
    `${event.id}:${e}:${channel}:${recipient}`.slice(0, 200);
  const shopperLocale = order.locale as Locale;
  for (const e of triggered.shopper) {
    if (settings.notifications.email.includes(e)) {
      const email = contact.email ?? '';
      planned.push({
        idempotencyKey: key(e, 'email', email || 'none'),
        event: e,
        channel: 'email',
        recipientType: 'shopper',
        recipient: email || '-',
        orderId: order.id,
        locale: shopperLocale,
        values: valuesFor(shopperLocale),
        skip: email ? null : 'no_address',
      });
    }
    if (settings.notifications.sms.includes(e)) {
      planned.push({
        idempotencyKey: key(e, 'sms', order.phone),
        event: e,
        channel: 'sms',
        recipientType: 'shopper',
        recipient: order.phone,
        orderId: order.id,
        locale: shopperLocale,
        values: valuesFor(shopperLocale),
        skip: options.smsGateway ? null : 'no_gateway',
      });
    }
  }

  if (triggered.staff.length) {
    for (const member of await staffRecipients(tx)) {
      for (const e of triggered.staff) {
        for (const channel of ['push', 'email'] as const) {
          const on = member.choices.get(`${e}:${channel}`) ?? DEFAULT_STAFF_CHANNELS[channel];
          if (!on) continue;
          const push = channel === 'push';
          planned.push({
            idempotencyKey: key(e, channel, member.userId),
            event: e,
            channel,
            recipientType: 'staff',
            recipient: push ? member.userId : member.email,
            orderId: order.id,
            locale: member.locale,
            values: valuesFor(member.locale),
            skip: push && !member.devices ? 'no_device' : null,
          });
        }
      }
    }
  }
  return planned;
}

interface StaffRecipient {
  userId: string;
  email: string;
  locale: Locale;
  devices: number;
  /** `${event}:${channel}` → enabled, for the choices the member changed. */
  choices: Map<string, boolean>;
}

/** The store's members who can see orders, with their alert choices and push devices. */
async function staffRecipients(tx: TenantTx): Promise<StaffRecipient[]> {
  const m = schema.memberships;
  const u = schema.users;
  const members = await tx.db
    .select({
      userId: m.userId,
      role: m.role,
      email: u.email,
      locale: u.locale,
      devices: sql<number>`(select count(*)::int from store.push_subscriptions ps where ps.user_id = ${m.userId})`,
    })
    .from(m)
    .innerJoin(u, eq(u.id, m.userId))
    .where(eq(m.tenantId, tx.tenantId));
  const p = schema.staffAlertPreferences;
  const prefs = await tx.db.select().from(p);
  return members
    .filter((r) => permissionsOf(r.role).has('orders.read'))
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      locale: r.locale as Locale,
      devices: Number(r.devices),
      choices: new Map(
        prefs
          .filter((x) => x.userId === r.userId)
          .map((x) => [`${x.event}:${x.channel}`, x.enabled] as const),
      ),
    }));
}
