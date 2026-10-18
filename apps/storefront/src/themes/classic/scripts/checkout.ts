// Checkout (phase-4-plan §3.5, §3.16): phone first, the area from the
// geography file's three dropdowns (no API call), totals that follow the
// area, an invisible Turnstile check, and "Place order" under an
// idempotency key kept in sessionStorage, so a double tap, a lost response
// or a reload sends the same key and never makes two orders. Online payment
// (phase-5a-plan §3.3, §3.4) goes on to SSLCommerz once the order is saved.
import { type Cart, lineName, problemText, totals } from './cart-view';
import {
  api,
  config,
  digits,
  el,
  fill,
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

function show(message: string, kind: 'error' | 'info' = 'error') {
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = !message;
  if (message) notice.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function renderSummary(c: Cart) {
  cart = c;
  if (!summary) return;
  const lines = el(
    'ul',
    { class: 'mini-lines', role: 'list' },
    ...c.lines.map((l) =>
      el(
        'li',
        {},
        el('span', { text: `${lineName(l)} × ${digits(String(l.quantity))}` }),
        el('span', { text: money(l.total) }),
        problemText(l) ? el('p', { class: 'line-problem', text: problemText(l) ?? '' }) : null,
      ),
    ),
  );
  const parts: (Node | null)[] = [lines, totals(c, { deliveryHint: t('checkout.chooseArea') })];
  const estimate = c.zone ? pick(c.zone.estimate) : '';
  if (estimate)
    parts.push(el('p', { class: 'muted small', text: t('checkout.estimate', { estimate }) }));
  if (!c.ready) parts.push(el('p', { class: 'line-problem', text: t('cart.fix') }));
  fill(summary, ...parts.filter((p): p is Node => p !== null));
  if (place) place.disabled = !c.ready;
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

/** Chooses a place in the three dropdowns, as a reload or a saved address does. */
let choosePlace: (areaId: number) => void = () => {};

/** The three dropdowns, from the geography file (cached for a year). */
async function setupAddress() {
  const geo = (await (await fetch(cfg.geo ?? '/geo/bd.json')).json()) as GeoFile;
  // By ID: querySelector's generic is typed against Workers' Element here.
  const division = document.getElementById('c-division') as HTMLSelectElement | null;
  const district = document.getElementById('c-district') as HTMLSelectElement | null;
  const area = document.getElementById('c-area') as HTMLSelectElement | null;
  if (!division || !district || !area) return;
  const fillSelect = (select: HTMLSelectElement, rows: [number, ...unknown[]][]) => {
    const sorted = [...rows].sort((a, b) => name(a).localeCompare(name(b), cfg.locale));
    fill(
      select,
      el('option', { value: '', text: t('checkout.choose') }),
      ...sorted.map((r) => el('option', { value: String(r[0]), text: name(r) })),
    );
    select.disabled = rows.length === 0;
  };
  fillSelect(division, geo.d);
  division.addEventListener('change', () => {
    fillSelect(
      district,
      geo.s.filter((s) => s[1] === Number(division.value)),
    );
    fillSelect(area, []);
  });
  district.addEventListener('change', () =>
    fillSelect(
      area,
      geo.a.filter((a) => a[1] === Number(district.value)),
    ),
  );
  area.addEventListener('change', async () => {
    const areaId = Number(area.value) || null;
    try {
      renderSummary(await api<Cart>('/cart/area', { method: 'PUT', body: { areaId } }));
    } catch {
      show(t('cart.error'));
    }
  });
  choosePlace = (areaId: number) => {
    const a = geo.a.find((x) => x[0] === areaId);
    const s = a && geo.s.find((x) => x[0] === a[1]);
    if (a && s) {
      division.value = String(s[1]);
      fillSelect(
        district,
        geo.s.filter((x) => x[1] === s[1]),
      );
      district.value = String(s[0]);
      fillSelect(
        area,
        geo.a.filter((x) => x[1] === s[0]),
      );
      area.value = String(a[0]);
    }
  };
  // A cart that already has an area (a reload): choose it again.
  if (cart?.areaId) choosePlace(cart.areaId);
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
  const division = document.getElementById('c-division');
  const fieldset = division?.closest('fieldset');
  if (account.addresses.length && division) {
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
    division
      .closest('.field')
      ?.insertAdjacentElement(
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

function fieldError(field: string, message: string) {
  const input = form?.querySelector<HTMLInputElement>(`[name=${field}]`);
  const error = input ? document.getElementById(`${input.id}-e`) : null;
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (error) error.textContent = message;
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
  const divisionId = Number(need('divisionId'));
  const districtId = Number(need('districtId'));
  const areaId = Number(need('areaId'));
  const line = need('line');
  if (form.querySelector('[name=acceptTerms]') && !data.get('acceptTerms')) {
    fieldError('acceptTerms', t('checkout.required'));
    ok = false;
  }
  if (!ok) {
    show(t('checkout.invalid'));
    form.querySelector<HTMLElement>('[aria-invalid=true]')?.focus();
    return null;
  }
  return {
    contact: { name: value('name'), phone, ...(email ? { email } : {}) },
    address: { divisionId, districtId, areaId, line },
    ...(value('note') ? { note: value('note') } : {}),
    paymentMethod: chosenPayment(),
    expectedTotal: cart?.totals.total ?? 0,
    ...(data.get('acceptTerms') ? { acceptTerms: true } : {}),
    ...(data.get('saveDetails') ? { saveDetails: true } : {}),
  };
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
        body: { ...body, ...(turnstileToken ? { turnstileToken } : {}) },
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
        // The new totals: the shopper sees them before trying again.
        const fresh = await api<Cart>('/cart').catch(() => null);
        if (fresh) renderSummary(fresh);
        return show(t('checkout.priceChanged'), 'info');
      }
      case 'insufficient_stock':
      case 'cart_invalid': {
        const fresh = await api<Cart>('/cart').catch(() => null);
        if (fresh) renderSummary(fresh);
        return show(t('checkout.stock'));
      }
      case 'checkout_paused':
        return show(t('checkout.paused'));
      case 'cod_unavailable':
        // This phone (or every phone) pays the delivery charge first (§3.4).
        if (b.reason === 'advance_required') {
          offer('cod', false);
          offer('cod_with_advance', true);
          choose('cod_with_advance');
          return show(t('checkout.advanceRequired'), 'info');
        }
        return show(t('checkout.codUnavailable'));
      case 'rate_limited':
        return show(t('checkout.limited'));
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

async function start() {
  if (!form) return;
  let state: CheckoutState;
  try {
    state = await api<CheckoutState>('/checkout');
  } catch {
    return show(t('cart.error'));
  }
  setCount(state.cart.itemCount);
  if (!state.cart.lines.length) {
    show(t('cart.empty'), 'info');
    notice?.insertAdjacentElement(
      'afterend',
      el('p', {}, el('a', { class: 'button', href: cfg.links.home, text: t('cart.continue') })),
    );
    return;
  }
  if (state.holiday.active) {
    return show(pick(state.holiday.message) || t('checkout.paused'), 'info');
  }
  const online = state.online.enabled;
  if (!state.cod.enabled && !online) return show(t('checkout.codUnavailable'), 'info');
  // The choices the store offers: COD, online, and the delivery charge online.
  offer('online', online);
  offer('cod_with_advance', online && state.cod.enabled && state.online.advance !== 'never');
  offer('cod', state.cod.enabled && !(online && state.online.advance === 'always'));
  if (!state.cod.enabled) choose('online');
  else if (online && state.online.advance === 'always') choose('cod_with_advance');
  renderSummary(state.cart);
  form.hidden = false;
  await setupAddress().catch(() => show(t('cart.error')));
  if (state.account) setupAccount(state.account);
  else if (state.accounts && cfg.links.account) {
    form.insertAdjacentElement(
      'beforebegin',
      el('p', {}, el('a', { href: cfg.links.account, text: t('checkout.signIn') })),
    );
  }
  const box = document.querySelector<HTMLElement>('[data-turnstile]');
  if (state.turnstileSiteKey && box)
    check = mountTurnstile(box, state.turnstileSiteKey, cfg.locale);
  form.addEventListener('submit', (e) => void submit(e));
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
