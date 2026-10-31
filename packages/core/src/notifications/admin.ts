// What staff see and change of messages (phase-5a-plan §3.7, §3.9, §6.3):
// the delivery log, the store's templates with a preview, and each staff
// member's own alert choices.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import type { Locale } from '@managemind/shared/money';
import {
  CHANNELS,
  type Channel,
  DEFAULT_STAFF_CHANNELS,
  DELIVERY_CHANNELS,
  type DeliveryChannel,
  defaultTemplate,
  MESSAGE_EVENTS,
  type MessageEvent,
  renderTemplate,
  STAFF_EVENTS,
  smsParts,
  TEMPLATE_VARIABLES,
  unknownVariables,
} from '@managemind/shared/notifications';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { maskPhone } from '../orders/views';
import type { TenantTx } from '../tenant';

const m = schema.messages;

export interface MessageView {
  id: string;
  event: MessageEvent;
  channel: DeliveryChannel;
  recipientType: 'shopper' | 'staff';
  recipient: string;
  orderId: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped' | 'waiting';
  /** WhatsApp: what Meta last reported (phase-9-plan §3.2.4). */
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' | null;
  reason: string | null;
  attempts: number;
  provider: string | null;
  sentAt: string | null;
  createdAt: string;
}

export const messageListQuery = z
  .object({
    orderId: z.uuid().optional(),
    status: z.enum(['queued', 'sent', 'failed', 'skipped', 'waiting']).optional(),
    channel: z.enum(DELIVERY_CHANNELS).optional(),
    /** The createdAt of the last row seen, for the next page. */
    before: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const maskEmail = (email: string) => email.replace(/^(.).*(@.*)$/, '$1•••$2');

/** The delivery log, newest first; recipients masked without customers.read. */
export async function listMessages(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<MessageView[]> {
  authorize(actor, 'orders.read');
  const q = parseInput(messageListQuery, query);
  const where: SQL[] = [];
  if (q.orderId) where.push(eq(m.orderId, q.orderId));
  if (q.status) where.push(eq(m.status, q.status));
  if (q.channel) where.push(eq(m.channel, q.channel));
  if (q.before) where.push(lt(m.createdAt, new Date(q.before)));
  const rows = await tx.db
    .select()
    .from(m)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(m.createdAt))
    .limit(q.limit);
  const personal = actor.permissions.has('customers.read');
  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    channel: r.channel,
    recipientType: r.recipientType,
    recipient:
      r.recipientType === 'staff' || personal
        ? r.recipient
        : r.channel === 'sms' || r.channel === 'whatsapp'
          ? maskPhone(r.recipient)
          : maskEmail(r.recipient),
    orderId: r.orderId,
    status: r.status,
    deliveryStatus: r.deliveryStatus,
    reason: r.reason,
    attempts: r.attempts,
    provider: r.provider,
    sentAt: r.sentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Queues a failed message again and returns the outbox event it came from,
 * which the caller plans again: only queued messages send, so the others
 * stay as they were.
 */
export async function requeueMessage(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<{ eventId: string }> {
  authorize(actor, 'orders.write');
  const [row] = await tx.db
    .select({ status: m.status, key: m.idempotencyKey })
    .from(m)
    .where(eq(m.id, id))
    .for('update');
  if (!row) throw new AppError('not_found');
  if (row.status !== 'failed') {
    throw new AppError('conflict', { detail: 'only a failed message can be sent again' });
  }
  await tx.db.update(m).set({ status: 'queued', reason: null }).where(eq(m.id, id));
  return { eventId: row.key.slice(0, row.key.indexOf(':')) };
}

// ---- Templates -----------------------------------------------------------------------

export interface TemplateView {
  event: MessageEvent;
  channel: Channel;
  locale: Locale;
  subject: string | null;
  body: string;
  /** False while the store uses the default wording. */
  custom: boolean;
  variables: string[];
}

const LOCALES = ['bn', 'en'] as const;

/** Every template the store can change: its own where it has one, the default otherwise. */
export async function listTemplates(tx: TenantTx, actor: Actor): Promise<TemplateView[]> {
  authorize(actor, 'settings.read');
  const t = schema.messageTemplates;
  const own = await tx.db.select().from(t);
  const byKey = new Map(own.map((r) => [`${r.event}:${r.channel}:${r.locale}`, r]));
  const views: TemplateView[] = [];
  for (const event of MESSAGE_EVENTS) {
    for (const channel of CHANNELS) {
      for (const locale of LOCALES) {
        const fallback = defaultTemplate(event, channel, locale);
        if (!fallback) continue;
        const row = byKey.get(`${event}:${channel}:${locale}`);
        views.push({
          event,
          channel,
          locale,
          subject: row ? row.subject : (fallback.subject ?? null),
          body: row?.body ?? fallback.body,
          custom: Boolean(row),
          variables: [...TEMPLATE_VARIABLES[event]],
        });
      }
    }
  }
  return views;
}

export const templateInput = z
  .object({
    event: z.enum(MESSAGE_EVENTS as [MessageEvent, ...MessageEvent[]]),
    channel: z.enum(CHANNELS),
    locale: z.enum(LOCALES),
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

function checkTemplate(v: z.infer<typeof templateInput>): void {
  if (!defaultTemplate(v.event, v.channel, v.locale)) {
    throw new AppError('validation_failed', {
      fields: [
        { path: 'channel', code: 'invalid', message: `${v.event} is not sent by ${v.channel}` },
      ],
    });
  }
  const unknown = unknownVariables(v.event, `${v.subject ?? ''} ${v.body}`);
  if (unknown.length) {
    throw new AppError('validation_failed', {
      fields: [
        {
          path: 'body',
          code: 'unknown_variable',
          message: `unknown: ${unknown.map((u) => `{${u}}`).join(', ')}`,
        },
      ],
    });
  }
  if (v.channel === 'email' && !v.subject) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'subject', code: 'required', message: 'an email needs a subject' }],
    });
  }
}

/** Example values for the preview (§3.7): what a real order would put in. */
const SAMPLE: Record<Locale, Record<string, string>> = {
  en: {
    store_name: 'Your Store',
    order_number: '#1001',
    customer_name: 'Rina Akter',
    total: '৳1,250',
    amount_due: '৳1,250',
    order_url: 'https://your-store.example/track',
    carrier: 'Steadfast',
    tracking_number: 'SF123456',
    tracking_url: 'https://steadfast.com.bd/t/SF123456',
    amount: '৳130',
    return_number: 'R1001',
    refund_amount: '৳600',
    refund_method: 'bKash',
    credit_code: 'CREDIT-7K2P',
    credit_amount: '৳600',
    source: 'website',
    reason: 'wrong size',
    problem: 'Paid after the order was cancelled',
  },
  bn: {
    store_name: 'আপনার দোকান',
    order_number: '#১০০১',
    customer_name: 'রিনা আক্তার',
    total: '১,২৫০৳',
    amount_due: '১,২৫০৳',
    order_url: 'https://your-store.example/track',
    carrier: 'Steadfast',
    tracking_number: 'SF123456',
    tracking_url: 'https://steadfast.com.bd/t/SF123456',
    amount: '১৩০৳',
    return_number: 'R1001',
    refund_amount: '৬০০৳',
    refund_method: 'বিকাশ',
    credit_code: 'CREDIT-7K2P',
    credit_amount: '৬০০৳',
    source: 'ওয়েবসাইট',
    reason: 'সাইজ মেলেনি',
    problem: 'অর্ডার বাতিলের পরে পরিশোধ',
  },
};

export interface TemplatePreview {
  subject: string;
  body: string;
  sms: ReturnType<typeof smsParts> | null;
}

/** Fills a template being edited with sample values; refuses unknown variables like saving does. */
export function previewTemplate(actor: Actor, input: unknown): TemplatePreview {
  authorize(actor, 'settings.read');
  const v = parseInput(templateInput, input);
  checkTemplate(v);
  const values = SAMPLE[v.locale];
  const body = renderTemplate(v.body, values, 'plain');
  return {
    subject: renderTemplate(v.subject ?? '', values, 'plain'),
    body,
    sms: v.channel === 'sms' ? smsParts(body) : null,
  };
}

export async function saveTemplate(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<TemplateView> {
  authorize(actor, 'settings.write');
  const v = parseInput(templateInput, input);
  checkTemplate(v);
  const t = schema.messageTemplates;
  const values = {
    subject: v.channel === 'sms' ? null : (v.subject ?? null),
    body: v.body,
    updatedBy: actor.userId,
    updatedAt: new Date(),
  };
  await tx.db
    .insert(t)
    .values({ event: v.event, channel: v.channel, locale: v.locale, ...values })
    .onConflictDoUpdate({ target: [t.tenantId, t.event, t.channel, t.locale], set: values });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'template.saved',
    entityType: 'message_template',
    after: { event: v.event, channel: v.channel, locale: v.locale },
  });
  return {
    event: v.event,
    channel: v.channel,
    locale: v.locale,
    subject: values.subject,
    body: v.body,
    custom: true,
    variables: [...TEMPLATE_VARIABLES[v.event]],
  };
}

/** Back to the default wording. */
export async function resetTemplate(
  tx: TenantTx,
  actor: Actor,
  key: { event: string; channel: string; locale: string },
): Promise<void> {
  authorize(actor, 'settings.write');
  const t = schema.messageTemplates;
  const deleted = await tx.db
    .delete(t)
    .where(
      and(
        eq(t.event, key.event as MessageEvent),
        eq(t.channel, key.channel as Channel),
        eq(t.locale, key.locale),
      ),
    )
    .returning({ event: t.event });
  if (!deleted.length) throw new AppError('not_found');
}

// ---- Staff alert choices (§3.9) ------------------------------------------------------

export interface AlertChoice {
  event: (typeof STAFF_EVENTS)[number];
  push: boolean;
  email: boolean;
}

/** A staff member's own: only a signed-in person has alert choices. */
function staffUser(actor: Actor): string {
  authorize(actor, 'orders.read');
  if (!actor.userId) throw new AppError('forbidden');
  return actor.userId;
}

export async function getAlertChoices(tx: TenantTx, actor: Actor): Promise<AlertChoice[]> {
  const userId = staffUser(actor);
  const p = schema.staffAlertPreferences;
  const rows = await tx.db.select().from(p).where(eq(p.userId, userId));
  const set = new Map(rows.map((r) => [`${r.event}:${r.channel}`, r.enabled]));
  return STAFF_EVENTS.map((event) => ({
    event,
    push: set.get(`${event}:push`) ?? DEFAULT_STAFF_CHANNELS.push,
    email: set.get(`${event}:email`) ?? DEFAULT_STAFF_CHANNELS.email,
  }));
}

export const alertChoicesInput = z
  .array(z.object({ event: z.enum(STAFF_EVENTS), push: z.boolean(), email: z.boolean() }).strict())
  .max(STAFF_EVENTS.length);

export async function setAlertChoices(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<AlertChoice[]> {
  const userId = staffUser(actor);
  const choices = parseInput(alertChoicesInput, input);
  const p = schema.staffAlertPreferences;
  for (const c of choices) {
    for (const channel of ['push', 'email'] as const) {
      await tx.db
        .insert(p)
        .values({ userId, event: c.event, channel, enabled: c[channel] })
        .onConflictDoUpdate({
          target: [p.tenantId, p.userId, p.event, p.channel],
          set: { enabled: c[channel] },
        });
    }
  }
  return getAlertChoices(tx, actor);
}
