// Recently viewed (design/storefront-redesign): a product page keeps its card
// (lib/card.ts's CardView, in the page's language) in the browser's storage,
// and the Recently viewed section draws the last ones with the same markup
// as ProductCard.astro, so scripts/card.ts's Add to cart works on them too.
// Storage is per store and can be missing or full; then nothing shows.
// Text only, never HTML.

interface View {
  id: string;
  href: string;
  title: string;
  brand: string | null;
  image: { src: string; srcset: string; width: number; height: number } | null;
  off: string | null;
  soldOut: boolean;
  options: string;
  dots: string[];
  price: string | null;
  sale: boolean;
  compare: string | null;
  action: 'add' | 'choose' | null;
  variantId: string | null;
  amount: number;
}

interface Entry {
  id: string;
  /** When it was last viewed (ms). */
  at: number;
  views: { bn?: View; en?: View };
}

const KEEP = 12;
const SHOW = 4;
const MAX_AGE = 60 * 86_400_000;
const keyFor = (store: string) => `mm_recent:${store}`;

function read(store: string): Entry[] {
  try {
    const list = JSON.parse(localStorage.getItem(keyFor(store)) ?? '[]') as Entry[];
    const now = Date.now();
    return Array.isArray(list) ? list.filter((e) => e?.id && now - e.at < MAX_AGE) : [];
  } catch {
    return [];
  }
}

function write(store: string, list: Entry[]) {
  try {
    if (list.length) localStorage.setItem(keyFor(store), JSON.stringify(list.slice(0, KEEP)));
    else localStorage.removeItem(keyFor(store));
  } catch {
    // Private windows and full storage: no history, nothing else breaks.
  }
}

// A product page: remember this product, newest first.
const item = document.getElementById('mm-recent-item');
if (item) {
  try {
    const { store, locale, view } = JSON.parse(item.textContent ?? '{}') as {
      store: string;
      locale: 'bn' | 'en';
      view: View;
    };
    const list = read(store);
    const old = list.find((e) => e.id === view.id);
    const entry: Entry = { id: view.id, at: Date.now(), views: { ...old?.views, [locale]: view } };
    write(store, [entry, ...list.filter((e) => e.id !== view.id)]);
  } catch {
    // A malformed copy: skip it.
  }
}

const SVG = 'http://www.w3.org/2000/svg';
function icon(paths: string[], size: number, stroke: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': stroke,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'icon',
  }))
    svg.setAttribute(k, String(v));
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
const CART = [
  'M3 4h2l2.4 11h11.2L21 7H7',
  'M8.5 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  'M15.5 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
];
const CHECK = ['M5 12l5 5 9-10'];

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children)
    if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

type Messages = Record<
  | 'add'
  | 'addAria'
  | 'added'
  | 'choose'
  | 'chooseAria'
  | 'adding'
  | 'error'
  | 'out'
  | 'regular'
  | 'cart',
  string
>;

function card(v: View, m: Messages): HTMLElement {
  const named = (text: string) => text.replace('{product}', v.title);
  const media = node('div', { class: 'card-media' });
  if (v.image) {
    media.appendChild(
      node('img', {
        src: v.image.src,
        srcset: v.image.srcset,
        sizes: '(min-width: 1000px) 25vw, (min-width: 640px) 33vw, 50vw',
        width: String(v.image.width),
        height: String(v.image.height),
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      }),
    );
  }
  if (v.soldOut) media.appendChild(node('span', { class: 'badge out' }, m.out));
  if (v.off) media.appendChild(node('span', { class: 'badge' }, v.off));
  const options = node('p', {
    class: 'card-options',
    'aria-hidden': v.options ? undefined : 'true',
  });
  for (const c of v.dots) {
    const dot = node('span', { class: 'dot' });
    dot.style.background = c;
    options.appendChild(dot);
  }
  if (v.options) options.appendChild(document.createTextNode(v.options));
  let action: HTMLElement;
  if (v.action === 'add' && v.variantId) {
    action = node(
      'div',
      {
        class: 'card-action',
        'data-card-add': v.variantId,
        'data-name': v.title,
        'data-price': String(v.amount),
        'data-adding': m.adding,
        'data-error': m.error,
      },
      node(
        'button',
        { type: 'button', class: 'card-button', 'aria-label': named(m.addAria) },
        icon(CART, 18, 2),
        node('span', { class: 'card-label' }, m.add),
      ),
      node(
        'a',
        { class: 'card-button card-added', href: m.cart, role: 'status', hidden: '' },
        icon(CHECK, 16, 2.25),
        node('span', { class: 'card-label' }, m.added),
      ),
    );
  } else if (v.action === 'choose') {
    action = node(
      'div',
      { class: 'card-action' },
      node(
        'a',
        { class: 'card-button', href: v.href, 'aria-label': named(m.chooseAria) },
        icon(CART, 18, 2),
        node('span', { class: 'card-label' }, m.choose),
      ),
    );
  } else {
    action = node('div', { class: 'card-action none' });
  }
  return node(
    'article',
    { class: 'card' },
    media,
    node(
      'div',
      { class: 'card-text' },
      v.brand ? node('p', { class: 'card-brand' }, v.brand) : null,
      node('h3', { class: 'card-title' }, node('a', { href: v.href }, v.title)),
    ),
    options,
    v.price
      ? node(
          'p',
          { class: 'price' },
          node('span', { class: v.sale ? 'sale' : undefined }, v.price),
          v.compare
            ? node(
                's',
                { class: 'compare' },
                node('span', { class: 'visually-hidden' }, `${m.regular}: `),
                v.compare,
              )
            : null,
        )
      : null,
    action,
  );
}

// The section: draw the last few, skipping the product on screen.
for (const section of document.querySelectorAll<HTMLElement>('[data-recent]')) {
  const store = section.dataset.store ?? '';
  const locale = section.dataset.locale === 'en' ? 'en' : 'bn';
  const except = section.dataset.except;
  const messages = JSON.parse(section.dataset.messages ?? '{}') as Messages;
  const grid = section.querySelector('ul');
  const views = read(store)
    .filter((e) => e.id !== except)
    .map((e) => e.views[locale])
    .filter((v): v is View => Boolean(v))
    .slice(0, SHOW);
  if (!grid || !views.length) continue;
  for (const v of views) grid.appendChild(node('li', {}, card(v, messages)));
  section.hidden = false;
  section.querySelector('[data-recent-clear]')?.addEventListener('click', () => {
    write(store, []);
    section.hidden = true;
  });
}

// A module, so its names stay its own.
export {};
