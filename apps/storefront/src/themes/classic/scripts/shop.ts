// What the shopper pages' scripts share (phase-4-plan §3.16, §8): calls to
// /api/* on the store's own host, the page's messages and digits (each page
// carries the strings its scripts need, so no message file is downloaded),
// prices formatted like the server's, and small DOM helpers that only ever
// set text, never HTML. Plain TypeScript, no framework.

export interface ShopConfig {
  locale: 'bn' | 'en';
  numerals: 'bengali' | 'latin';
  /** The language prefix for links ('' or '/en'). */
  prefix: string;
  msg: Record<string, string>;
  links: {
    home: string;
    cart: string;
    checkout: string;
    thanks: string;
    track: string;
    account: string;
    terms: string | null;
  };
  shop: { accounts: boolean; termsCheckbox: boolean; email: 'optional' | 'required' | 'hidden' };
  /** The store's WhatsApp number (E.164), when its chat buttons are on. */
  whatsapp?: string | null;
  geo?: string;
}

export type Localized = { bn?: string; en?: string };

export class ShopError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function config(): ShopConfig {
  const el = document.getElementById('mm-shop');
  return JSON.parse(el?.textContent ?? '{}') as ShopConfig;
}

const cfg = config();

/** A message with {placeholders} filled; digits in the store's numerals. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const text = cfg.msg[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? digits(String(v)) : v;
  });
}

const BANGLA = '০১২৩৪৫৬৭৮৯';
export const digits = (s: string) =>
  cfg.numerals === 'bengali' ? s.replace(/\d/g, (d) => BANGLA[Number(d)] ?? d) : s;

const formatter = new Intl.NumberFormat(cfg.locale === 'bn' ? 'bn-BD' : 'en-BD', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'narrowSymbol',
  numberingSystem: cfg.numerals === 'bengali' ? 'beng' : 'latn',
});

/** "৳1,250" or "৳1,250.50", like the server's price() (whole taka show no decimals). */
export function money(amount: number): string {
  const whole = Math.trunc(Math.abs(amount) / 100);
  const fraction = Math.abs(amount) % 100;
  const text = formatter.format(
    `${amount < 0 ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}` as unknown as number,
  );
  return fraction === 0 ? text.replace(/[.,]?[0০]{2}(?=[^0-9০-৯]*$)/u, '') : text;
}

export const pick = (v: Localized | null | undefined): string =>
  (v?.[cfg.locale] ?? v?.bn ?? v?.en ?? '').trim();

export const path = (p: string) => `${cfg.prefix}${p}` || '/';

/** A JSON call to /api/* ; problems come back as ShopError with their code. */
export async function api<T>(
  route: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const sep = route.includes('?') ? '&' : '?';
  const res = await fetch(`/api${route}${sep}locale=${cfg.locale}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    credentials: 'same-origin',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ShopError(res.status, String(body.code ?? `http_${res.status}`), body);
  return body as T;
}

/** An element with text and attributes; children are nodes or text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  add(node, ...children);
  return node;
}

/**
 * Appends children. Not Element.append: these scripts are type-checked with
 * Workers' types too, whose HTMLRewriter Element has its own append.
 */
export function add(parent: Node, ...children: (Node | string | null | undefined | false)[]): void {
  for (const c of children) {
    if (c) parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** Replaces a node's children. */
export function fill(
  parent: Node,
  ...children: (Node | string | null | undefined | false)[]
): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  add(parent, ...children);
}

/** The header's cart count, from the API's answer (the cookie keeps it for the next page). */
export function setCount(n: number) {
  for (const badge of document.querySelectorAll<HTMLElement>('[data-cart-count]')) {
    badge.textContent = digits(String(n));
    badge.hidden = n === 0;
  }
}

/** An image of the cart's or order's lines: the smallest file at least `width` wide. */
export function imageUrl(image: { files: { width: number; file: string }[] } | null, width = 160) {
  const file = image?.files.find((f) => f.width >= width) ?? image?.files.at(-1);
  return file ? `/media/${file.file}` : null;
}

/** The tag loader, once the shopper has agreed (consent.ts sets it). */
export const tracker = () =>
  (window as unknown as { mmTracker?: import('./events').Tracker }).mmTracker ?? null;
