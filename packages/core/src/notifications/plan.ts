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
  DEFAULT_STAFF_CHANNELS,
  type DeliveryChannel,
  type MessageEvent,
  type ShopperEvent,
  type StaffEvent,
} from '@managemind/shared/notifications';
import { formatOrderNumber } from '@managemind/shared/orders';
import { tenantSettings } from '@managemind/shared/settings';
import { eq, sql } from 'drizzle-orm';
import { approvedTemplates, contactState } from '../channels/whatsapp';
import { issueLink } from '../orders/confirm-link';
import type { OutboxEvent } from '../outbox';
import type { TenantTx } from '../tenant';

export type SkipReason =
  | 'no_gateway'
  | 'no_address'
  | 'no_device'
  /** WhatsApp (phase-9-plan §3.2.2): no approved template yet, or the shopper said stop. */
  | 'no_template'
  | 'opted_out';

export interface PlannedMessage {
  /** event ID, message event, channel and recipient: one row per message, ever. */
  idempotencyKey: string;
  event: MessageEvent;
  channel: DeliveryChannel;
  recipientType: 'shopper' | 'staff';
  /** A phone, an email address, or a staff user's ID for push. */
  recipient: string;
  orderId: string;
  locale: Locale;
  values: Record<string, string>;
  skip: SkipReason | null;
  /** An SMS held while WhatsApp tries first (phase-9-plan §3.2.2, Q7). */
  wait?: boolean;
}

export interface PlanOptions {
  /** The store's tracking page, on its own host. */
  trackUrl: string;
  /** A page of the store by path, for the confirmation link (phase-6-plan §3.7). */
  pageUrl?: (path: string) => string;
  /** The key confirmation link codes are derived from; no links without it. */
  linkKey?: string;
  /** Whether the store has a working SMS gateway. */
  smsGateway: boolean;
  /** Whether the store connected WhatsApp (phase-9-plan §3.2). */
  whatsapp?: boolean;
}

interface Triggered {
  orderId: string;
  shopper: ShopperEvent[];
  staff: StaffEvent[];
  shipmentId?: string;
  paymentId?: string;
  problem?: string;
  returnId?: string;
  refundId?: string;
  credit?: { code: string; amount: number };
  /** The confirmation link's send number, when the event may send it (phase-6-plan §3.7). */
  link?: number;
}

/** Which message events an outbox event triggers, or null for none. */
export function triggeredBy(event: OutboxEvent): Triggered | null {
  const p = (event.payload ?? {}) as {
    orderId?: string;
    by?: string;
    reason?: string;
    code?: string;
    via?: string;
    problem?: string;
    creditCode?: string;
    method?: string;
    amount?: number;
  };
  const id = event.aggregateId ?? '';
  switch (event.eventType) {
    case 'order.placed':
      return { orderId: id, shopper: ['order_placed'], staff: ['new_order'], link: 1 };
    case 'confirmation.link_requested':
      return { orderId: id, shopper: [], staff: [], link: (p as { send?: number }).send ?? 2 };
    case 'order.confirmed':
      // A shopper who just confirmed by link needs no message saying so (phase-6-plan §4).
      return { orderId: id, shopper: p.via === 'link' ? [] : ['order_confirmed'], staff: [] };
    case 'order.cancelled':
      // An unpaid online order says why it was cancelled, in one message. A
      // duplicate's shopper keeps the other order and its messages (phase-6-plan §3.4).
      return {
        orderId: id,
        shopper:
          p.code === 'duplicate'
            ? []
            : [p.reason === 'payment_expired' ? 'payment_expired' : 'order_cancelled'],
        staff: p.by === 'shopper' ? ['shopper_cancelled'] : [],
      };
    case 'shipment.shipped':
      return { orderId: p.orderId ?? '', shopper: ['order_shipped'], staff: [], shipmentId: id };
    case 'shipment.delivered':
      return { orderId: p.orderId ?? '', shopper: ['order_delivered'], staff: [], shipmentId: id };
    case 'payment.settled':
      // Only online payments: COD settles at delivery, which has its own message.
      // A risky card or a late payment asks staff to check (§3.5).
      return {
        orderId: p.orderId ?? '',
        shopper: p.problem === 'late' ? [] : ['payment_received'],
        staff: [p.problem ? 'payment_problem' : 'online_payment'],
        paymentId: id,
        ...(p.problem ? { problem: p.problem } : {}),
      };
    // Returns and refunds (§3.12, §3.13). Staff hear about shoppers' requests.
    case 'return.requested':
      return {
        orderId: p.orderId ?? '',
        shopper: [],
        staff: p.by === 'shopper' ? ['return_requested'] : [],
        returnId: id,
      };
    case 'return.approved':
      return { orderId: p.orderId ?? '', shopper: ['return_approved'], staff: [], returnId: id };
    case 'return.rejected':
      return { orderId: p.orderId ?? '', shopper: ['return_rejected'], staff: [], returnId: id };
    case 'return.received':
      return { orderId: p.orderId ?? '', shopper: ['return_received'], staff: [], returnId: id };
    case 'refund.succeeded':
      return {
        orderId: p.orderId ?? '',
        shopper: [p.method === 'store_credit' ? 'store_credit_issued' : 'refund_issued'],
        staff: [],
        refundId: id,
      };
    case 'store_credit.issued':
      return {
        orderId: p.orderId ?? '',
        shopper: ['store_credit_issued'],
        staff: [],
        credit: { code: p.creditCode ?? '', amount: p.amount ?? 0 },
      };
    default:
      return null;
  }
}

/** What a payment problem says to staff (§3.5). */
const PROBLEMS: Record<Locale, Record<string, string>> = {
  en: {
    risky: 'SSLCommerz marked the card as risky; check before confirming',
    late: 'Paid after the order was cancelled; refund it or restore the order',
  },
  bn: {
    risky: 'SSLCommerz কার্ডটিকে ঝুঁকিপূর্ণ বলেছে; নিশ্চিত করার আগে যাচাই করুন',
    late: 'অর্ডার বাতিলের পরে পরিশোধ হয়েছে; টাকা ফেরত দিন বা অর্ডারটি ফিরিয়ে আনুন',
  },
};

/** A return's reason in the message's language (§3.12). */
const REASONS: Record<Locale, Record<string, string>> = {
  en: {
    wrong_size: 'wrong size',
    damaged: 'damaged',
    wrong_item: 'wrong item',
    not_as_described: 'not as described',
    changed_mind: 'changed mind',
    other: 'other',
  },
  bn: {
    wrong_size: 'সাইজ মেলেনি',
    damaged: 'ক্ষতিগ্রস্ত',
    wrong_item: 'ভুল পণ্য',
    not_as_described: 'বর্ণনার সাথে মেলেনি',
    changed_mind: 'মত বদলেছেন',
    other: 'অন্য কারণ',
  },
};

/** How a refund was paid, in the message's language (§3.13). */
const METHODS: Record<Locale, Record<string, string>> = {
  en: {
    gateway: 'your original payment',
    gateway_manual: 'your original payment',
    bkash: 'bKash',
    nagad: 'Nagad',
    rocket: 'Rocket',
    bank: 'bank transfer',
    cash: 'cash',
    store_credit: 'store credit',
  },
  bn: {
    gateway: 'আপনার আগের পেমেন্টে',
    gateway_manual: 'আপনার আগের পেমেন্টে',
    bkash: 'বিকাশ',
    nagad: 'নগদ',
    rocket: 'রকেট',
    bank: 'ব্যাংক ট্রান্সফার',
    cash: 'নগদ টাকা',
    store_credit: 'স্টোর ক্রেডিট',
  },
};

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

  let reason: string | null = null;
  if (triggered.returnId) {
    const [ret] = await tx.db
      .select({ number: schema.returns.number, reason: schema.returns.reason })
      .from(schema.returns)
      .where(eq(schema.returns.id, triggered.returnId));
    values.return_number = `R${ret?.number ?? ''}`;
    reason = ret?.reason ?? null;
  }
  let refund: { amount: number; method: string } | null = null;
  let credit = triggered.credit ?? null;
  if (triggered.refundId) {
    const [row] = await tx.db
      .select({
        amount: schema.refunds.amount,
        method: schema.refunds.method,
        code: schema.promotionCodes.code,
      })
      .from(schema.refunds)
      .leftJoin(schema.promotionCodes, eq(schema.promotionCodes.id, schema.refunds.creditCodeId))
      .where(eq(schema.refunds.id, triggered.refundId));
    if (row) {
      refund = { amount: Number(row.amount), method: row.method };
      if (row.code) credit = { code: row.code, amount: Number(row.amount) };
    }
  }

  const t = schema.tenants;
  const [tenant] = await tx.db
    .select({ name: t.name, settings: t.settings, defaultLocale: t.defaultLocale })
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
    ...(triggered.problem
      ? { problem: PROBLEMS[locale][triggered.problem] ?? triggered.problem }
      : {}),
    ...(reason ? { reason: REASONS[locale][reason] ?? reason } : {}),
    ...(refund
      ? {
          refund_amount: formatTaka(refund.amount, locale),
          refund_method: METHODS[locale][refund.method] ?? refund.method,
        }
      : {}),
    ...(credit
      ? { credit_code: credit.code, credit_amount: formatTaka(credit.amount, locale) }
      : {}),
  });

  const planned: PlannedMessage[] = [];
  const key = (e: MessageEvent, channel: DeliveryChannel, recipient: string) =>
    `${event.id}:${e}:${channel}:${recipient}`.slice(0, 200);
  const shopperLocale = order.locale as Locale;
  // WhatsApp first, when the store connected it (phase-9-plan §3.2.2): a
  // shopper who said stop, or an event whose template Meta hasn't approved
  // in the order's language, is skipped with the reason, and SMS goes as before.
  const templates = options.whatsapp ? await approvedTemplates(tx) : null;
  const waContact = options.whatsapp ? await contactState(tx, order.phone) : null;
  const whatsappSkip = (e: MessageEvent): SkipReason | null =>
    waContact?.optedOut
      ? 'opted_out'
      : templates?.has(`${e}:${shopperLocale}`)
        ? null
        : 'no_template';
  const whatsappFirst = settings.notifications.whatsappFirst;
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
    const whatsapp = options.whatsapp && settings.notifications.whatsapp.includes(e);
    const waSkip = whatsapp ? whatsappSkip(e) : null;
    if (whatsapp) {
      planned.push({
        idempotencyKey: key(e, 'whatsapp', order.phone),
        event: e,
        channel: 'whatsapp',
        recipientType: 'shopper',
        recipient: order.phone,
        orderId: order.id,
        locale: shopperLocale,
        values: valuesFor(shopperLocale),
        skip: waSkip,
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
        wait: Boolean(whatsapp && !waSkip && whatsappFirst && options.smsGateway),
      });
    }
  }

  // The request to confirm or cancel a COD order, when the store turned it
  // on: by SMS with a link, and by WhatsApp with Confirm and Cancel buttons
  // carrying the same code (phase-9-plan §3.2.5).
  const c = settings.confirmation;
  if (triggered.link && c.queue && c.smsLink && options.linkKey && options.pageUrl) {
    const e = 'confirm_request' as const;
    const waSkip = options.whatsapp ? whatsappSkip(e) : 'no_template';
    const byWhatsapp = options.whatsapp && !waSkip;
    const code =
      options.smsGateway || byWhatsapp
        ? await issueLink(tx, options.linkKey, order.id, triggered.link)
        : null;
    if (code || !options.smsGateway) {
      const confirmValues = {
        ...valuesFor(shopperLocale),
        // The code is the fragment, after any query: it never reaches a server.
        // The page in the order's language: a prefix when it isn't the store's default.
        confirm_url: code
          ? `${options.pageUrl(shopperLocale === tenant?.defaultLocale ? 'c' : `${shopperLocale}/c`)}#${code}`
          : '',
        confirm_code: code ?? '',
      };
      if (options.whatsapp) {
        planned.push({
          idempotencyKey: key(e, 'whatsapp', order.phone),
          event: e,
          channel: 'whatsapp',
          recipientType: 'shopper',
          recipient: order.phone,
          orderId: order.id,
          locale: shopperLocale,
          values: confirmValues,
          skip: waSkip,
        });
      }
      planned.push({
        idempotencyKey: key(e, 'sms', order.phone),
        event: e,
        channel: 'sms',
        recipientType: 'shopper',
        recipient: order.phone,
        orderId: order.id,
        locale: shopperLocale,
        values: confirmValues,
        skip: options.smsGateway ? null : 'no_gateway',
        wait: Boolean(byWhatsapp && whatsappFirst && options.smsGateway),
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
