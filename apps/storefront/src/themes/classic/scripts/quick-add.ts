// The quick-add picker (QuickAdd.astro): Choose options on a listing card
// opens a dialog with the product's options, filled from its page data. Each
// choice shows whether it can be bought with the others chosen; Add to cart
// adds the matching variant, then the card says "Added · View cart". If the
// data can't be had, the link goes to the product page as it would without
// this script. Text only, never HTML.

interface Variant {
  id: string;
  optionValueIds: string[];
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  imageMediaId: string | null;
}
interface Image {
  id: string;
  files: { width: number; file: string }[];
}
interface Product {
  id: string;
  slug: string;
  title: string;
  options: { id: string; name: string; values: { id: string; label: string }[] }[];
  variants: Variant[];
  media: Image[];
}

import { COLOUR_KEYS, swatch } from '../../../lib/swatches';

const dialog = document.querySelector<HTMLDialogElement>('[data-quick-add]');

const key = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

if (dialog) {
  const locale = dialog.dataset.locale === 'en' ? 'en' : 'bn';
  const bengali = dialog.dataset.numerals === 'bengali';
  const m = JSON.parse(dialog.dataset.messages ?? '{}') as Record<string, string>;
  const formatter = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'currency',
    currency: 'BDT',
    currencyDisplay: 'narrowSymbol',
    numberingSystem: bengali ? 'beng' : 'latn',
  });
  // Like the server's price(): whole taka show no decimals.
  const money = (poisha: number) => {
    const text = formatter.format(poisha / 100);
    return poisha % 100 === 0 ? text.replace(/[.,]?[0০]{2}(?=[^0-9০-৯]*$)/u, '') : text;
  };
  const q = <T extends Element>(sel: string) => dialog.querySelector<T>(sel);
  const title = q<HTMLElement>('[data-qa-title]');
  const priceEl = q<HTMLElement>('[data-qa-price]');
  const compareEl = q<HTMLElement>('[data-qa-compare]');
  const stockEl = q<HTMLElement>('[data-qa-stock]');
  const image = q<HTMLImageElement>('[data-qa-image]');
  const optionsEl = q<HTMLElement>('[data-qa-options]');
  const addButton = q<HTMLButtonElement>('[data-qa-add]');
  const errorEl = q<HTMLElement>('[data-qa-error]');
  const details = q<HTMLAnchorElement>('[data-qa-details]');

  let product: Product | null = null;
  let chosen: string[] = [];
  let trigger: HTMLAnchorElement | null = null;

  const matching = (ids: string[]) =>
    product?.variants.find((v) => ids.every((id) => v.optionValueIds.includes(id))) ?? null;
  // A value can be bought with the other choices kept.
  const possible = (option: number, value: string) =>
    product?.variants.some(
      (v) =>
        v.available &&
        v.optionValueIds.includes(value) &&
        chosen.every((id, i) => i === option || v.optionValueIds.includes(id)),
    ) ?? false;

  function draw() {
    if (!product || !optionsEl) return;
    const variant = matching(chosen);
    while (optionsEl.firstChild) optionsEl.removeChild(optionsEl.firstChild);
    product.options.forEach((option, i) => {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      const name = document.createElement('strong');
      name.textContent = `${option.name}: `;
      legend.appendChild(name);
      legend.appendChild(
        document.createTextNode(option.values.find((v) => v.id === chosen[i])?.label ?? ''),
      );
      fieldset.appendChild(legend);
      const colour = COLOUR_KEYS.has(key(option.name));
      const row = document.createElement('div');
      row.className = colour ? 'qa-swatches' : 'qa-choices';
      for (const value of option.values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(chosen[i] === value.id));
        const ok = possible(i, value.id);
        if (!ok) button.classList.add('gone');
        const dot = colour ? swatch(key(value.label)) : null;
        if (dot) {
          button.className = `qa-swatch${ok ? '' : ' gone'}`;
          button.setAttribute('aria-label', value.label);
          const span = document.createElement('span');
          span.style.background = dot;
          button.appendChild(span);
        } else {
          button.textContent = value.label;
        }
        button.addEventListener('click', () => {
          chosen[i] = value.id;
          draw();
          optionsEl
            .querySelectorAll<HTMLButtonElement>('fieldset')
            [i]?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
            ?.focus();
        });
        row.appendChild(button);
      }
      fieldset.appendChild(row);
      optionsEl.appendChild(fieldset);
    });
    const price = variant?.price ?? Math.min(...product.variants.map((v) => v.price));
    if (priceEl) {
      priceEl.textContent = money(price);
      priceEl.className = variant?.compareAtPrice && variant.compareAtPrice > price ? 'sale' : '';
    }
    if (compareEl) {
      const was =
        variant?.compareAtPrice && variant.compareAtPrice > price ? variant.compareAtPrice : null;
      compareEl.hidden = was === null;
      compareEl.textContent = was === null ? '' : money(was);
    }
    if (stockEl) {
      stockEl.textContent = !variant
        ? (m.unavailable ?? '')
        : variant.available
          ? (m.inStock ?? '')
          : (m.soldOut ?? '');
      stockEl.classList.toggle('out', !variant?.available);
    }
    if (addButton) addButton.disabled = !variant?.available;
    const media = variant?.imageMediaId
      ? product.media.find((x) => x.id === variant.imageMediaId)
      : product.media[0];
    const file = media?.files.find((f) => f.width >= 200) ?? media?.files.at(-1);
    if (image) {
      image.hidden = !file;
      if (file) image.src = `/media/${file.file}`;
    }
  }

  async function open(link: HTMLAnchorElement) {
    trigger = link;
    const slug = link.dataset.quick ?? '';
    const res = await fetch(`/api/pages/products/${encodeURIComponent(slug)}?locale=${locale}`, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { page?: { product?: Product } };
    if (!body.page?.product) throw new Error('no product');
    product = body.page.product;
    const start = product.variants.find((v) => v.available) ?? product.variants[0];
    chosen = product.options.map(
      (o) => start?.optionValueIds.find((id) => o.values.some((v) => v.id === id)) ?? '',
    );
    if (title) title.textContent = product.title;
    if (details) details.href = link.href;
    if (errorEl) errorEl.textContent = '';
    if (addButton) addButton.textContent = m.add ?? '';
    draw();
    dialog?.showModal();
  }

  document.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-quick]');
    if (!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    open(link).catch(() => {
      location.href = link.href;
    });
  });
  q('[data-qa-close]')?.addEventListener('click', () => dialog.close());
  // A click on the backdrop closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  addButton?.addEventListener('click', async () => {
    const variant = matching(chosen);
    if (!product || !variant?.available) return;
    addButton.disabled = true;
    addButton.textContent = m.adding ?? '';
    if (errorEl) errorEl.textContent = '';
    try {
      const res = await fetch(`/api/cart/lines?locale=${locale}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const cart = (await res.json()) as { itemCount: number };
      for (const badge of document.querySelectorAll<HTMLElement>('[data-cart-count]')) {
        const n = String(cart.itemCount);
        badge.textContent = badge.hasAttribute('data-bengali')
          ? n.replace(/\d/g, (x) => '০১২৩৪৫৬৭৮৯'[Number(x)] ?? x)
          : n;
        badge.hidden = cart.itemCount === 0;
      }
      (
        window as unknown as { mmTracker?: { addToCart: (i: unknown) => void } }
      ).mmTracker?.addToCart({
        id: variant.id,
        name: product.title,
        price: variant.price,
        quantity: 1,
      });
      // The card says it's in the cart, and its link goes there.
      if (trigger) {
        trigger.classList.add('card-added');
        trigger.href = m.cart ?? trigger.href;
        trigger.removeAttribute('data-quick');
        trigger.removeAttribute('aria-haspopup');
        trigger.setAttribute('aria-label', m.added ?? '');
        const label = trigger.querySelector('.card-label');
        if (label) label.textContent = m.added ?? '';
      }
      dialog.close();
    } catch {
      if (errorEl) errorEl.textContent = m.error ?? '';
      addButton.disabled = false;
    } finally {
      addButton.textContent = m.add ?? '';
    }
  });
}
