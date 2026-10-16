// The product page's islands (phase-3-plan §3.5): the variant picker updates
// price, availability and image from data already in the page, with no API
// call; the gallery's thumbnails scroll the main images. Without JavaScript
// the page still shows everything, with the first available variant.

interface VariantData {
  id: string;
  values: string[];
  price: string;
  compare: string | null;
  available: boolean;
  /** Index of its image in the gallery, or -1. */
  image: number;
}

const track = document.querySelector<HTMLElement>('[data-gallery-track]');
const thumbs = [...document.querySelectorAll<HTMLButtonElement>('[data-thumb]')];

function show(index: number) {
  if (!track || index < 0) return;
  const slide = track.children[index] as HTMLElement | undefined;
  if (slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === index)));
}

for (const thumb of thumbs)
  thumb.addEventListener('click', () => show(Number(thumb.dataset.thumb)));
track?.addEventListener(
  'scroll',
  () => {
    const index = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
    thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === index)));
  },
  { passive: true },
);

const picker = document.querySelector<HTMLFormElement>('[data-variant-picker]');
const data = document.getElementById('mm-variants');
if (picker && data) {
  const variants = JSON.parse(data.textContent ?? '[]') as VariantData[];
  const priceEl = document.querySelector<HTMLElement>('[data-price]');
  const compareEl = document.querySelector<HTMLElement>('[data-compare]');
  const compareValue = document.querySelector<HTMLElement>('[data-compare-value]');
  const stock = document.querySelector<HTMLElement>('[data-stock]');

  const selected = () =>
    [...picker.querySelectorAll<HTMLInputElement>('input[type=radio]:checked')].map((i) => i.value);

  picker.addEventListener('change', () => {
    const values = selected();
    const variant = variants.find(
      (v) => values.every((id) => v.values.includes(id)) && v.values.length === values.length,
    );
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
    show(variant.image);
  });
}
