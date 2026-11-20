// The product page's islands (phase-3-plan §3.5, design/storefront-redesign:
// Product, ProductPhone):
// - the variant picker updates price, saving, availability, SKU, image and
//   which other choices can still be bought, from data already in the page;
// - the gallery's thumbnails, counter and dots follow the photos;
// - quantity, Add to cart (a mini-cart panel on desktop, a note on phones)
//   and Buy now (adds, then checkout);
// - on phones a buy bar pins to the bottom once the in-page buttons scroll
//   away.
// Without JavaScript the page still shows everything, with the first
// available variant.

interface VariantData {
  id: string;
  values: string[];
  /** Poisha, for the add-to-cart event. */
  amount: number;
  price: string;
  compare: string | null;
  save: string | null;
  available: boolean;
  sku: string | null;
  /** Index of its image in the gallery, or -1. */
  image: number;
}

interface ShopData {
  locale: 'bn' | 'en';
  numerals: 'bengali' | 'latin';
  add: string;
  adding: string;
  soldOut: string;
  error: string;
  added: string;
  subtotal: { one: string; other: string };
  checkout: string;
  cart: string;
}

interface CartAnswer {
  itemCount: number;
  lines: {
    variantId: string;
    title: { bn?: string; en?: string };
    optionLabels: { bn?: string; en?: string }[];
    image: { files: { width: number; file: string }[] } | null;
    quantity: number;
    total: number;
  }[];
  totals: { subtotal: number };
}

const desktop = matchMedia('(min-width: 900px)');
const BANGLA = '০১২৩৪৫৬৭৮৯';

// ---- Gallery ----
const track = document.querySelector<HTMLElement>('[data-gallery-track]');
const thumbs = [...document.querySelectorAll<HTMLButtonElement>('[data-thumb]')];
const dots = [...document.querySelectorAll<HTMLElement>('[data-dot]')];
const counter = document.querySelector<HTMLElement>('[data-gallery-count]');

function show(index: number) {
  if (!track || index < 0) return;
  const slide = track.children[index] as HTMLElement | undefined;
  if (slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  mark(index);
}

function mark(index: number) {
  for (const [i, t] of thumbs.entries()) t.setAttribute('aria-current', String(i === index));
  for (const [i, d] of dots.entries()) d.classList.toggle('on', i === index);
  if (counter) {
    const [, total = ''] = (counter.textContent ?? '').split('/');
    const n = String(index + 1);
    const shown = /[০-৯]/.test(total) ? n.replace(/\d/g, (x) => BANGLA[Number(x)] ?? x) : n;
    counter.textContent = `${shown} /${total}`;
  }
}

for (const thumb of thumbs)
  thumb.addEventListener('click', () => show(Number(thumb.dataset.thumb)));
track?.addEventListener(
  'scroll',
  () => {
    mark(Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)));
  },
  { passive: true },
);

// ---- Variant picker ----
const picker = document.querySelector<HTMLFormElement>('[data-variant-picker]');
const variants = JSON.parse(
  document.getElementById('mm-variants')?.textContent ?? '[]',
) as VariantData[];
const buy = document.querySelector<HTMLElement>('[data-buy]');
const shop = JSON.parse(buy?.dataset.shop ?? '{}') as ShopData;
const addButton = document.querySelector<HTMLButtonElement>('[data-add-to-cart]');
const buyNow = document.querySelector<HTMLButtonElement>('[data-buy-now]');
const barAdd = document.querySelector<HTMLButtonElement>('[data-bar-add]');
const barBuy = document.querySelector<HTMLButtonElement>('[data-bar-buy]');
const barLabel = document.querySelector<HTMLElement>('[data-bar-label]');
const barPrice = document.querySelector<HTMLElement>('[data-bar-price]');

/** The chosen variant can be added only when it is available (phase-4-plan §3.16). */
function choose(variant: VariantData | undefined) {
  if (!buy) return;
  const ok = Boolean(variant?.available);
  buy.dataset.variant = ok && variant ? variant.id : '';
  for (const b of [addButton, barAdd]) if (b) b.disabled = !ok;
  if (addButton) addButton.textContent = ok ? shop.add : shop.soldOut;
  if (barLabel) barLabel.textContent = ok ? shop.add : shop.soldOut;
  for (const b of [buyNow, barBuy]) if (b) b.hidden = !ok;
  if (barPrice && variant) barPrice.textContent = variant.price;
}

if (picker) {
  const priceEl = document.querySelector<HTMLElement>('[data-price]');
  const compareEl = document.querySelector<HTMLElement>('[data-compare]');
  const compareValue = document.querySelector<HTMLElement>('[data-compare-value]');
  const saveEl = document.querySelector<HTMLElement>('[data-save]');
  const stock = document.querySelector<HTMLElement>('[data-stock]');
  const skuRow = document.querySelector<HTMLElement>('[data-sku-row]');
  const sku = document.querySelector<HTMLElement>('[data-sku]');
  const fieldsets = [...picker.querySelectorAll('fieldset')];

  const selected = () =>
    fieldsets.map((f) => f.querySelector<HTMLInputElement>('input:checked')?.value ?? '');

  picker.addEventListener('change', () => {
    const values = selected();
    const variant = variants.find(
      (v) => values.every((id) => v.values.includes(id)) && v.values.length === values.length,
    );
    choose(variant);
    // Each fieldset's chosen label, and the choices the others leave without stock.
    fieldsets.forEach((f, i) => {
      const chosen = f.querySelector<HTMLElement>('[data-chosen]');
      const checked = f.querySelector<HTMLInputElement>('input:checked');
      if (chosen) chosen.textContent = checked?.closest('label')?.textContent?.trim() ?? '';
      for (const input of f.querySelectorAll<HTMLInputElement>('input')) {
        const ok = variants.some(
          (v) =>
            v.available &&
            v.values.includes(input.value) &&
            values.every((id, j) => j === i || v.values.includes(id)),
        );
        input.closest('label')?.classList.toggle('gone', !ok);
      }
    });
    if (!stock || !priceEl) return;
    if (!variant) {
      stock.textContent = stock.dataset.none ?? '';
      stock.classList.add('out');
      return;
    }
    priceEl.textContent = variant.price;
    priceEl.classList.toggle('sale', variant.compare !== null);
    if (compareEl && compareValue) {
      compareEl.hidden = variant.compare === null;
      compareValue.textContent = variant.compare ?? '';
    }
    if (saveEl) {
      saveEl.hidden = variant.save === null;
      saveEl.textContent = variant.save ?? '';
    }
    stock.textContent = (variant.available ? stock.dataset.in : stock.dataset.out) ?? '';
    stock.classList.toggle('out', !variant.available);
    if (skuRow && sku) {
      skuRow.hidden = !variant.sku;
      sku.textContent = variant.sku ?? '';
    }
    show(variant.image);
  });
}

// ---- Quantity ----
const quantity = document.querySelector<HTMLInputElement>('[data-quantity]');
const qty = () => Math.min(99, Math.max(1, Math.floor(Number(quantity?.value) || 1)));
for (const step of document.querySelectorAll<HTMLButtonElement>('[data-step]')) {
  step.addEventListener('click', () => {
    if (quantity)
      quantity.value = String(Math.min(99, Math.max(1, qty() + Number(step.dataset.step))));
  });
}
quantity?.addEventListener('change', () => {
  quantity.value = String(qty());
});

// ---- Add to cart ----
const failed = document.querySelector<HTMLElement>('[data-add-error]');
const toast = document.querySelector<HTMLElement>('[data-added-toast]');
const toastText = document.querySelector<HTMLElement>('[data-toast-text]');
const mini = document.querySelector<HTMLDialogElement>('[data-mini-cart]');
const formatter = new Intl.NumberFormat(shop.locale === 'bn' ? 'bn-BD' : 'en-BD', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'narrowSymbol',
  numberingSystem: shop.numerals === 'bengali' ? 'beng' : 'latn',
});
const money = (poisha: number) => {
  const text = formatter.format(poisha / 100);
  return poisha % 100 === 0 ? text.replace(/[.,]?[0০]{2}(?=[^0-9০-৯]*$)/u, '') : text;
};
const digits = (n: number) =>
  shop.numerals === 'bengali' ? String(n).replace(/\d/g, (x) => BANGLA[Number(x)] ?? x) : String(n);
const pick = (v: { bn?: string; en?: string }) => v[shop.locale] ?? v.bn ?? v.en ?? '';
let toastTimer = 0;

function showAdded(cart: CartAnswer, variantId: string) {
  if (desktop.matches && mini) {
    const line = cart.lines.find((l) => l.variantId === variantId);
    const set = (sel: string, text: string) => {
      const el = mini.querySelector<HTMLElement>(sel);
      if (el) el.textContent = text;
    };
    set('[data-mini-name]', line ? pick(line.title) : (buy?.dataset.productName ?? ''));
    set('[data-mini-options]', line ? line.optionLabels.map(pick).filter(Boolean).join(', ') : '');
    set('[data-mini-total]', line ? money(line.total) : '');
    set(
      '[data-mini-count]',
      (cart.itemCount === 1 ? shop.subtotal.one : shop.subtotal.other).replace(
        '{count}',
        digits(cart.itemCount),
      ),
    );
    set('[data-mini-subtotal]', money(cart.totals.subtotal));
    const image = mini.querySelector<HTMLElement>('[data-mini-image]');
    const file = line?.image?.files.find((f) => f.width >= 160) ?? line?.image?.files.at(-1);
    if (image) {
      while (image.firstChild) image.removeChild(image.firstChild);
      if (file) {
        const img = document.createElement('img');
        img.src = `/media/${file.file}`;
        img.alt = '';
        image.appendChild(img);
      }
    }
    mini.showModal();
  } else if (toast && toastText) {
    toastText.textContent = shop.added.replace('{count}', digits(cart.itemCount));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  }
}

async function addToCart(then: 'stay' | 'checkout', button: HTMLButtonElement) {
  const variantId = buy?.dataset.variant;
  if (!variantId || button.disabled) return;
  const label = button.querySelector<HTMLElement>('[data-bar-label]') ?? button;
  const idle = label.textContent;
  button.disabled = true;
  label.textContent = shop.adding;
  if (failed) failed.textContent = '';
  try {
    const res = await fetch(`/api/cart/lines?locale=${shop.locale}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ variantId, quantity: qty() }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const cart = (await res.json()) as CartAnswer;
    for (const badge of document.querySelectorAll<HTMLElement>('[data-cart-count]')) {
      badge.textContent = badge.hasAttribute('data-bengali')
        ? String(cart.itemCount).replace(/\d/g, (x) => BANGLA[Number(x)] ?? x)
        : String(cart.itemCount);
      badge.hidden = cart.itemCount === 0;
    }
    const v = variants.find((x) => x.id === variantId);
    const tracker = (window as unknown as { mmTracker?: { addToCart: (i: unknown) => void } })
      .mmTracker;
    tracker?.addToCart({
      id: variantId,
      name: buy?.dataset.productName ?? '',
      price: v?.amount ?? 0,
      quantity: qty(),
    });
    if (then === 'checkout') {
      location.href = shop.checkout;
      return;
    }
    showAdded(cart, variantId);
  } catch {
    if (failed) failed.textContent = shop.error;
  } finally {
    button.disabled = !buy?.dataset.variant;
    label.textContent = idle;
  }
}

if (addButton) addButton.addEventListener('click', () => addToCart('stay', addButton));
if (buyNow) buyNow.addEventListener('click', () => addToCart('checkout', buyNow));
if (barAdd) barAdd.addEventListener('click', () => addToCart('stay', barAdd));
if (barBuy) barBuy.addEventListener('click', () => addToCart('checkout', barBuy));
for (const close of document.querySelectorAll('[data-mini-close]')) {
  close.addEventListener('click', () => mini?.close());
}
mini?.addEventListener('click', (e) => {
  if (e.target === mini) mini.close();
});

// ---- The phone's buy bar, once the in-page buttons are off screen ----
const bar = document.querySelector<HTMLElement>('[data-buy-bar]');
if (bar && buy) {
  // A scroll check, not an IntersectionObserver: one long scroll can jump
  // from below the buttons to above them with no crossing to report.
  let queued = false;
  const update = () => {
    queued = false;
    bar.hidden = buy.getBoundingClientRect().bottom > 0;
  };
  addEventListener(
    'scroll',
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

export {};
