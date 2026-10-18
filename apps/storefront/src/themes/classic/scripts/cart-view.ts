// The cart's lines and totals as DOM (phase-4-plan §3.16), shared by the
// cart page and checkout's summary. Text only, never HTML.
import { add, el, imageUrl, type Localized, money, pick, t } from './shop';

export interface CartLine {
  variantId: string;
  title: Localized;
  slugs: Localized;
  optionLabels: Localized[];
  image: { files: { width: number; file: string }[] } | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  total: number;
  maxQuantity: number | null;
  problem: 'unavailable' | 'insufficient_stock' | 'over_limit' | null;
}

export interface Cart {
  itemCount: number;
  areaId: number | null;
  ready: boolean;
  maxQuantityPerLine: number;
  lines: CartLine[];
  zone: { name: Localized; estimate: Localized } | null;
  deliveryFrom: number | null;
  totals: {
    subtotal: number;
    discountTotal: number;
    deliveryFee: number;
    deliveryDiscount: number;
    vatTotal: number;
    vatIncluded: boolean;
    rounding: number;
    total: number;
  };
  promotions: { title: Localized; amount: number; target: string; code?: string }[];
  code: { code: string; status: string } | null;
  freeDelivery: { threshold: number; remaining: number } | null;
}

export const lineName = (l: CartLine) =>
  [pick(l.title), ...l.optionLabels.map(pick).filter(Boolean)].join(' – ');

export function problemText(l: CartLine): string | null {
  if (l.problem === 'unavailable') return t('cart.unavailable');
  if (l.problem === 'insufficient_stock')
    return t('cart.insufficient', { count: l.maxQuantity ?? 0 });
  if (l.problem === 'over_limit') return t('cart.overLimit', { count: l.maxQuantity ?? 0 });
  return null;
}

export function lineImage(l: CartLine): HTMLElement {
  const src = imageUrl(l.image, 160);
  return src
    ? el('img', { src, alt: '', width: '72', height: '72', loading: 'lazy', class: 'line-image' })
    : el('span', { class: 'line-image' });
}

const row = (label: string, value: string, cls?: string) =>
  el(
    'div',
    { class: cls ? `row ${cls}` : 'row' },
    el('dt', { text: label }),
    el('dd', { text: value }),
  );

/** The totals: subtotal, each offer, delivery, VAT and the total. */
export function totals(cart: Cart, options: { deliveryHint?: string } = {}): HTMLElement {
  const tt = cart.totals;
  const list = el('dl', { class: 'totals' }, row(t('cart.subtotal'), money(tt.subtotal)));
  for (const p of cart.promotions) {
    add(list, row(pick(p.title) || t('cart.discount'), `−${money(p.amount)}`, 'discount'));
  }
  const fee = tt.deliveryFee - tt.deliveryDiscount;
  const delivery = cart.zone
    ? fee === 0 && tt.deliveryFee > 0
      ? t('cart.free')
      : money(fee)
    : cart.deliveryFrom !== null
      ? t('cart.deliveryFrom', { price: money(cart.deliveryFrom) })
      : (options.deliveryHint ?? '');
  add(list, row(t('cart.delivery'), delivery));
  if (tt.vatTotal > 0 && !tt.vatIncluded) add(list, row(t('cart.vat'), money(tt.vatTotal)));
  if (tt.rounding !== 0) add(list, row(t('cart.rounding'), money(tt.rounding)));
  add(list, row(t('cart.total'), money(tt.total), 'total'));
  const box = el('div', {}, list);
  if (tt.vatTotal > 0 && tt.vatIncluded) {
    add(
      box,
      el('p', {
        class: 'muted small',
        text: t('cart.vatIncluded', { amount: money(tt.vatTotal) }),
      }),
    );
  }
  if (cart.freeDelivery) {
    const done = Math.max(0, cart.freeDelivery.threshold - cart.freeDelivery.remaining);
    const meter = el('meter', {
      min: '0',
      max: String(cart.freeDelivery.threshold),
      value: String(done),
      'aria-hidden': 'true',
    });
    box.insertBefore(
      el(
        'div',
        { class: 'free-delivery' },
        el('p', { text: t('cart.freeDelivery', { amount: money(cart.freeDelivery.remaining) }) }),
        meter,
      ),
      box.firstChild,
    );
  }
  return box;
}
