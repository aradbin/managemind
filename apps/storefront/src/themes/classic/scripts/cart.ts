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
  const remove = el('button', {
    type: 'button',
    class: 'link',
    text: t('cart.remove', { item: '' }).trim() || '×',
    'aria-label': t('cart.remove', { item: name }),
  });
  remove.addEventListener('click', () =>
    change(() => api<Cart>(`/cart/lines/${l.variantId}`, { method: 'DELETE' }), status),
  );
  const price = el('p', { class: 'muted' }, money(l.unitPrice));
  if (l.compareAtPrice && l.compareAtPrice > l.unitPrice) {
    add(
      price,
      ' ',
      el('s', {
        'aria-label': `${t('product.regular')}: ${money(l.compareAtPrice)}`,
        text: money(l.compareAtPrice),
      }),
    );
  }
  return el(
    'li',
    { class: l.problem ? 'line has-problem' : 'line' },
    lineImage(l),
    el(
      'div',
      { class: 'line-body' },
      href ? el('a', { href, text: pick(l.title) }) : el('span', { text: pick(l.title) }),
      l.optionLabels.length
        ? el('p', { class: 'muted small', text: l.optionLabels.map(pick).join(' / ') })
        : null,
      price,
      el('div', { class: 'stepper' }, minus, input, plus, remove),
      status,
    ),
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

function render(cart: Cart) {
  if (!root) return;
  setCount(cart.itemCount);
  if (!cart.lines.length) {
    fill(
      root,
      el('p', { text: t('cart.empty') }),
      el('p', {}, el('a', { class: 'button', href: links.home, text: t('cart.continue') })),
    );
    return;
  }
  const checkout = cart.ready
    ? el('a', { class: 'button wide', href: links.checkout, text: t('cart.checkout') })
    : el('p', { class: 'line-problem', role: 'status', text: t('cart.fix') });
  const chat = whatsapp
    ? el('a', {
        class: 'button secondary wide',
        href: `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(chatOrder(cart))}`,
        target: '_blank',
        rel: 'noopener',
        text: t('cart.orderWhatsapp'),
      })
    : null;
  fill(
    root,
    el(
      'div',
      { class: 'shop-grid' },
      el('ul', { class: 'lines', role: 'list' }, ...cart.lines.map(lineView)),
      el('aside', { class: 'summary' }, codeForm(cart), totals(cart), checkout, chat),
    ),
  );
}

void api<Cart>('/cart')
  .then(render)
  .catch(() => {
    if (root) fill(root, el('p', { text: t('cart.error') }));
  });
