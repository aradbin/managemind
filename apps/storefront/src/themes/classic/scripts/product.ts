// The product page's islands (phase-3-plan §3.5): the variant picker updates
// price, availability and image from data already in the page, with no API
// call; the gallery's thumbnails scroll the main images. Without JavaScript
// the page still shows everything, with the first available variant.

interface VariantData {
  id: string;
  values: string[];
  /** Poisha, for the add-to-cart event. */
  amount: number;
  price: string;
  compare: string | null;
  available: boolean;
  sku: string | null;
  /** Index of its image in the gallery, or -1. */
  image: number;
}

const track = document.querySelector<HTMLElement>('[data-gallery-track]');
const thumbs = [...document.querySelectorAll<HTMLButtonElement>('[data-thumb]')];

function show(index: number) {
  if (!track || index < 0) return;
  const slide = track.children[index] as HTMLElement | undefined;
  if (slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  mark(index);
}

function mark(index: number) {
  for (const [i, t] of thumbs.entries()) t.setAttribute('aria-current', String(i === index));
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

const picker = document.querySelector<HTMLFormElement>('[data-variant-picker]');
const data = document.getElementById('mm-variants');
const variants = JSON.parse(data?.textContent ?? '[]') as VariantData[];
const buy = document.querySelector<HTMLElement>('[data-buy]');
const addButton = document.querySelector<HTMLButtonElement>('[data-add-to-cart]');

/** The chosen variant can be added only when it is available (phase-4-plan §3.16). */
function choose(variant: VariantData | undefined) {
  if (!buy || !addButton) return;
  buy.dataset.variant = variant?.available ? variant.id : '';
  addButton.disabled = !variant?.available;
  addButton.textContent = (variant?.available ? buy.dataset.add : buy.dataset.soldOut) ?? '';
}

if (buy && addButton) {
  const added = buy.querySelector<HTMLElement>('[data-added]');
  const failed = buy.querySelector<HTMLElement>('[data-add-error]');
  addButton.addEventListener('click', async () => {
    const variantId = buy.dataset.variant;
    if (!variantId) return;
    addButton.disabled = true;
    addButton.textContent = buy.dataset.adding ?? '';
    if (failed) failed.textContent = '';
    try {
      const res = await fetch(`/api/cart/lines?locale=${buy.dataset.locale}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ variantId, quantity: 1 }),
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
      if (added) added.hidden = false;
      const v = variants.find((x) => x.id === variantId);
      const tracker = (window as unknown as { mmTracker?: { addToCart: (i: unknown) => void } })
        .mmTracker;
      tracker?.addToCart({
        id: variantId,
        name: buy.dataset.productName ?? '',
        price: v?.amount ?? 0,
        quantity: 1,
      });
    } catch {
      if (added) added.hidden = true;
      if (failed) failed.textContent = failed.dataset.message ?? '';
    } finally {
      addButton.disabled = !buy.dataset.variant;
      addButton.textContent = (buy.dataset.variant ? buy.dataset.add : buy.dataset.soldOut) ?? '';
    }
  });
}

if (picker && data) {
  const priceEl = document.querySelector<HTMLElement>('[data-price]');
  const compareEl = document.querySelector<HTMLElement>('[data-compare]');
  const compareValue = document.querySelector<HTMLElement>('[data-compare-value]');
  const stock = document.querySelector<HTMLElement>('[data-stock]');
  const skuRow = document.querySelector<HTMLElement>('[data-sku-row]');
  const sku = document.querySelector<HTMLElement>('[data-sku]');

  const selected = () =>
    [...picker.querySelectorAll<HTMLInputElement>('input[type=radio]:checked')].map((i) => i.value);

  picker.addEventListener('change', () => {
    const values = selected();
    const variant = variants.find(
      (v) => values.every((id) => v.values.includes(id)) && v.values.length === values.length,
    );
    choose(variant);
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
    stock.textContent = (variant.available ? stock.dataset.in : stock.dataset.out) ?? '';
    stock.classList.toggle('out', !variant.available);
    if (skuRow && sku) {
      skuRow.hidden = !variant.sku;
      sku.textContent = variant.sku ?? '';
    }
    show(variant.image);
  });
}
