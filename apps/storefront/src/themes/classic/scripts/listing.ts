// Category, collection and search pages (design/storefront-redesign: Listing,
// ListingPhone). Everything here also works as plain links and forms; this
// script only makes it quicker:
// - sorting applies as soon as it changes;
// - desktop filters apply as soon as a box is ticked (the phone sheet waits
//   for "Show products", so several can be chosen first);
// - Load more fetches the next page and adds its products here, and Back
//   from a product brings those pages and the scroll position back;
// - the sheet's close button, and Back to top after two screens.

const desktop = matchMedia('(min-width: 900px)');
const BANGLA = '০১২৩৪৫৬৭৮৯';
const digits = (n: number) =>
  document.documentElement.lang === 'bn'
    ? String(n).replace(/\d/g, (x) => BANGLA[Number(x)] ?? x)
    : String(n);

const sorter = document.querySelector<HTMLFormElement>('form.sorter');
sorter?.querySelector('select')?.addEventListener('change', () => sorter.submit());
sorter?.querySelector('button')?.setAttribute('hidden', '');

const filters = document.querySelector<HTMLDetailsElement>('details.filters');
const form = document.querySelector<HTMLFormElement>('form[data-filters]');
if (form) {
  form.dataset.auto = '';
  form.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    // Prices wait for Go.
    if (desktop.matches && input.type === 'checkbox') form.requestSubmit();
  });
  // Leave empty prices out of the address.
  form.addEventListener('submit', () => {
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type=number]')) {
      input.disabled = input.value === '';
    }
  });
}
document.querySelector('[data-close-filters]')?.addEventListener('click', () => {
  if (filters) filters.open = false;
  filters?.querySelector('summary')?.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filters?.open && !desktop.matches) {
    filters.open = false;
    filters.querySelector('summary')?.focus();
  }
});
// Back to the sidebar or the sheet when the window changes size.
desktop.addEventListener('change', () => {
  if (filters) filters.open = desktop.matches;
});

// Load more: the next page's products, added to this one. How many pages
// were added, and how far down the shopper was, are kept for this address in
// sessionStorage, so Back from a product brings both back
// (design/storefront-redesign: "Remember the place in the list").
const loadMore = document.querySelector<HTMLAnchorElement>('[data-load-more]');
const grid = document.querySelector('[data-listing-grid] ul');
const showing = document.querySelector<HTMLElement>('[data-showing]');
const progress = document.querySelector<HTMLElement>('[data-progress]');
const PLACE = `mm_place:${location.pathname}${location.search}`;
let added = 0;

const remember = () => {
  try {
    sessionStorage.setItem(PLACE, JSON.stringify({ pages: added, y: Math.round(scrollY) }));
  } catch {}
};
const recalled = (): { pages: number; y: number } | null => {
  try {
    const kept = JSON.parse(sessionStorage.getItem(PLACE) ?? 'null') as {
      pages?: unknown;
      y?: unknown;
    } | null;
    if (!kept || typeof kept.pages !== 'number' || typeof kept.y !== 'number') return null;
    return { pages: Math.min(Math.max(0, kept.pages), 20), y: Math.max(0, kept.y) };
  } catch {
    return null;
  }
};

/** Adds the next page's products; false when there was none or it failed. */
async function addNextPage(focus: boolean): Promise<boolean> {
  if (!loadMore?.isConnected || !grid) return false;
  const res = await fetch(loadMore.href, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(String(res.status));
  const page = new DOMParser().parseFromString(await res.text(), 'text/html');
  const items = [...page.querySelectorAll('[data-listing-grid] ul > li')];
  const first = items[0]?.querySelector<HTMLAnchorElement>('.card-title a');
  for (const item of items) grid.appendChild(document.importNode(item, true));
  const total = Number(loadMore.dataset.total);
  const shown = Math.min(total, Number(loadMore.dataset.shown) + items.length);
  const next = page.querySelector<HTMLAnchorElement>('[data-load-more]');
  loadMore.dataset.shown = String(shown);
  if (showing?.dataset.template) {
    showing.textContent = showing.dataset.template.replace('{shown}', digits(shown));
  }
  if (progress) progress.style.width = `${Math.round((shown / total) * 100)}%`;
  if (next && items.length) {
    loadMore.href = next.href;
    loadMore.textContent = (loadMore.dataset.label ?? '').replace(
      '{count}',
      digits(Math.min(total - shown, items.length)),
    );
  } else {
    loadMore.remove();
  }
  if (items.length) added++;
  // Keyboard users carry on from the first new product.
  const href = first?.getAttribute('href');
  if (focus && href)
    grid
      .querySelector<HTMLAnchorElement>(`.card-title a[href="${CSS.escape(href)}"]`)
      ?.focus({ preventScroll: true });
  return items.length > 0;
}

if (loadMore && grid) {
  showing?.setAttribute('aria-live', 'polite');
  loadMore.addEventListener('click', async (e) => {
    e.preventDefault();
    if (loadMore.getAttribute('aria-disabled') === 'true') return;
    loadMore.setAttribute('aria-disabled', 'true');
    try {
      await addNextPage(true);
      remember();
    } catch {
      // The link still works as a page of its own.
      location.href = loadMore.href;
    } finally {
      loadMore.removeAttribute('aria-disabled');
    }
  });
}

// Leaving (for a product, usually): keep the place. A page kept whole in the
// back-forward cache needs nothing; one loaded again gets its pages back.
addEventListener('pagehide', remember);
const arrival = performance.getEntriesByType('navigation')[0] as
  | PerformanceNavigationTiming
  | undefined;
const place = arrival?.type === 'back_forward' ? recalled() : null;
if (!place) {
  try {
    sessionStorage.removeItem(PLACE);
  } catch {}
} else if (place.pages > 0 && loadMore && grid) {
  history.scrollRestoration = 'manual';
  void (async () => {
    try {
      for (let i = 0; i < place.pages; i++) if (!(await addNextPage(false))) break;
    } catch {}
    scrollTo(0, place.y);
  })();
}

// Back to top, after about two screens.
const toTop = document.querySelector<HTMLButtonElement>('[data-to-top]');
if (toTop) {
  const toggle = () => {
    toTop.hidden = scrollY < innerHeight * 2;
  };
  addEventListener('scroll', toggle, { passive: true });
  toggle();
  toTop.addEventListener('click', () => {
    scrollTo({
      top: 0,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (h1) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
  });
}

// A module, so its names stay its own.
export {};
