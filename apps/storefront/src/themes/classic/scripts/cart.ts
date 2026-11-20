// The cart page (phase-4-plan §3.16): lines with quantity steppers, the
// coupon field, applied offers, free-delivery progress and totals. Every
// change goes to /api/cart and redraws from its answer.
import { type Cart, type CartLine, lineImage, lineName, problemText, totals } from './cart-view';
import { add, api, config, el, fill, money, pick, ShopError, setCount, t } from './shop';

const root = document.querySelector<HTMLElement>('[data-cart]');
const { links, whatsapp } = config();
const prefix = config().prefix;
let busy = false;

function productHref(l: CartLine): string | null {
  const slug = pick(l.slugs);
  return slug ? `${prefix}/products/${encodeURIComponent(slug)}` : null;
}

/**
 * The cart as a WhatsApp message to the store (phase-9-plan §3.1.3): each
 * line's link names its variant and quantity, which the admin's "Paste a
 * chat" reads back into a new order.
 */
function chatOrder(cart: Cart): string {
  const lines = cart.lines.map((l) => {
    const path = productHref(l);
    const link = path ? ` ${location.origin}${path}?v=${l.variantId}` : '';
    return `• ${lineName(l)}:${link} × ${l.quantity}`;
  });
  return [
    t('cart.orderWhatsappIntro'),
    ...lines,
    `${t('cart.total')}: ${money(cart.totals.total)}`,
  ].join('\n');
}

async function change(run: () => Promise<Cart>, status?: HTMLElement) {
  if (busy) return;
  busy = true;
  root?.setAttribute('aria-busy', 'true');
  try {
    render(await run());
  } catch (e) {
    const code = e instanceof ShopError ? e.code : '';
    const message =
      code === 'insufficient_stock'
        ? t('cart.insufficient', {
            count:
              Number(
                (e as ShopError).body.lines &&
                  ((e as ShopError).body.lines as { available: number }[])[0]?.available,
              ) || 0,
          })
        : code === 'limit_exceeded'
          ? t('cart.overLimit', { count: Number((e as ShopError).body.maxQuantity) || 0 })
          : code === 'promotion_unavailable'
            ? t('cart.code.not_found')
            : t('cart.error');
    if (status) status.textContent = message;
    else alert(message);
  } finally {
    busy = false;
    root?.removeAttribute('aria-busy');
  }
}

const setQuantity = (l: CartLine, quantity: number, status: HTMLElement) =>
  change(
    () => api<Cart>(`/cart/lines/${l.variantId}`, { method: 'PATCH', body: { quantity } }),
    status,
  );

const SVG = 'http://www.w3.org/2000/svg';
/** A small line icon (the trash can, the check, the truck, the back chevron). */
function icon(d: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, String(v));
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
const ICON = {
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12l5 5 9-10',
  truck:
    'M2 7h11v9H2zM13 10h4l3 3v3h-7zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  back: 'M15 6l-6 6 6 6',
};

function lineView(l: CartLine): HTMLElement {
  const name = lineName(l);
  const status = el('p', { class: 'line-problem', role: 'status' });
  const problem = problemText(l);
  if (problem) status.textContent = problem;
  const href = productHref(l);
  const max = l.maxQuantity ?? 999;
  const input = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '1',
    max: String(Math.max(1, max)),
    value: String(l.quantity),
    'aria-label': t('cart.quantity', { item: name }),
  });
  input.addEventListener('change', () => {
    const q = Math.max(0, Math.min(999, Math.round(Number(input.value) || 0)));
    void setQuantity(l, q, status);
  });
  const minus = el('button', {
    type: 'button',
    class: 'step',
    'aria-label': t('cart.decrease', { item: name }),
    text: '−',
  });
  minus.addEventListener('click', () => void setQuantity(l, l.quantity - 1, status));
  const plus = el('button', {
    type: 'button',
    class: 'step',
    'aria-label': t('cart.increase', { item: name }),
    text: '+',
    disabled: l.quantity >= max,
  });
  plus.addEventListener('click', () => void setQuantity(l, l.quantity + 1, status));
  const remove = el(
    'button',
    { type: 'button', class: 'line-remove', 'aria-label': t('cart.remove', { item: name }) },
    icon(ICON.trash, 16),
    el('span', { text: t('cart.removeShort') }),
  );
  remove.addEventListener('click', () =>
    change(() => api<Cart>(`/cart/lines/${l.variantId}`, { method: 'DELETE' }), status),
  );
  const each = el('p', { class: 'line-each' }, t('cart.each', { price: money(l.unitPrice) }));
  if (l.compareAtPrice && l.compareAtPrice > l.unitPrice) {
    add(
      each,
      ' ',
      el('s', {
        'aria-label': `${t('product.regular')}: ${money(l.compareAtPrice)}`,
        text: money(l.compareAtPrice),
      }),
    );
  }
  const image = lineImage(l);
  return el(
    'li',
    { class: l.problem ? 'line has-problem' : 'line' },
    href
      ? el('a', { href, tabindex: '-1', 'aria-hidden': 'true', class: 'line-media' }, image)
      : image,
    el(
      'div',
      { class: 'line-body' },
      href
        ? el('a', { href, class: 'line-title', text: pick(l.title) })
        : el('span', { class: 'line-title', text: pick(l.title) }),
      l.optionLabels.length
        ? el('p', { class: 'line-options', text: l.optionLabels.map(pick).join(' · ') })
        : null,
      each,
      status,
    ),
    remove,
    el('div', { class: 'stepper' }, minus, input, plus),
    el('p', { class: 'line-total', text: money(l.total) }),
  );
}

function codeForm(cart: Cart): HTMLElement {
  const status = el('p', { class: 'small', role: 'status' });
  if (cart.code) {
    const s = cart.code.status;
    status.textContent =
      s === 'applied'
        ? t('cart.codeApplied', { code: cart.code.code })
        : t(
            `cart.code.${['not_found', 'inactive', 'used_up', 'min_subtotal', 'better_offer'].includes(s) ? s : 'other'}`,
          );
    const remove = el('button', { type: 'button', class: 'link', text: t('cart.removeCode') });
    remove.addEventListener('click', () =>
      change(() => api<Cart>('/cart/code', { method: 'DELETE' }), status),
    );
    return el(
      'div',
      { class: 'coupon' },
      el('p', { class: 'code-chip', text: cart.code.code }),
      remove,
      status,
    );
  }
  const input = el('input', {
    id: 'coupon',
    name: 'code',
    maxlength: '32',
    autocomplete: 'off',
    autocapitalize: 'characters',
  });
  const form = el(
    'form',
    { class: 'coupon' },
    el('label', { for: 'coupon', text: t('cart.code') }),
    el(
      'div',
      { class: 'inline' },
      input,
      el('button', { type: 'submit', class: 'button secondary', text: t('cart.apply') }),
    ),
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (code) void change(() => api<Cart>('/cart/code', { method: 'PUT', body: { code } }), status);
  });
  return form;
}

const facts = config().facts ?? null;

/** "Inside Dhaka: ৳60 (1–2 days), Outside Dhaka: ৳120 (3–5 days)". */
const zonesText = () =>
  (facts?.zones ?? [])
    .map((z) => `${z.name}: ${money(z.fee)}${z.estimate ? ` (${z.estimate})` : ''}`)
    .join(', ');

function trustList(): HTMLElement | null {
  const items = [
    facts?.cod ? t('trust.cod') : null,
    facts?.returnDays ? t('trust.returns', { count: facts.returnDays }) : null,
    facts?.online ? t('trust.online') : null,
  ].filter((x): x is string => Boolean(x));
  if (!items.length) return null;
  return el(
    'ul',
    { class: 'trust', role: 'list' },
    ...items.map((text) => el('li', {}, icon(ICON.check, 16), el('span', { text }))),
  );
}

const heading = document.querySelector<HTMLElement>('[data-cart-items]');

function render(cart: Cart) {
  if (!root) return;
  setCount(cart.itemCount);
  if (heading) {
    heading.textContent = cart.itemCount ? t('cart.items', { count: cart.itemCount }) : '';
  }
  if (!cart.lines.length) {
    fill(
      root,
      el(
        'div',
        { class: 'cart-empty' },
        el('h2', { text: t('cart.empty') }),
        el('p', { class: 'muted', text: t('cart.emptyText') }),
        el('p', {}, el('a', { class: 'button', href: links.home, text: t('cart.start') })),
      ),
    );
    return;
  }
  const checkout = cart.ready
    ? el('a', {
        class: 'button wide summary-checkout',
        href: links.checkout,
        text: t('cart.checkout'),
      })
    : el('p', { class: 'line-problem', role: 'status', text: t('cart.fix') });
  const chat = whatsapp
    ? el('a', {
        class: 'button outline-primary wide',
        href: `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(chatOrder(cart))}`,
        target: '_blank',
        rel: 'noopener',
        text: t('cart.orderWhatsapp'),
      })
    : null;
  const promo = el(
    'details',
    { class: 'promo', open: Boolean(cart.code) },
    el('summary', { text: t('cart.promo') }),
    codeForm(cart),
  );
  const note = zonesText()
    ? el(
        'p',
        { class: 'delivery-note' },
        icon(ICON.truck, 20),
        el('span', { text: t('cart.deliveryNote', { zones: zonesText() }) }),
      )
    : null;
  // The phone's pinned bar: the subtotal and Checkout.
  const bar = cart.ready
    ? el(
        'div',
        { class: 'checkout-bar' },
        el(
          'p',
          {},
          el('span', { text: t('cart.subtotal') }),
          el('strong', { text: money(cart.totals.subtotal) }),
        ),
        el('a', { class: 'button', href: links.checkout, text: t('cart.checkoutShort') }),
      )
    : null;
  fill(
    root,
    el(
      'div',
      { class: 'shop-grid cart-grid' },
      el(
        'div',
        { class: 'cart-main' },
        el('ul', { class: 'lines', role: 'list' }, ...cart.lines.map(lineView)),
        el(
          'a',
          { class: 'back-link', href: links.home },
          icon(ICON.back, 18),
          el('span', { text: t('cart.continue') }),
        ),
      ),
      el(
        'aside',
        { class: 'summary', 'aria-labelledby': 'summary-title' },
        el('h2', { id: 'summary-title', text: t('cart.summary') }),
        totals(cart, {
          deliveryHint: t('cart.atCheckout'),
          subtotalLabel: t('cart.subtotalCount', { count: cart.itemCount }),
          totalOnlyWithZone: true,
        }),
        note,
        promo,
        checkout,
        chat,
        trustList(),
      ),
    ),
    bar,
  );
}

void api<Cart>('/cart')
  .then(render)
  .catch(() => {
    if (root) fill(root, el('p', { text: t('cart.error') }));
  });
