// Checkout (phase-4-plan §3.5, §3.16; design/storefront-redesign: Checkout,
// CheckoutPhone): phone first, one searchable Area field over the geography
// file (no API call), totals that follow the area, a summary of problems
// linked to their fields, an invisible Turnstile check, and "Place order" under an
// idempotency key kept in sessionStorage, so a double tap, a lost response
// or a reload sends the same key and never makes two orders. Online payment
// (phase-5a-plan §3.3, §3.4) goes on to SSLCommerz once the order is saved.
import { attributionForCheckout } from './attribution';
import { type Cart, codeForm, lineName, problemText, totals } from './cart-view';
import {
  api,
  config,
  digits,
  el,
  fill,
  imageUrl,
  money,
  pick,
  ShopError,
  setCount,
  t,
  tracker,
} from './shop';
import { type Check, mountTurnstile } from './turnstile';

interface GeoFile {
  v: string;
  d: [number, string, string][];
  s: [number, number, string, string][];
  a: [number, number, string, string][];
}
interface CheckoutState {
  cart: Cart;
  cod: { enabled: boolean; maxOrderValue: number | null };
  online: { enabled: boolean; advance: 'never' | 'always' | 'flagged' };
  holiday: { active: boolean; message: { bn?: string; en?: string } };
  email: 'optional' | 'required' | 'hidden';
  termsCheckbox: boolean;
  accounts: boolean;
  /** The signed-in shopper's details and saved addresses (§3.11). */
  account: {
    name: string;
    email: string;
    phone: string | null;
    addresses: {
      id: string;
      name: string;
      phone: string;
      divisionId: number;
      districtId: number;
      areaId: number;
      line: string;
      label: string | null;
      isDefault: boolean;
    }[];
  } | null;
  turnstileSiteKey: string | null;
  recovery: { save: boolean };
}
interface Placed {
  id: string;
  displayNumber: string;
  total: number;
  viewToken: string;
  payUrl: string | null;
}

const cfg = config();
const form = document.querySelector<HTMLFormElement>('[data-checkout]');
const notice = document.querySelector<HTMLElement>('[data-notice]');
const summary = document.querySelector<HTMLElement>('[data-summary]');
const place = document.querySelector<HTMLButtonElement>('[data-place]');
const KEY = 'mm_checkout_key';
const name = (n: [unknown, ...unknown[]]) =>
  String(cfg.locale === 'bn' ? n[n.length - 2] : n[n.length - 1]);

let cart: Cart | null = null;
let check: Check | undefined;

/** WhatsApp and Call links to the store, those it has. */
function contactLinks(text = ''): HTMLAnchorElement[] {
  const links: HTMLAnchorElement[] = [];
  if (cfg.whatsapp) {
    const query = text ? `?text=${encodeURIComponent(text)}` : '';
    links.push(
      el('a', {
        href: `https://wa.me/${cfg.whatsapp.replace(/\D/g, '')}${query}`,
        target: '_blank',
        rel: 'noopener',
        text: t('help.whatsapp'),
      }),
    );
  }
  if (cfg.tel && cfg.phone) {
    links.push(el('a', { href: `tel:${cfg.tel}`, text: t('checkout.call', { phone: cfg.phone }) }));
  }
  return links;
}

/**
 * The notice above the form (design/storefront-redesign: Checkout's
 * scenarios): a problem, a price change or a payment the store asks for,
 * with the store's WhatsApp and phone when the shopper has to ask them.
 * Focus moves to it, so it is read out.
 */
function show(message: string, kind: 'error' | 'info' | 'warn' = 'error', contact = false) {
  if (!notice) return;
  const text = notice.querySelector('[data-notice-text]');
  const links = notice.querySelector<HTMLElement>('[data-notice-links]');
  if (text) text.textContent = message;
  notice.dataset.kind = kind;
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  notice.hidden = !message;
  if (links) {
    const found = contact ? contactLinks() : [];
    fill(links, ...found);
    links.hidden = !found.length;
  }
  if (message) {
    notice.focus({ preventScroll: true });
    notice.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/**
 * In the form's place when the store can't take this order
 * (design/storefront-redesign: "the form is replaced by a panel"): the store
 * is paused, there is no way to pay, or the cart is empty.
 */
function block(kind: 'paused' | 'nopay' | 'empty' | 'error', message = '') {
  const panel = document.querySelector<HTMLElement>('[data-block]');
  if (!panel) return;
  if (form) form.hidden = true;
  const sign = (d: string, size = 26, round = true) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({
      width: String(size),
      height: String(size),
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }))
      svg.setAttribute(k, v);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return round ? el('span', { class: 'block-sign' }, svg) : svg;
  };
  const back = el('a', {
    class: 'button outline',
    href: cfg.links.cart,
    text: t('checkout.backToCart'),
  });
  const whatsapp = cfg.whatsapp
    ? el(
        'a',
        {
          class: 'button whatsapp',
          href: `https://wa.me/${cfg.whatsapp.replace(/\D/g, '')}`,
          target: '_blank',
          rel: 'noopener',
        },
        sign('M4 20l1.3-3.9A8 8 0 1 1 8 19z', 20, false),
        t('checkout.whatsapp'),
      )
    : null;
  panel.dataset.kind = kind;
  if (kind === 'empty') {
    fill(
      panel,
      sign('M3 4h2l2.4 11h11.2L21 7H7M10 20h.01M17 20h.01'),
      el('h2', { text: t('cart.empty') }),
      el('p', { text: t('cart.emptyText') }),
      el(
        'p',
        { class: 'block-actions' },
        el('a', { class: 'button', href: cfg.links.home, text: t('cart.start') }),
      ),
    );
  } else if (kind === 'error') {
    fill(
      panel,
      sign('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16.5v.5'),
      el('h2', { text: t('cart.error') }),
      el('p', { class: 'block-actions' }, back),
    );
  } else {
    fill(
      panel,
      sign(
        kind === 'paused'
          ? 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9v6M14 9v6'
          : 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16.5v.5',
      ),
      el('h2', { text: kind === 'paused' ? t('checkout.paused') : t('checkout.codUnavailable') }),
      message ? el('blockquote', { text: message }) : null,
      el('p', { text: kind === 'paused' ? t('checkout.pausedNext') : t('checkout.noPayNext') }),
      el('p', { class: 'block-actions' }, whatsapp, back),
    );
  }
  panel.hidden = false;
  scrollTo({ top: 0 });
}

const foldLabel = document.querySelector<HTMLElement>('[data-fold-label]');
const foldTotal = document.querySelector<HTMLElement>('[data-fold-total]');
const payLabel = document.querySelector<HTMLElement>('[data-pay-label]');
const payAmount = document.querySelector<HTMLElement>('[data-pay-amount]');

/** What is paid when: on delivery, now, or the delivery charge now. */
function payRow() {
  if (!cart || !payLabel || !payAmount) return;
  const method = chosenPayment();
  const fee = Math.max(0, cart.totals.deliveryFee - cart.totals.deliveryDiscount);
  payLabel.textContent =
    method === 'online'
      ? t('checkout.payNow')
      : method === 'cod_with_advance'
        ? t('checkout.payNowFee')
        : t('checkout.payOnDelivery');
  payAmount.textContent = money(method === 'cod_with_advance' ? fee : cart.totals.total);
}

/** Lines whose price changed when the order was placed: the price the shopper had seen. */
const priceWas = new Map<string, number>();
/** The chosen area has no delivery zone (design/storefront-redesign: "Area not served"). */
let unserved = false;
let busy = false;

/** A change to the cart from checkout (the promo code): redraw from its answer. */
async function change(run: () => Promise<Cart>, status: HTMLElement) {
  if (busy) return;
  busy = true;
  try {
    renderSummary(await run());
  } catch (e) {
    status.textContent =
      e instanceof ShopError && e.code === 'promotion_unavailable'
        ? t('cart.code.not_found')
        : t('cart.error');
  } finally {
    busy = false;
  }
}

/**
 * The box under the address: every zone's charge before an area is chosen,
 * the chosen zone's charge and time after, and what to do next when the
 * store doesn't deliver there.
 */
function deliveryBox(c: Cart) {
  const note = document.querySelector<HTMLElement>('[data-delivery-note]');
  const text = document.querySelector<HTMLElement>('[data-delivery-text]');
  if (!note || !text) return;
  note.classList.toggle('unserved', unserved);
  if (unserved) {
    const links = contactLinks();
    fill(
      text,
      el('strong', { text: t('checkout.askDelivery') }),
      ...links.flatMap((a) => [' ', a]),
    );
    note.hidden = false;
    return;
  }
  if (c.zone) {
    const fee = Math.max(0, c.totals.deliveryFee - c.totals.deliveryDiscount);
    const estimate = pick(c.zone.estimate);
    fill(
      text,
      [
        pick(c.zone.name),
        fee === 0 && c.totals.deliveryFee > 0 ? t('cart.free') : money(fee),
        estimate ? t('checkout.estimate', { estimate }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );
    note.hidden = false;
    return;
  }
  const zones = (cfg.facts?.zones ?? [])
    .map((z) => `${z.name}: ${money(z.fee)}${z.estimate ? ` (${z.estimate})` : ''}`)
    .join(', ');
  fill(text, zones ? t('cart.deliveryNote', { zones }) : '');
  note.hidden = !zones;
}

function renderSummary(c: Cart) {
  cart = c;
  unserved = c.areaId !== null && !c.zone && c.lines.length > 0;
  if (unserved) fieldError('areaId', t('checkout.noDelivery'));
  else if (document.getElementById('c-area-e')?.textContent === t('checkout.noDelivery'))
    fieldError('areaId', '');
  deliveryBox(c);
  if (!summary) return;
  const lines = el(
    'ul',
    { class: 'mini-lines', role: 'list' },
    ...c.lines.map((l) => {
      const src = imageUrl(l.image, 160);
      return el(
        'li',
        {},
        el(
          'span',
          { class: 'mini-media' },
          src ? el('img', { src, alt: '', width: '56', height: '56', loading: 'lazy' }) : null,
          el('span', {
            class: 'mini-qty',
            'aria-hidden': 'true',
            text: digits(String(l.quantity)),
          }),
        ),
        el(
          'span',
          { class: 'mini-name' },
          el('span', { text: `${pick(l.title)}`, class: 'mini-title' }),
          l.optionLabels.length
            ? el('span', { class: 'hint', text: l.optionLabels.map(pick).join(' · ') })
            : null,
          el('span', { class: 'visually-hidden', text: ` × ${digits(String(l.quantity))}` }),
          problemText(l) ? el('span', { class: 'line-problem', text: problemText(l) ?? '' }) : null,
          priceWas.has(l.variantId) && priceWas.get(l.variantId) !== l.unitPrice
            ? el('span', {
                class: 'was-now',
                text: t('checkout.wasNow', {
                  was: money(priceWas.get(l.variantId) ?? 0),
                  now: money(l.unitPrice),
                }),
              })
            : null,
        ),
        el('span', { class: 'mini-total', text: money(l.total) }),
      );
    }),
  );
  const box = totals(c, {
    deliveryHint: t('checkout.chooseArea'),
    subtotalLabel: t('cart.subtotalCount', { count: c.itemCount }),
    ...(c.zone ? {} : { totalLabel: t('checkout.totalBefore') }),
    ...(unserved ? { noZoneDelivery: t('checkout.notAvailable') } : {}),
  });
  // The promo code, as on the cart page (design/storefront-redesign: Checkout).
  const promo = el(
    'details',
    { class: 'promo', open: Boolean(c.code) },
    el('summary', { text: t('cart.promo') }),
    codeForm(c, (run, status) => void change(run, status), { nested: true }),
  );
  const parts: (Node | null)[] = [lines, promo, box];
  if (!c.ready) parts.push(el('p', { class: 'line-problem', text: t('cart.fix') }));
  fill(summary, ...parts.filter((p): p is Node => p !== null));
  if (place) place.disabled = !c.ready;
  if (foldLabel) foldLabel.textContent = t('checkout.showSummary', { count: c.itemCount });
  if (foldTotal) foldTotal.textContent = money(c.totals.total);
  payRow();
  // What "delivery charge online" takes now (§3.4).
  const hint = document.querySelector<HTMLElement>('[data-advance-hint]');
  if (hint) {
    const fee = Math.max(0, c.totals.deliveryFee - c.totals.deliveryDiscount);
    hint.textContent = t('checkout.advanceHint', { amount: money(fee) });
  }
}

/** Shows a payment choice, or hides it (and moves the choice off it). */
function offer(method: string, shown: boolean) {
  const label = form?.querySelector<HTMLElement>(`[data-pay="${method}"]`);
  if (!label) return;
  label.hidden = !shown;
  const input = label.querySelector('input');
  if (input && !shown) input.checked = false;
}
function choose(method: string) {
  const input = form?.querySelector<HTMLInputElement>(`[data-pay="${method}"] input`);
  if (input) input.checked = true;
}
const chosenPayment = () => String(new FormData(form as HTMLFormElement).get('payment') ?? 'cod');

/** Chooses an area, as a pick, a reload or a saved address does. */
let choosePlace: (areaId: number) => void = () => {};

/**
 * One searchable Area field (design/storefront-redesign: "One searchable
 * Area field instead of three dropdowns"): a few letters of the thana,
 * upazila or district, in either language, list the matching areas with
 * their district and division; the pick shows as a card with Change. The
 * geography file is cached for a year, so the search runs here.
 */
async function setupAddress() {
  const geo = (await (await fetch(cfg.geo ?? '/geo/bd.json')).json()) as GeoFile;
  const input = document.getElementById('c-area-q') as HTMLInputElement | null;
  const list = document.getElementById('c-area-list') as HTMLUListElement | null;
  const search = document.querySelector<HTMLElement>('[data-area-search]');
  const chosen = document.querySelector<HTMLElement>('[data-area-chosen]');
  const hidden = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  const division = hidden('c-division');
  const district = hidden('c-district');
  const areaInput = hidden('c-area');
  if (!input || !list || !search || !chosen || !division || !district || !areaInput) return;
  const fold = (text: string) => text.normalize('NFC').toLowerCase();
  const districts = new Map(geo.s.map((x) => [x[0], x]));
  const divisions = new Map(geo.d.map((x) => [x[0], x]));
  type Match = { area: GeoFile['a'][number]; rank: number };
  let matches: Match[] = [];
  let active = -1;

  const placeText = (a: GeoFile['a'][number]) => {
    const s = districts.get(a[1]);
    const d = s ? divisions.get(s[1]) : undefined;
    return [s ? name(s) : '', d ? name(d) : ''].filter(Boolean).join(', ');
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const mark = (i: number) => {
    active = i;
    for (const [j, li] of [...list.children].entries()) {
      li.setAttribute('aria-selected', String(j === i));
    }
    const li = list.children[i] as HTMLElement | undefined;
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  };
  const pickArea = async (areaId: number, send = true) => {
    const a = geo.a.find((x) => x[0] === areaId);
    const s = a ? districts.get(a[1]) : undefined;
    if (!a || !s) return;
    areaInput.value = String(a[0]);
    district.value = String(s[0]);
    division.value = String(s[1]);
    const nameEl = chosen.querySelector('[data-area-name]');
    const placeEl = chosen.querySelector('[data-area-place]');
    if (nameEl) nameEl.textContent = name(a);
    if (placeEl) placeEl.textContent = placeText(a);
    chosen.hidden = false;
    search.hidden = true;
    close();
    fieldError('areaId', '');
    if (!send) return;
    // Until the cart answers for the new area, the old one's "not served" is gone.
    unserved = false;
    try {
      renderSummary(await api<Cart>('/cart/area', { method: 'PUT', body: { areaId } }));
    } catch {
      show(t('cart.error'));
    }
  };
  const draw = () => {
    const q = fold(input.value.trim());
    while (list.firstChild) list.removeChild(list.firstChild);
    matches = [];
    if (q.length < 2) return close();
    for (const area of geo.a) {
      const own = [fold(area[2]), fold(area[3])];
      const s = districts.get(area[1]);
      const parent = s ? [fold(s[2]), fold(s[3])] : [];
      const rank = own.some((n) => n.startsWith(q))
        ? 0
        : own.some((n) => n.includes(q))
          ? 1
          : parent.some((n) => n.startsWith(q))
            ? 2
            : -1;
      if (rank >= 0) matches.push({ area, rank });
    }
    matches.sort((x, y) => x.rank - y.rank || name(x.area).localeCompare(name(y.area), cfg.locale));
    matches = matches.slice(0, 8);
    if (!matches.length) {
      list.appendChild(
        el('li', {
          class: 'area-none',
          role: 'option',
          'aria-disabled': 'true',
          text: t('checkout.areaNone', { q: input.value.trim() }),
        }),
      );
    }
    for (const [i, m] of matches.entries()) {
      const li = el(
        'li',
        {
          id: `c-area-o${i}`,
          role: 'option',
          'aria-selected': 'false',
          'data-area': String(m.area[0]),
        },
        el('strong', { text: name(m.area) }),
        el('span', { class: 'hint', text: placeText(m.area) }),
      );
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => void pickArea(m.area[0]));
      list.appendChild(li);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      if (list.hidden) draw();
      mark(Math.min(matches.length - 1, active + 1));
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      mark(Math.max(0, active - 1));
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault();
      const m = matches[Math.max(0, active)];
      if (m) void pickArea(m.area[0]);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', close);
  chosen.querySelector('[data-area-change]')?.addEventListener('click', () => {
    chosen.hidden = true;
    search.hidden = false;
    areaInput.value = '';
    input.value = '';
    input.focus();
  });
  choosePlace = (areaId: number) => void pickArea(areaId, false);
  // A cart that already has an area (a reload): choose it again.
  if (cart?.areaId) {
    choosePlace(cart.areaId);
    renderSummary(cart);
  }
}

/**
 * A signed-in shopper (§3.11): their details filled in, their saved
 * addresses offered, and "save my details" for next time.
 */
function setupAccount(account: NonNullable<CheckoutState['account']>) {
  const input = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  const local = (phone: string) => phone.replace(/^\+88/, '');
  const nameInput = input('c-name');
  const phoneInput = input('c-phone');
  const emailInput = input('c-email');
  if (nameInput && !nameInput.value) nameInput.value = account.name;
  if (phoneInput && !phoneInput.value && account.phone) phoneInput.value = local(account.phone);
  if (emailInput && !emailInput.value) emailInput.value = account.email;
  const line = document.getElementById('c-line') as HTMLTextAreaElement | null;
  const use = async (a: (typeof account.addresses)[number]) => {
    choosePlace(a.areaId);
    if (line) line.value = a.line;
    if (nameInput) nameInput.value = a.name;
    if (phoneInput) phoneInput.value = local(a.phone);
    try {
      renderSummary(await api<Cart>('/cart/area', { method: 'PUT', body: { areaId: a.areaId } }));
    } catch {
      show(t('cart.error'));
    }
  };
  const areaField = document.getElementById('c-area-field');
  const fieldset = areaField?.closest('fieldset');
  if (account.addresses.length && areaField) {
    const select = el(
      'select',
      { id: 'c-saved' },
      ...account.addresses.map((a) =>
        el('option', { value: a.id, text: [a.label, a.line].filter(Boolean).join(': ') }),
      ),
      el('option', { value: '', text: t('checkout.newAddress') }),
    );
    select.addEventListener('change', () => {
      const a = account.addresses.find((x) => x.id === select.value);
      if (a) void use(a);
      else if (line) line.value = '';
    });
    areaField.insertAdjacentElement(
      'beforebegin',
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'c-saved', text: t('checkout.savedAddress') }),
        select,
      ),
    );
    const first = account.addresses.find((a) => a.isDefault) ?? account.addresses[0];
    if (first) {
      select.value = first.id;
      void use(first);
    }
  }
  fieldset?.insertAdjacentElement(
    'beforeend',
    el(
      'label',
      { class: 'choice' },
      el('input', { type: 'checkbox', name: 'saveDetails', checked: true }),
      el('span', { text: t('checkout.saveDetails') }),
    ),
  );
}

const PHONE = /^(?:\+?88)?0?1[3-9]\d{8}$/;
const latin = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));

/** The field a problem belongs to: the area's is the search field (or its chosen card). */
const fieldInput = (field: string): HTMLElement | null =>
  field === 'areaId' || field === 'districtId' || field === 'divisionId'
    ? document.getElementById('c-area-q')
    : (form?.querySelector<HTMLElement>(`[name=${field}]`) ?? null);

function fieldError(field: string, message: string) {
  const input = fieldInput(field);
  const error = input
    ? document.getElementById(`${field === 'areaId' ? 'c-area' : input.id}-e`)
    : null;
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (error) error.textContent = message;
}

/** The problems at the top, each a link to its field (design/storefront-redesign). */
function errorSummary(problems: { field: string; label: string; message: string }[]) {
  const box = document.querySelector<HTMLElement>('[data-error-summary]');
  const list = box?.querySelector('[data-error-list]');
  if (!box || !list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  box.hidden = !problems.length;
  for (const p of problems) {
    const input = fieldInput(p.field);
    const id =
      p.field === 'areaId' && document.getElementById('c-area-q')?.closest('[hidden]')
        ? 'c-area-field'
        : input?.id;
    const link = el('a', { href: `#${id ?? ''}`, text: `${p.label}: ${p.message}` });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      (input?.closest('[hidden]')
        ? document.querySelector<HTMLElement>('[data-area-change]')
        : input
      )?.focus();
    });
    list.appendChild(el('li', {}, link));
  }
}

/** Client-side checks for the obvious; the server checks everything again. */
function collect(): Record<string, unknown> | null {
  if (!form) return null;
  const data = new FormData(form);
  const value = (k: string) => String(data.get(k) ?? '').trim();
  let ok = true;
  const need = (k: string, bad?: string) => {
    const v = value(k);
    const message = !v ? t('checkout.required') : (bad ?? '');
    fieldError(k, message);
    if (message) ok = false;
    return v;
  };
  const phone = latin(value('phone')).replace(/[\s\-.()]/g, '');
  need('name');
  need('phone', PHONE.test(phone) ? '' : t('checkout.badPhone'));
  const email = value('email');
  if (form.querySelector('[name=email]')) {
    const bad = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? t('checkout.badEmail') : '';
    if (form.querySelector<HTMLInputElement>('[name=email]')?.required) need('email', bad);
    else {
      fieldError('email', bad);
      if (bad) ok = false;
    }
  }
  const areaId = Number(value('areaId'));
  fieldError('areaId', !areaId ? t('checkout.areaPick') : unserved ? t('checkout.noDelivery') : '');
  if (!areaId || unserved) ok = false;
  const divisionId = Number(value('divisionId'));
  const districtId = Number(value('districtId'));
  const line = need('line');
  if (form.querySelector('[name=acceptTerms]') && !data.get('acceptTerms')) {
    fieldError('acceptTerms', t('checkout.required'));
    ok = false;
  }
  if (!ok) {
    const LABELS: Record<string, string> = {
      phone: t('checkout.phone'),
      name: t('checkout.name'),
      email: t('checkout.email'),
      areaId: t('checkout.area'),
      line: t('checkout.line'),
      acceptTerms: t('checkout.terms'),
    };
    errorSummary(
      Object.keys(LABELS)
        .map((field) => {
          const input = fieldInput(field);
          const message =
            input?.getAttribute('aria-invalid') === 'true'
              ? (document.getElementById(`${field === 'areaId' ? 'c-area' : (input.id ?? '')}-e`)
                  ?.textContent ?? '')
              : '';
          return { field, label: LABELS[field] ?? field, message };
        })
        .filter((p) => p.message),
    );
    form.querySelector<HTMLElement>('[aria-invalid=true]')?.focus();
    return null;
  }
  errorSummary([]);
  const attribution = attributionForCheckout();
  return {
    contact: { name: value('name'), phone, ...(email ? { email } : {}) },
    address: { divisionId, districtId, areaId, line },
    ...(value('note') ? { note: value('note') } : {}),
    paymentMethod: chosenPayment(),
    expectedTotal: cart?.totals.total ?? 0,
    ...(data.get('acceptTerms') ? { acceptTerms: true } : {}),
    ...(data.get('saveDetails') ? { saveDetails: true } : {}),
    // Only with the shopper's consent to cookies (phase-9-plan §3.1.6).
    ...(attribution && Object.keys(attribution).length ? { attribution } : {}),
  };
}

/**
 * The checkout saved as it is typed (phase-6-plan §3.2), so the store can
 * call a shopper who leaves: once the phone is a valid mobile number, and
 * again when the name, email or address change, 2 seconds after the last
 * keystroke, only when something changed. "Don't save" deletes it and stops.
 */
function setupRecovery() {
  const box = document.querySelector<HTMLElement>('[data-recovery]');
  if (!form || !box) return;
  box.hidden = false;
  let stopped = false;
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async () => {
    if (stopped) return;
    const data = new FormData(form);
    const value = (k: string) => String(data.get(k) ?? '').trim();
    const phone = latin(value('phone')).replace(/[\s\-.()]/g, '');
    if (!PHONE.test(phone)) return;
    const id = (k: string) => (Number(value(k)) > 0 ? { [k]: Number(value(k)) } : {});
    const body = {
      phone,
      ...(value('name') ? { name: value('name') } : {}),
      ...(value('email') ? { email: value('email') } : {}),
      address: {
        ...id('divisionId'),
        ...id('districtId'),
        ...id('areaId'),
        ...(value('line') ? { line: value('line') } : {}),
      },
    };
    const json = JSON.stringify(body);
    if (json === last) return;
    last = json;
    try {
      await api('/checkout/draft', { method: 'PUT', body });
    } catch (e) {
      // Saving never gets in the shopper's way; a refusal just stops it.
      if (e instanceof ShopError && (e.status === 409 || e.status === 429)) stopped = true;
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 2000);
  };
  for (const name of ['phone', 'name', 'email', 'line']) {
    form.querySelector(`[name=${name}]`)?.addEventListener('input', later);
  }
  for (const name of ['divisionId', 'districtId', 'areaId']) {
    form.querySelector(`[name=${name}]`)?.addEventListener('change', later);
  }
  box.querySelector('[data-dont-save]')?.addEventListener('click', async () => {
    stopped = true;
    clearTimeout(timer);
    const text = box.querySelector('[data-recovery-text]');
    if (text) text.textContent = t('checkout.saveStopped');
    box.querySelector('[data-dont-save]')?.remove();
    await api('/checkout/draft', { method: 'DELETE' }).catch(() => {});
  });
}

/** One key per attempt: kept until the order is placed, so retries reuse it. */
function attemptKey(): string {
  let key: string | null = null;
  try {
    key = sessionStorage.getItem(KEY);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(KEY, key);
    }
  } catch {
    key = key ?? crypto.randomUUID();
  }
  return key;
}
const newAttempt = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
};

/** The phone's code check (phase-5a-plan §3.14), once the store asked for it. */
let otpToken: string | undefined;

/**
 * Texts a code to the order's phone and checks it; then the order is placed
 * again with the token. Shown only when checkout answers `otp_required`
 * (design/storefront-redesign: "Phone code"): a dialog, a bottom sheet on
 * phones, that confirms by itself once all 6 digits are in, and lets a new
 * code go only after 45 seconds, as the store allows only a few an hour.
 */
function askForCode(phone: string) {
  const dialog = document.querySelector<HTMLDialogElement>('[data-otp]');
  const input = document.getElementById('c-otp') as HTMLInputElement | null;
  const status = dialog?.querySelector<HTMLElement>('[data-otp-status]');
  const verify = dialog?.querySelector<HTMLButtonElement>('[data-otp-verify]');
  const resend = dialog?.querySelector<HTMLButtonElement>('[data-otp-resend]');
  const shown = dialog?.querySelector('[data-otp-phone]');
  if (!dialog || !input || !status || !verify || !resend) return;
  // 01712-345678, as the number is written on the form's example.
  const local = latin(phone).replace(/^\+?88/, '');
  if (shown)
    shown.textContent = digits(
      /^01\d{9}$/.test(local) ? `${local.slice(0, 5)}-${local.slice(5)}` : phone,
    );
  input.value = '';
  const say = (text: string, kind: 'ok' | 'error' = 'error') => {
    status.textContent = text;
    status.dataset.kind = kind;
    input.setAttribute('aria-invalid', String(Boolean(text) && kind === 'error'));
  };
  say('');
  let timer: ReturnType<typeof setInterval> | undefined;
  const wait = (seconds: number) => {
    clearInterval(timer);
    let left = seconds;
    const tick = () => {
      resend.disabled = left > 0;
      resend.textContent =
        left > 0
          ? t('checkout.otpWait', { time: digits(`0:${String(left).padStart(2, '0')}`) })
          : t('checkout.otpResend');
      if (left-- <= 0) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1000);
  };
  const sendCode = async () => {
    resend.disabled = true;
    try {
      check?.reset();
      const turnstileToken = await check?.token();
      await api('/checkout/otp', {
        body: { phone, ...(turnstileToken ? { turnstileToken } : {}) },
      });
      say(t('checkout.otpSent'), 'ok');
      wait(45);
    } catch (err) {
      say(
        err instanceof ShopError && err.code === 'rate_limited'
          ? t('checkout.otpTooMany')
          : t('cart.error'),
      );
      wait(err instanceof ShopError && err.code === 'rate_limited' ? 45 : 0);
    }
  };
  let checking = false;
  const confirm = async () => {
    const code = latin(input.value).replace(/\D/g, '');
    if (code.length !== 6) return say(t('checkout.otpWrong'));
    if (checking) return;
    checking = true;
    verify.disabled = true;
    try {
      const done = await api<{ otpToken: string }>('/checkout/otp/verify', {
        body: { phone, code },
      });
      otpToken = done.otpToken;
      clearInterval(timer);
      dialog.close();
      form?.requestSubmit();
    } catch (err) {
      const reason =
        err instanceof ShopError
          ? (err.body.errors as { code: string }[] | undefined)?.[0]?.code
          : '';
      say(
        reason === 'locked' || reason === 'expired'
          ? t('checkout.otpExpired')
          : t('checkout.otpWrong'),
      );
      input.select();
    } finally {
      checking = false;
      verify.disabled = false;
    }
  };
  // The handlers are set once; each opening sends to the number on the form.
  if (!dialog.dataset.ready) {
    dialog.dataset.ready = '1';
    input.addEventListener('input', () => {
      const code = latin(input.value).replace(/\D/g, '').slice(0, 6);
      if (code !== input.value) input.value = code;
      if (input.getAttribute('aria-invalid') === 'true') say('');
      if (code.length === 6) void current.confirm();
    });
    verify.addEventListener('click', () => void current.confirm());
    resend.addEventListener('click', () => void current.sendCode());
    dialog.querySelector('[data-otp-close]')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-otp-change]')?.addEventListener('click', () => {
      dialog.close();
      const field = document.getElementById('c-phone') as HTMLInputElement | null;
      field?.focus();
      field?.select();
    });
    dialog.addEventListener('close', () => clearInterval(current.timer()));
  }
  current = { confirm, sendCode, timer: () => timer };
  dialog.showModal();
  input.focus();
  void sendCode();
}
/** The open dialog's actions: the handlers are bound once, the phone changes per opening. */
let current: {
  confirm: () => Promise<void>;
  sendCode: () => Promise<void>;
  timer: () => ReturnType<typeof setInterval> | undefined;
} = {
  confirm: async () => {},
  sendCode: async () => {},
  timer: () => undefined,
};

async function submit(e: SubmitEvent) {
  e.preventDefault();
  if (!place || place.disabled) return;
  const body = collect();
  if (!body) return;
  show('');
  place.disabled = true;
  place.textContent = t('checkout.placing');
  try {
    const send = async (key: string) => {
      const turnstileToken = await check?.token();
      return api<Placed>('/checkout/orders', {
        body: {
          ...body,
          ...(turnstileToken ? { turnstileToken } : {}),
          ...(otpToken ? { otpToken } : {}),
        },
        headers: { 'idempotency-key': key },
      });
    };
    let placed: Placed;
    try {
      placed = await send(attemptKey());
    } catch (err) {
      // The cart changed since the last attempt under this key: a new attempt.
      if (!(err instanceof ShopError && err.code === 'idempotency_key_reused')) throw err;
      // The first try spent its token.
      check?.reset();
      newAttempt();
      placed = await send(attemptKey());
    }
    newAttempt();
    setCount(0);
    const items = (cart?.lines ?? []).map((l) => ({
      id: l.variantId,
      name: lineName(l),
      price: l.unitPrice,
      quantity: l.quantity,
    }));
    tracker()?.purchase(placed.id, items, placed.total);
    if (placed.payUrl) {
      show(t('checkout.redirecting'), 'info');
      location.assign(placed.payUrl);
      return;
    }
    // Online, but the payment page didn't open: the order page offers "pay now".
    const pending = body.paymentMethod !== 'cod' ? '?payment=pending' : '';
    location.assign(`${cfg.links.thanks}${pending}#${placed.viewToken}`);
  } catch (err) {
    place.disabled = false;
    place.textContent = t('checkout.place');
    check?.reset();
    if (!(err instanceof ShopError)) return show(t('cart.error'));
    const b = err.body;
    switch (err.code) {
      case 'price_changed': {
        // The new totals, each changed line marked with the price seen before:
        // the shopper checks them before trying again.
        const seen = new Map((cart?.lines ?? []).map((l) => [l.variantId, l.unitPrice]));
        const fresh = await api<Cart>('/cart').catch(() => null);
        if (fresh) {
          for (const l of fresh.lines) {
            const was = seen.get(l.variantId);
            if (was !== undefined && was !== l.unitPrice && !priceWas.has(l.variantId))
              priceWas.set(l.variantId, was);
          }
          renderSummary(fresh);
        }
        const fold = document.querySelector<HTMLDetailsElement>('[data-summary-fold]');
        if (fold) fold.open = true;
        return show(t('checkout.priceChanged'), 'warn');
      }
      case 'insufficient_stock':
      case 'cart_invalid': {
        const fresh = await api<Cart>('/cart').catch(() => null);
        if (fresh) renderSummary(fresh);
        return show(t('checkout.stock'));
      }
      case 'checkout_paused':
        return block('paused');
      case 'otp_required':
        // The store asks this phone for a code by SMS first (§3.14).
        return askForCode((body.contact as { phone: string }).phone);
      case 'cod_unavailable': {
        // This phone (or every phone) pays the delivery charge first (§3.4).
        if (b.reason === 'advance_required') {
          offer('cod', false);
          offer('cod_with_advance', true);
          choose('cod_with_advance');
          payRow();
          return show(t('checkout.advanceRequired'), 'info');
        }
        // Cash on delivery is out for this order: online, if the store takes it.
        const online = form?.querySelector<HTMLElement>('[data-pay="online"]');
        if (online && !online.hidden) {
          offer('cod', false);
          offer('cod_with_advance', false);
          choose('online');
          payRow();
          return show(t('checkout.codUnavailable'), 'info', true);
        }
        return block('nopay');
      }
      case 'rate_limited':
        return show(t('checkout.limited'), 'error', true);
      case 'validation_failed': {
        const fields = (b.errors as { path: string }[] | undefined) ?? [];
        for (const f of fields) {
          const key = f.path.split('.').at(-1) ?? '';
          if (key === 'turnstileToken') return show(t('checkout.check'));
          if (key === 'areaId' && f.path.startsWith('address'))
            fieldError('areaId', t('checkout.noDelivery'));
          else if (key) fieldError(key === 'phone' ? 'phone' : key, t('checkout.required'));
        }
        return show(t('checkout.invalid'));
      }
      case 'not_found':
        return show(t('cart.empty'));
      default:
        return show(t('cart.error'));
    }
  }
}

/** The promises under Place order. */
function showFacts() {
  const facts = cfg.facts;
  if (!facts) return;
  const trust = document.querySelector<HTMLElement>('[data-trust]');
  if (!trust) return;
  const items = [
    t('checkout.trustDetails'),
    [
      facts.returnDays ? t('checkout.trustReturns', { count: facts.returnDays }) : '',
      cfg.phone ? t('checkout.trustHelp', { phone: cfg.phone }) : '',
    ]
      .filter(Boolean)
      .join(' '),
  ].filter(Boolean);
  fill(trust, ...items.map((text) => el('li', {}, el('span', { text }))));
}

async function start() {
  if (!form) return;
  let state: CheckoutState;
  try {
    state = await api<CheckoutState>('/checkout');
  } catch {
    return block('error');
  }
  setCount(state.cart.itemCount);
  if (!state.cart.lines.length) return block('empty');
  if (state.holiday.active) return block('paused', pick(state.holiday.message));
  const online = state.online.enabled;
  if (!state.cod.enabled && !online) return block('nopay');
  // The choices the store offers: COD, online, and the delivery charge online.
  offer('online', online);
  offer('cod_with_advance', online && state.cod.enabled && state.online.advance !== 'never');
  offer('cod', state.cod.enabled && !(online && state.online.advance === 'always'));
  if (!state.cod.enabled) choose('online');
  else if (online && state.online.advance === 'always') choose('cod_with_advance');
  form.hidden = false;
  renderSummary(state.cart);
  await setupAddress().catch(() => show(t('cart.error')));
  if (state.account) setupAccount(state.account);
  else if (state.accounts && cfg.links.account) {
    form.insertAdjacentElement(
      'beforebegin',
      el(
        'p',
        { class: 'sign-in-hint' },
        el('a', { href: cfg.links.account, text: t('checkout.signIn') }),
        ' ',
        el('span', { class: 'muted', text: t('checkout.guest') }),
      ),
    );
  }
  showFacts();
  const box = document.querySelector<HTMLElement>('[data-turnstile]');
  if (state.turnstileSiteKey && box)
    check = mountTurnstile(box, state.turnstileSiteKey, cfg.locale);
  form.addEventListener('submit', (e) => void submit(e));
  form.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).name === 'payment') payRow();
  });
  // A corrected field loses its error at once; the summary goes when none is left.
  form.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.getAttribute('aria-invalid') !== 'true' || !target.name) return;
    if (target.value.trim()) fieldError(target.name, '');
    if (!form.querySelector('[aria-invalid=true]')) errorSummary([]);
  });
  if (state.recovery.save) setupRecovery();
  tracker()?.beginCheckout(
    state.cart.lines.map((l) => ({
      id: l.variantId,
      name: lineName(l),
      price: l.unitPrice,
      quantity: l.quantity,
    })),
    state.cart.totals.total,
  );
}

void start();
