// The account page (phase-4-plan §3.11, §3.16): sign-in by email code, then
// the shopper's details, the orders placed while signed in and saved
// addresses. Everything goes through /api/account and /api/auth on the
// store's own host; the session cookie never leaves /api.
import { type AreaField, type GeoFile, loadGeo, placeName, setupAreaField } from './area-field';
import { api, config, digits, el, fill, money, ShopError, setCount, t } from './shop';
import { type Check, mountTurnstile } from './turnstile';

interface Address {
  id: string;
  name: string;
  phone: string;
  divisionId: number;
  districtId: number;
  areaId: number;
  line: string;
  label: string | null;
  isDefault: boolean;
}
interface Account {
  profile: { id: string; name: string; email: string; phone: string | null };
  addresses: Address[];
}
interface Order {
  id: string;
  displayNumber: string;
  status: string;
  total: number;
  itemCount: number;
  placedAt: string;
}

const cfg = config();
const byId = <T = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const notice = document.querySelector<HTMLElement>('[data-notice]');
const signin = document.querySelector<HTMLElement>('[data-signin]');
const accountBox = document.querySelector<HTMLElement>('[data-account]');
const emailForm = document.querySelector<HTMLFormElement>('[data-email-form]');
const codeForm = document.querySelector<HTMLFormElement>('[data-code-form]');
const phoneForm = document.querySelector<HTMLFormElement>('[data-phone-form]');
const switcher = document.querySelector<HTMLButtonElement>('[data-switch-signin]');
const otherButton = document.querySelector<HTMLButtonElement>('[data-other-email]');
const PHONE = /^(?:\+?88)?0?1[3-9]\d{8}$/;
const latin = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
let email = '';
/** Sign-in by email code, or by a code to the phone where the store has SMS (phase-5a-plan §3.14). */
let mode: 'email' | 'phone' = 'email';
let phone = '';
/** 01XXXXXXXXX in any of its usual forms, as +8801XXXXXXXXX. */
const toE164 = (s: string) =>
  `+880${latin(s)
    .replace(/[\s\-.()]/g, '')
    .replace(/^(?:\+?88)?0?/, '')}`;
let geo: GeoFile | null = null;
let areaField: AreaField | null = null;
let check: Check | undefined;

function show(message: string) {
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
}

function fieldError(id: string, message: string) {
  const input = byId<HTMLInputElement>(id);
  input?.setAttribute('aria-invalid', message ? 'true' : 'false');
  const error = byId(`${id}-e`);
  if (error) error.textContent = message;
  return !message;
}

function problem(e: unknown) {
  if (!(e instanceof ShopError)) return t('cart.error');
  if (e.status === 429) return t('account.tooMany');
  const fields = (e.body.errors ?? []) as { path?: string }[];
  return fields.some((f) => f.path === 'turnstileToken') ? t('checkout.check') : t('cart.error');
}

// ---- Sign-in ----------------------------------------------------------------------------

emailForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  show('');
  email = String(new FormData(emailForm).get('email') ?? '')
    .trim()
    .toLowerCase();
  if (
    !fieldError('a-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : t('checkout.badEmail'))
  )
    return;
  try {
    const token = await check?.token();
    await api('/auth/email-otp/send-verification-otp', {
      body: { email, type: 'sign-in' },
      ...(token ? { headers: { 'x-turnstile-token': token } } : {}),
    });
    emailForm.hidden = true;
    if (codeForm) codeForm.hidden = false;
    const sent = document.querySelector<HTMLElement>('[data-code-sent]');
    if (sent) sent.textContent = t('account.codeSent', { email });
    byId<HTMLInputElement>('a-code')?.focus();
  } catch (err) {
    check?.reset();
    show(problem(err));
  }
});

phoneForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  show('');
  const typed = String(new FormData(phoneForm).get('phone') ?? '');
  if (
    !fieldError(
      'a-signin-phone',
      PHONE.test(latin(typed).replace(/[\s\-.()]/g, '')) ? '' : t('checkout.badPhone'),
    )
  )
    return;
  phone = toE164(typed);
  try {
    const token = await check?.token();
    await api('/auth/phone-number/send-otp', {
      body: { phoneNumber: phone },
      ...(token ? { headers: { 'x-turnstile-token': token } } : {}),
    });
    phoneForm.hidden = true;
    if (switcher) switcher.hidden = true;
    if (codeForm) codeForm.hidden = false;
    const sent = document.querySelector<HTMLElement>('[data-code-sent]');
    if (sent)
      sent.textContent = t('account.codeSentPhone', { phone: digits(`0${phone.slice(4)}`) });
    byId<HTMLInputElement>('a-code')?.focus();
  } catch (err) {
    check?.reset();
    show(problem(err));
  }
});

function useMode(next: 'email' | 'phone') {
  mode = next;
  if (emailForm) emailForm.hidden = next !== 'email';
  if (phoneForm) phoneForm.hidden = next !== 'phone';
  if (codeForm) codeForm.hidden = true;
  if (switcher) {
    switcher.hidden = false;
    switcher.textContent = t(next === 'email' ? 'account.usePhone' : 'account.useEmail');
  }
  if (otherButton)
    otherButton.textContent = t(next === 'email' ? 'account.otherEmail' : 'account.otherPhone');
  byId<HTMLInputElement>(next === 'email' ? 'a-email' : 'a-signin-phone')?.focus();
}
switcher?.addEventListener('click', () => useMode(mode === 'email' ? 'phone' : 'email'));

codeForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  show('');
  const otp = latin(String(new FormData(codeForm).get('otp') ?? '')).trim();
  if (!fieldError('a-code', /^\d{6}$/.test(otp) ? '' : t('account.badCode'))) return;
  try {
    if (mode === 'phone')
      await api('/auth/phone-number/verify', { body: { phoneNumber: phone, code: otp } });
    else await api('/auth/sign-in/email-otp', { body: { email, otp } });
    await load();
  } catch (err) {
    if (err instanceof ShopError && err.status === 429) show(t('account.tooMany'));
    else fieldError('a-code', t('account.badCode'));
  }
});

otherButton?.addEventListener('click', () => useMode(mode));

document.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
  try {
    await api('/auth/sign-out', { body: {} });
  } finally {
    location.reload();
  }
});

// ---- The account ------------------------------------------------------------------------

const date = (iso: string) =>
  new Intl.DateTimeFormat(cfg.locale === 'bn' ? 'bn-BD' : 'en-BD', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dhaka',
    numberingSystem: cfg.numerals === 'bengali' ? 'beng' : 'latn',
  }).format(new Date(iso));

function renderOrders(orders: Order[]) {
  const box = document.querySelector<HTMLElement>('[data-orders]');
  if (!box) return;
  if (!orders.length) return fill(box, el('p', { class: 'muted', text: t('account.noOrders') }));
  // Each order opens tracking (design/storefront-redesign: Account).
  fill(
    box,
    el(
      'ul',
      { class: 'orders', role: 'list' },
      ...orders.map((o) =>
        el(
          'li',
          {},
          el(
            'a',
            { class: 'order-link', href: cfg.links.track },
            el(
              'span',
              { class: 'order-text' },
              el('strong', { text: t('track.orderNumber', { number: o.displayNumber }) }),
              el('span', {
                class: 'hint',
                text: t('account.ordered', { date: date(o.placedAt), count: o.itemCount }),
              }),
            ),
            el('span', { class: `status-chip ${o.status}`, text: t(`status.${o.status}`) }),
            el('strong', { class: 'order-total', text: money(o.total) }),
          ),
          reorderButton(o),
        ),
      ),
    ),
  );
}

/**
 * Order again (DECISIONS.md, "What to build next"): the order's items go
 * back into the cart at today's prices; the shopper sees how many went in,
 * and which are no longer sold, with View cart.
 */
function reorderButton(o: Order): HTMLElement {
  const button = el('button', {
    type: 'button',
    class: 'button secondary',
    'aria-label': t('account.reorderLabel', { number: o.displayNumber }),
    text: t('account.reorder'),
  });
  const status = el('p', { class: 'reorder-status', role: 'status' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const r = await api<{ cart: { itemCount: number }; added: number; skipped: number }>(
        `/account/orders/${o.id}/reorder`,
        { method: 'POST', body: {} },
      );
      setCount(r.cart.itemCount);
      fill(
        status,
        [
          r.added ? t('account.reordered', { count: r.added }) : '',
          r.skipped ? t('account.reorderSkipped', { count: r.skipped }) : '',
        ]
          .filter(Boolean)
          .join(' '),
        ' ',
        r.added ? el('a', { href: cfg.links.cart, text: t('cart.view') }) : null,
      );
    } catch (err) {
      status.textContent =
        err instanceof ShopError && err.status === 404
          ? t('account.reorderSkipped', { count: o.itemCount })
          : t('cart.error');
    } finally {
      button.disabled = false;
    }
  });
  return el('div', { class: 'order-again' }, button, status);
}

/** Desktop's side menu and the phone's tabs: one panel at a time. */
let tabsReady = false;
function setupTabs() {
  if (tabsReady) return;
  tabsReady = true;
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('[data-tab]')];
  const show = (name: string) => {
    for (const tab of tabs) {
      if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'true');
      else tab.removeAttribute('aria-current');
    }
    for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== name;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      show(tab.dataset.tab ?? 'orders');
    });
  }
  show(
    location.hash.slice(1) === 'addresses' || location.hash.slice(1) === 'details'
      ? location.hash.slice(1)
      : 'orders',
  );
}

function placeText(a: Address) {
  const area = geo?.a.find((x) => x[0] === a.areaId);
  const district = geo?.s.find((x) => x[0] === a.districtId);
  return [area && placeName(area), district && placeName(district)].filter(Boolean).join(', ');
}

const undoBar = document.querySelector<HTMLElement>('[data-undo]');
const addressForm = document.querySelector<HTMLFormElement>('[data-address]');

/** The address just deleted, with Undo, which saves it again. */
function offerUndo(a: Address | null) {
  if (!undoBar) return;
  if (!a) return fill(undoBar);
  const undo = el('button', { type: 'button', text: t('account.undo') });
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    try {
      await api('/account/addresses', {
        body: {
          name: a.name,
          phone: a.phone,
          divisionId: a.divisionId,
          districtId: a.districtId,
          areaId: a.areaId,
          line: a.line,
          ...(a.label ? { label: a.label } : {}),
          isDefault: a.isDefault,
        },
      });
      fill(undoBar);
      await load();
    } catch (err) {
      undo.disabled = false;
      show(problem(err));
    }
  });
  fill(undoBar, el('span', { text: t('account.deleted') }), undo);
}

/** The add form, opened from the dashed card; the card comes back on Cancel or Save. */
function openForm(open: boolean) {
  if (!addressForm) return;
  addressForm.hidden = !open;
  const card = document.querySelector<HTMLElement>('[data-add-card]');
  if (card) card.hidden = open;
  if (open) {
    offerUndo(null);
    byId<HTMLInputElement>('ad-name')?.focus();
  } else {
    addressForm.reset();
    areaField?.clear();
    for (const id of ['ad-name', 'ad-phone', 'ad-line']) fieldError(id, '');
    areaError('');
  }
}

/**
 * Saved addresses as cards (design/storefront-redesign: Account): the label
 * and Default, the name and number, the address; Make default and Delete,
 * which offers Undo. A dashed card opens the form for another.
 */
function renderAddresses(addresses: Address[]) {
  const list = document.querySelector<HTMLElement>('[data-addresses]');
  if (!list) return;
  const cards = addresses.map((a) => {
    const label = a.label ?? a.name;
    const remove = el('button', {
      type: 'button',
      class: 'link-button danger',
      'aria-label': t('account.deleteLabel', { label }),
      text: t('account.delete'),
    });
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await api(`/account/addresses/${a.id}`, { method: 'DELETE' });
        offerUndo(a);
        await load();
      } catch (err) {
        remove.disabled = false;
        show(problem(err));
      }
    });
    const makeDefault = a.isDefault
      ? null
      : el('button', { type: 'button', class: 'link-button', text: t('account.makeDefaultShort') });
    makeDefault?.addEventListener('click', async () => {
      offerUndo(null);
      try {
        await api(`/account/addresses/${a.id}`, { method: 'PATCH', body: { isDefault: true } });
        await load();
      } catch (err) {
        show(problem(err));
      }
    });
    return el(
      'li',
      { class: a.isDefault ? 'address-card is-default' : 'address-card' },
      el(
        'p',
        { class: 'address-title' },
        el('strong', { text: label }),
        a.isDefault ? el('span', { class: 'default-badge', text: t('account.default') }) : null,
      ),
      el('p', { text: `${a.name} · ${digits(localPhone(a.phone))}` }),
      el('p', { text: a.line }),
      el('p', { class: 'muted', text: placeText(a) }),
      el('p', { class: 'address-card-actions' }, makeDefault, remove),
    );
  });
  const add = el(
    'button',
    { type: 'button', class: 'add-card' },
    el('span', { 'aria-hidden': 'true', text: '+' }),
    t('account.addAddress'),
  );
  add.addEventListener('click', () => openForm(true));
  fill(
    list,
    ...cards,
    el('li', { 'data-add-card': true, hidden: addressForm ? !addressForm.hidden : false }, add),
  );
  const none = document.querySelector<HTMLElement>('[data-no-addresses]');
  if (none) none.hidden = addresses.length > 0;
}

/** 01712-345678, as numbers are written on the forms. */
function localPhone(e164: string) {
  const local = e164.replace(/^\+?88/, '');
  return /^01\d{9}$/.test(local) ? `${local.slice(0, 5)}-${local.slice(5)}` : local;
}

function areaError(message: string) {
  byId('ad-area-q')?.setAttribute('aria-invalid', message ? 'true' : 'false');
  const error = byId('ad-area-e');
  if (error) error.textContent = message;
  return !message;
}

async function setupAddressForm() {
  geo = await loadGeo();
  const root = byId('ad-area-field');
  if (root) areaField = setupAreaField(root, geo, () => areaError(''));
  addressForm
    ?.querySelector('[data-address-cancel]')
    ?.addEventListener('click', () => openForm(false));
}

const profileForm = document.querySelector<HTMLFormElement>('[data-profile]');
profileForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(profileForm);
  const nameValue = String(data.get('name') ?? '').trim();
  const phone = latin(String(data.get('phone') ?? '')).replace(/[\s\-.()]/g, '');
  const ok =
    fieldError('a-name', nameValue ? '' : t('checkout.required')) &&
    fieldError('a-phone', !phone || PHONE.test(phone) ? '' : t('checkout.badPhone'));
  if (!ok) return;
  try {
    await api('/account', { method: 'PATCH', body: { name: nameValue, phone: phone || null } });
    const saved = document.querySelector<HTMLElement>('[data-profile-saved]');
    if (saved) saved.textContent = t('account.saved');
  } catch (err) {
    show(problem(err));
  }
});

addressForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(addressForm);
  const value = (k: string) => String(data.get(k) ?? '').trim();
  const phone = latin(value('phone')).replace(/[\s\-.()]/g, '');
  const checks = [
    fieldError('ad-name', value('name') ? '' : t('checkout.required')),
    fieldError('ad-phone', PHONE.test(phone) ? '' : t('checkout.badPhone')),
    areaError(value('areaId') ? '' : t('checkout.areaPick')),
    fieldError('ad-line', value('line') ? '' : t('checkout.required')),
  ];
  if (checks.includes(false)) {
    const first = addressForm.querySelector<HTMLElement>('[aria-invalid=true]');
    (first?.id === 'ad-area-q' ? areaField?.focusTarget() : first)?.focus();
    return;
  }
  try {
    await api('/account/addresses', {
      body: {
        name: value('name'),
        phone,
        divisionId: Number(value('divisionId')),
        districtId: Number(value('districtId')),
        areaId: Number(value('areaId')),
        line: value('line'),
        ...(value('label') ? { label: value('label') } : {}),
        isDefault: data.get('isDefault') === 'on',
      },
    });
    openForm(false);
    await load();
  } catch (err) {
    show(problem(err));
  }
});

async function load() {
  let account: Account;
  try {
    account = await api<Account>('/account');
  } catch (err) {
    if (err instanceof ShopError && err.status === 401) {
      if (signin) signin.hidden = false;
      if (accountBox) accountBox.hidden = true;
      const key = err.body.turnstileSiteKey;
      const box = document.querySelector<HTMLElement>('[data-turnstile]');
      if (typeof key === 'string' && box && !check) check = mountTurnstile(box, key, cfg.locale);
      if (err.body.phoneSignIn === true && switcher) {
        switcher.hidden = false;
        switcher.textContent = t('account.usePhone');
      }
      return;
    }
    return show(problem(err));
  }
  if (signin) signin.hidden = true;
  if (accountBox) accountBox.hidden = false;
  const hello = document.querySelector<HTMLElement>('[data-hello]');
  // A phone account's address is a placeholder: greet it by its number.
  const who = account.profile.email.endsWith('@phone.invalid')
    ? digits(`0${account.profile.email.slice(3, 13)}`)
    : account.profile.email;
  if (hello) {
    hello.textContent = t('account.hello', { email: who });
    hello.hidden = false;
  }
  const signOut = document.querySelector<HTMLElement>('[data-sign-out]');
  if (signOut) signOut.hidden = false;
  setupTabs();
  const nameInput = byId<HTMLInputElement>('a-name');
  const phoneInput = byId<HTMLInputElement>('a-phone');
  if (nameInput) nameInput.value = account.profile.name;
  if (phoneInput) phoneInput.value = account.profile.phone?.replace(/^\+88/, '') ?? '';
  if (!geo) await setupAddressForm().catch(() => undefined);
  renderAddresses(account.addresses);
  renderOrders(await api<Order[]>('/account/orders').catch(() => []));
}

void load();
