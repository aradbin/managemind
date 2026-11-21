// Add to cart on product cards (design/storefront-redesign: ProductCard): a
// card whose product has one variant adds it here, then turns its button into
// "Added · View cart". The header's and bottom bar's counts follow the cart.
// Listens on the document, so cards added later (Load more) work too.

const BANGLA = '০১২৩৪৫৬৭৮৯';
const locale = document.documentElement.lang === 'en' ? 'en' : 'bn';

function setCount(n: number) {
  for (const badge of document.querySelectorAll<HTMLElement>('[data-cart-count]')) {
    const text = String(n);
    badge.textContent = badge.hasAttribute('data-bengali')
      ? text.replace(/\d/g, (x) => BANGLA[Number(x)] ?? x)
      : text;
    badge.hidden = n === 0;
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('[data-card-add] > button');
  const box = button?.parentElement;
  const variantId = box?.dataset.cardAdd;
  if (!button || !box || !variantId || button.disabled) return;
  const label = button.querySelector<HTMLElement>('.card-label');
  const idle = label?.textContent ?? '';
  button.disabled = true;
  if (label) label.textContent = box.dataset.adding ?? '';
  try {
    const res = await fetch(`/api/cart/lines?locale=${locale}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ variantId, quantity: 1 }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const cart = (await res.json()) as { itemCount: number };
    setCount(cart.itemCount);
    const added = box.querySelector<HTMLElement>('.card-added');
    button.hidden = true;
    if (added) added.hidden = false;
    const tracker = (window as unknown as { mmTracker?: { addToCart: (i: unknown) => void } })
      .mmTracker;
    tracker?.addToCart({
      id: variantId,
      name: box.dataset.name ?? '',
      price: Number(box.dataset.price) || 0,
      quantity: 1,
    });
  } catch {
    alert(box.dataset.error ?? '');
  } finally {
    button.disabled = false;
    if (label) label.textContent = idle;
  }
});

// A module, so its names stay its own.
export {};
