// Chat shortcuts (phase-9-plan §3.1.2, §3.1.3): the text staff send into a
// WhatsApp or Messenger chat for an order, and what a pasted chat tells the
// new order screen. No Meta API: the text goes through wa.me, or the
// clipboard where a link can't carry it.
import { toBanglaDigits, toLatinDigits } from '../digits';
import type { Locale } from '../money';
import { normalizePhone } from '../phone';

/** What staff can send for an order. */
export const CHAT_MESSAGE_KINDS = ['summary', 'payment', 'tracking'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

export interface ChatOrder {
  storeName: string;
  orderNumber: string;
  customerName: string;
  lines: readonly { title: string; options: readonly string[]; quantity: number; total: number }[];
  /** Poisha, each. Discount and delivery are shown only when not zero. */
  discount: number;
  deliveryFee: number;
  total: number;
  /** What the shopper still owes. */
  due: number;
  trackUrl: string;
  /** The payment link, for `payment`. */
  payUrl?: string;
}

const WORDS = {
  en: {
    hello: (name: string) => (name ? `Hello ${name},` : 'Hello,'),
    summary: (n: string, store: string) => `here is your order ${n} from ${store}:`,
    payment: (n: string, store: string) => `your order ${n} from ${store} is ready to pay online.`,
    tracking: (n: string, store: string) => `you can follow your order ${n} from ${store} here:`,
    delivery: 'Delivery',
    discount: 'Discount',
    total: 'Total',
    due: 'To pay',
    pay: 'Pay here',
    track: 'Track your order',
    trackHint: 'Use your order number and phone number.',
  },
  bn: {
    hello: (name: string) => (name ? `${name}, আসসালামু আলাইকুম।` : 'আসসালামু আলাইকুম।'),
    summary: (n: string, store: string) => `${store} থেকে আপনার অর্ডার ${n}:`,
    payment: (n: string, store: string) => `${store} থেকে আপনার অর্ডার ${n} অনলাইনে পরিশোধের জন্য তৈরি।`,
    tracking: (n: string, store: string) => `${store} থেকে আপনার অর্ডার ${n} এখানে দেখুন:`,
    delivery: 'ডেলিভারি',
    discount: 'ছাড়',
    total: 'মোট',
    due: 'পরিশোধ করতে হবে',
    pay: 'এখানে পরিশোধ করুন',
    track: 'অর্ডার ট্র্যাক করুন',
    trackHint: 'অর্ডার নম্বর ও ফোন নম্বর দিয়ে দেখুন।',
  },
} as const;

/**
 * The text for one kind, in the order's language. `taka` formats poisha as
 * the notifications do, so a chat and an SMS show the same amounts.
 */
export function chatOrderText(
  kind: ChatMessageKind,
  order: ChatOrder,
  locale: Locale,
  taka: (poisha: number) => string,
): string {
  const w = WORDS[locale];
  const digits = (n: number) => (locale === 'bn' ? toBanglaDigits(String(n)) : String(n));
  const out: string[] = [
    `${w.hello(order.customerName)} ${w[kind](order.orderNumber, order.storeName)}`,
  ];
  if (kind === 'summary') {
    out.push('');
    for (const l of order.lines) {
      const options = l.options.length ? ` (${l.options.join(', ')})` : '';
      out.push(`• ${l.title}${options} × ${digits(l.quantity)}: ${taka(l.total)}`);
    }
    if (order.discount > 0) out.push(`${w.discount}: −${taka(order.discount)}`);
    if (order.deliveryFee > 0) out.push(`${w.delivery}: ${taka(order.deliveryFee)}`);
    out.push(`${w.total}: ${taka(order.total)}`);
    if (order.due > 0 && order.due !== order.total) out.push(`${w.due}: ${taka(order.due)}`);
  }
  if (kind === 'payment' && order.payUrl) {
    out.push('', `${w.due}: ${taka(order.due)}`, `${w.pay}: ${order.payUrl}`);
  }
  out.push('', `${w.track}: ${order.trackUrl}`);
  if (kind !== 'payment') out.push(w.trackHint);
  return out.join('\n');
}

export interface ParsedChat {
  /** Bangladeshi mobiles found, E.164, in order of first appearance. */
  phones: string[];
  /** Links to the store's products: the slug, and the variant when the link names one. */
  products: { slug: string; variantId: string | null; quantity: number }[];
  /** Order numbers written as "#1042", without the prefix. */
  orderNumbers: number[];
}

const PHONE = /(?:\+?88)?[\s-]*0[\s-]*1[3-9](?:[\s-]*\d){8}(?!\d)/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const ORDER_NUMBER = /#\s?(\d{3,10})(?!\d)/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** "× 2" or "x2" after a link, as the cart's WhatsApp message writes it. */
const QUANTITY_AFTER = /^\s*[×x]\s*(\d{1,3})/;

/**
 * What a chat tells the new order screen (§3.1.2). It never guesses: names
 * and addresses stay in the text for staff to copy.
 */
export function parseChatText(input: string): ParsedChat {
  const text = toLatinDigits(input.normalize('NFC')).slice(0, 5000);
  const phones: string[] = [];
  for (const m of text.matchAll(PHONE)) {
    const phone = normalizePhone(m[0].replace(/[\s-]/g, ''));
    if (phone && !phones.includes(phone)) phones.push(phone);
  }
  const products: ParsedChat['products'] = [];
  for (const m of text.matchAll(URL_RE)) {
    let url: URL;
    try {
      url = new URL(m[0]);
    } catch {
      continue;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const at = parts.indexOf('products');
    const segment = at >= 0 ? parts[at + 1] : undefined;
    if (!segment || parts.length > at + 2) continue;
    let slug: string;
    try {
      slug = decodeURIComponent(segment).normalize('NFC').toLowerCase();
    } catch {
      continue;
    }
    const v = url.searchParams.get('v');
    const after = QUANTITY_AFTER.exec(text.slice((m.index ?? 0) + m[0].length));
    const quantity = Math.max(1, Math.min(999, Number(after?.[1] ?? 1)));
    const variantId = v && UUID.test(v) ? v.toLowerCase() : null;
    const same = products.find((p) => p.slug === slug && p.variantId === variantId);
    if (same) same.quantity += quantity;
    else products.push({ slug, variantId, quantity });
  }
  const orderNumbers: number[] = [];
  for (const m of text.matchAll(ORDER_NUMBER)) {
    const n = Number(m[1]);
    if (!orderNumbers.includes(n)) orderNumbers.push(n);
  }
  return { phones, products: products.slice(0, 50), orderNumbers: orderNumbers.slice(0, 5) };
}
