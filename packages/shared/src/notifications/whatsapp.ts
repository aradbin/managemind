// WhatsApp order updates (phase-9-plan §3.2.2, §3.2.3): which shopper events
// can go by WhatsApp, their default wording in both languages, and how a
// wording becomes a Meta template. WhatsApp sends only approved templates
// outside the shopper's 24-hour window, so each store's account gets these
// submitted when it connects; Meta reviews each one. The wording is a draft
// for the owner to approve, as Phase 5A's SMS wording was.
import type { Locale } from '../money';
import type { ShopperEvent, ShopperSmsEvent } from './index';

/** The shopper events WhatsApp can carry, and the confirmation request with its buttons. */
export const WHATSAPP_EVENTS = [
  'order_placed',
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'payment_received',
  'refund_issued',
  'confirm_request',
] as const satisfies readonly (ShopperEvent | ShopperSmsEvent)[];
export type WhatsappEvent = (typeof WHATSAPP_EVENTS)[number];

/** On by default once WhatsApp is connected (§3.2.2). */
export const DEFAULT_WHATSAPP_EVENTS: readonly ShopperEvent[] = [
  'order_placed',
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'payment_received',
  'refund_issued',
];

/**
 * The default wording. Meta refuses a template that starts or ends with a
 * variable, or has two side by side, so each starts with words and ends with
 * punctuation or text.
 */
export const WHATSAPP_DEFAULTS: Record<WhatsappEvent, Record<Locale, string>> = {
  order_placed: {
    en: 'Thank you, {customer_name}! {store_name} received your order {order_number}. Total: {total}. You can follow it here: {order_url} .',
    bn: 'ধন্যবাদ, {customer_name}! {store_name} আপনার অর্ডার {order_number} পেয়েছে। মোট: {total}। এখানে দেখুন: {order_url} ।',
  },
  order_confirmed: {
    en: 'Your order {order_number} from {store_name} is confirmed. To pay on delivery: {amount_due}.',
    bn: 'আপনার অর্ডার {order_number} ({store_name}) নিশ্চিত হয়েছে। ডেলিভারিতে পরিশোধ: {amount_due}।',
  },
  order_shipped: {
    en: 'Your order {order_number} from {store_name} is on its way with {carrier}, tracking {tracking_number}. To pay on delivery: {amount_due}.',
    bn: 'আপনার অর্ডার {order_number} ({store_name}) রওনা হয়েছে: কুরিয়ার {carrier}, ট্র্যাকিং {tracking_number}। ডেলিভারিতে পরিশোধ: {amount_due}।',
  },
  order_delivered: {
    en: 'Your order {order_number} from {store_name} was delivered. Thank you for shopping with us!',
    bn: 'আপনার অর্ডার {order_number} ({store_name}) পৌঁছে গেছে। আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ!',
  },
  order_cancelled: {
    en: 'Your order {order_number} from {store_name} was cancelled. Reply here if you have a question.',
    bn: 'আপনার অর্ডার {order_number} ({store_name}) বাতিল হয়েছে। প্রশ্ন থাকলে এখানে লিখুন।',
  },
  payment_received: {
    en: 'We received {amount} for your order {order_number} from {store_name}. Thank you!',
    bn: 'আপনার অর্ডার {order_number}-এর জন্য {amount} পেয়েছি ({store_name})। ধন্যবাদ!',
  },
  refund_issued: {
    en: 'We refunded {refund_amount} for your order {order_number} from {store_name}, by {refund_method}.',
    bn: 'আপনার অর্ডার {order_number}-এর {refund_amount} ফেরত দেওয়া হয়েছে ({store_name}), {refund_method} মাধ্যমে।',
  },
  confirm_request: {
    en: 'Please confirm your order {order_number} from {store_name}. You will pay {amount_due} on delivery. Tap a button below.',
    bn: 'অনুগ্রহ করে আপনার অর্ডার {order_number} ({store_name}) নিশ্চিত করুন। ডেলিভারিতে {amount_due} পরিশোধ করবেন। নিচের একটি বোতাম চাপুন।',
  },
};

/** The confirmation request's quick replies: Confirm, then Cancel (§3.2.5). */
export const CONFIRM_BUTTONS: Record<Locale, [string, string]> = {
  en: ['Confirm order', 'Cancel'],
  bn: ['অর্ডার নিশ্চিত', 'বাতিল'],
};

/** A button's payload: what the shopper tapped, and the order's confirmation code. */
export const confirmPayload = (action: 'confirm' | 'cancel', code: string) => `${action}:${code}`;
export function readConfirmPayload(
  payload: string,
): { action: 'confirm' | 'cancel'; code: string } | null {
  const m = /^(confirm|cancel):([0-9A-Za-z]{6,32})$/.exec(payload);
  return m ? { action: m[1] as 'confirm' | 'cancel', code: m[2] as string } : null;
}

/** Each store's template name: the platform's prefix, the event, and a version for edits. */
export const whatsappTemplateName = (event: WhatsappEvent, version = 1) =>
  `mm_${event}${version > 1 ? `_v${version}` : ''}`;

/** Sample values, which Meta asks for with every variable when a template is reviewed. */
const SAMPLES: Record<string, string> = {
  store_name: 'Demo Fashion',
  customer_name: 'Rahim',
  order_number: '#1042',
  total: '৳2,660',
  amount_due: '৳2,660',
  amount: '৳1,000',
  order_url: 'https://demo.example.com/track',
  carrier: 'Steadfast',
  tracking_number: 'SF123456',
  refund_amount: '৳500',
  refund_method: 'bKash',
};

export interface WhatsappTemplateText {
  /** The body with {{1}}, {{2}}, … in place of our variables. */
  body: string;
  /** Our variable for each number, in order. */
  variables: string[];
  examples: string[];
}

/** Our wording as a Meta template body: each variable numbered by first use. */
export function toWhatsappTemplate(text: string): WhatsappTemplateText {
  const variables: string[] = [];
  const body = text.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    let n = variables.indexOf(name);
    if (n < 0) n = variables.push(name) - 1;
    return `{{${n + 1}}}`;
  });
  return { body, variables, examples: variables.map((v) => SAMPLES[v] ?? v) };
}

/** Problems Meta would refuse a template for, checked before it is submitted. */
export function whatsappTemplateProblems(text: string): string[] {
  const problems: string[] = [];
  const t = text.trim();
  if (/^\{[a-z_]+\}/.test(t)) problems.push('starts_with_variable');
  if (/\{[a-z_]+\}$/.test(t)) problems.push('ends_with_variable');
  if (/\}\s*\{/.test(t)) problems.push('adjacent_variables');
  if ([...t].length > 1024) problems.push('too_long');
  return problems;
}
