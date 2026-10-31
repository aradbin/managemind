// Messages to shoppers and staff (phase-5a-plan §3.6–§3.9): the events that
// send them, the variables each event's templates may use, and the rules for
// rendering a template safely. Default templates and per-store overrides use
// the same rules, so a template that saves always renders.
import { z } from 'zod';
import { DEFAULT_WHATSAPP_EVENTS } from './whatsapp';

export const CHANNELS = ['email', 'sms', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];
/**
 * What a message in the delivery log can go by: the template channels and
 * WhatsApp, whose wording is Meta's approved templates (phase-9-plan §3.2).
 */
export const DELIVERY_CHANNELS = [...CHANNELS, 'whatsapp'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** What a shopper hears about. Every one can go by email; SMS is per store (Q8). */
export const SHOPPER_EVENTS = [
  'order_placed',
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'payment_received',
  'payment_expired',
  'return_approved',
  'return_rejected',
  'return_received',
  'refund_issued',
  'store_credit_issued',
] as const;
export type ShopperEvent = (typeof SHOPPER_EVENTS)[number];

/** What staff can be alerted about (§3.9), each by push, email or SMS. */
export const STAFF_EVENTS = [
  'new_order',
  'online_payment',
  'shopper_cancelled',
  'return_requested',
  'payment_problem',
] as const;
export type StaffEvent = (typeof STAFF_EVENTS)[number];

/**
 * Shopper messages a store setting sends rather than the notification
 * settings, by SMS only: the link to confirm or cancel a COD order
 * (phase-6-plan §3.7), sent when `confirmation.smsLink` is on.
 */
export const SHOPPER_SMS_EVENTS = ['confirm_request'] as const;
export type ShopperSmsEvent = (typeof SHOPPER_SMS_EVENTS)[number];

export type MessageEvent = ShopperEvent | ShopperSmsEvent | StaffEvent;
export const MESSAGE_EVENTS: readonly MessageEvent[] = [
  ...SHOPPER_EVENTS,
  ...SHOPPER_SMS_EVENTS,
  ...STAFF_EVENTS,
];

/** Staff channels on by default: push for everything (§3.9). */
export const DEFAULT_STAFF_CHANNELS: Readonly<Record<Channel, boolean>> = {
  push: true,
  email: false,
  sms: false,
};

/** Shopper SMS by default (Q8): the order placed with its tracking link, and shipped. */
export const DEFAULT_SHOPPER_SMS: readonly ShopperEvent[] = ['order_placed', 'order_shipped'];

export const notificationSettings = z
  .object({
    /** Shopper events sent by SMS when the store has a gateway. */
    sms: z
      .array(z.enum(SHOPPER_EVENTS))
      .max(SHOPPER_EVENTS.length)
      .default(() => [...DEFAULT_SHOPPER_SMS]),
    /** Shopper events sent by email when the shopper gave an address. */
    email: z
      .array(z.enum(SHOPPER_EVENTS))
      .max(SHOPPER_EVENTS.length)
      .default(() => [...SHOPPER_EVENTS]),
    /** Shopper events sent by WhatsApp when the store connected it (phase-9-plan §3.2.2). */
    whatsapp: z
      .array(z.enum(SHOPPER_EVENTS))
      .max(SHOPPER_EVENTS.length)
      .default(() => [...DEFAULT_WHATSAPP_EVENTS]),
    /** SMS waits for WhatsApp and goes only if WhatsApp can't deliver (Q7). */
    whatsappFirst: z.boolean().default(true),
  })
  .strict();
export type NotificationSettings = z.infer<typeof notificationSettings>;

const ORDER = ['store_name', 'order_number', 'customer_name', 'total', 'order_url'] as const;

/** The variables each event's templates may use (§3.7). */
export const TEMPLATE_VARIABLES: Readonly<Record<MessageEvent, readonly string[]>> = {
  order_placed: [...ORDER, 'amount_due'],
  order_confirmed: [...ORDER, 'amount_due'],
  order_shipped: [...ORDER, 'amount_due', 'carrier', 'tracking_number', 'tracking_url'],
  order_delivered: ORDER,
  order_cancelled: ORDER,
  payment_received: [...ORDER, 'amount', 'amount_due'],
  payment_expired: ORDER,
  return_approved: [...ORDER, 'return_number'],
  return_rejected: [...ORDER, 'return_number'],
  return_received: [...ORDER, 'return_number'],
  refund_issued: [...ORDER, 'refund_amount', 'refund_method'],
  store_credit_issued: [...ORDER, 'credit_code', 'credit_amount'],
  confirm_request: ['store_name', 'order_number', 'customer_name', 'amount_due', 'confirm_url'],
  new_order: [...ORDER, 'source'],
  online_payment: [...ORDER, 'amount'],
  shopper_cancelled: ORDER,
  return_requested: [...ORDER, 'return_number', 'reason'],
  payment_problem: [...ORDER, 'amount', 'problem'],
};

const VARIABLE = /\{([a-z_]+)\}/g;

/** The variables a template uses, in order of first use. */
export function templateVariables(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(VARIABLE)) found.add(m[1] as string);
  return [...found];
}

/** Variables the event doesn't have; saving refuses a template that uses any. */
export function unknownVariables(event: MessageEvent, text: string): string[] {
  const allowed = TEMPLATE_VARIABLES[event];
  return templateVariables(text).filter((v) => !allowed.includes(v));
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);

/**
 * Fills a template's variables. Values are escaped for HTML in email bodies
 * and left as plain text for SMS, push and subjects; a variable without a
 * value renders empty, so a missing tracking number never shows "{...}".
 */
export function renderTemplate(
  text: string,
  values: Readonly<Record<string, string | undefined>>,
  mode: 'html' | 'plain',
): string {
  return text.replace(VARIABLE, (_, name: string) => {
    const value = values[name] ?? '';
    return mode === 'html' ? escapeHtml(value) : value;
  });
}

// The GSM 03.38 alphabet: a message using only these characters is 7-bit;
// anything else (Bangla, for example) makes the whole message Unicode.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

export interface SmsParts {
  encoding: 'gsm' | 'unicode';
  /** Characters as the network counts them (an extended GSM character counts 2). */
  length: number;
  parts: number;
}

/**
 * How many SMS parts a message takes (§3.7): 160 GSM characters or 70
 * Unicode ones in one part, 153 or 67 per part when split.
 */
export function smsParts(text: string): SmsParts {
  const chars = [...text];
  const gsm = chars.every((c) => GSM_BASIC.includes(c) || GSM_EXTENDED.includes(c));
  if (gsm) {
    const length = chars.reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0);
    return { encoding: 'gsm', length, parts: length <= 160 ? 1 : Math.ceil(length / 153) };
  }
  // UCS-2 counts UTF-16 code units, so a character outside the BMP counts 2.
  const length = text.length;
  return { encoding: 'unicode', length, parts: length <= 70 ? 1 : Math.ceil(length / 67) };
}
export { defaultTemplate, type Template } from './defaults';
export * from './whatsapp';
