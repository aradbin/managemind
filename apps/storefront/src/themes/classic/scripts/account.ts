// The account page (phase-4-plan §3.11, §3.16): sign-in by email code, then
// the shopper's details, the orders placed while signed in and saved
// addresses. Everything goes through /api/account and /api/auth on the
// store's own host; the session cookie never leaves /api.
import { api, config, digits, el, fill, money, ShopError, t } from './shop';
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
  displayNumber: string;
  status: string;
  total: number;
  itemCount: number;
  placedAt: string;
}
interface GeoFile {
  d: [number, string, string][];
  s: [number, number, string, string][];
  a: [number, number, string, string][];
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
const name = (n: [unknown, ...unknown[]]) =>
  String(cfg.locale === 'bn' ? n[n.length - 2] : n[n.length - 1]);
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
  fill(
    box,
    el(
      'ul',
      { class: 'orders' },
      ...orders.map((o) =>
        el(
          'li',
          {},
          el('strong', { text: digits(o.displayNumber) }),
          ' ',
          el('span', { text: t(`status.${o.status}`) }),
          el('br'),
          el('span', {
            class: 'muted small',
            text: t('account.ordered', { date: date(o.placedAt), count: o.itemCount }),
          }),
          ' · ',
          el('span', { text: money(o.total) }),
        ),
      ),
    ),
  );
}

function placeText(a: Address) {
  const area = geo?.a.find((x) => x[0] === a.areaId);
  const district = geo?.s.find((x) => x[0] === a.districtId);
  return [a.line, area && name(area), district && name(district)].filter(Boolean).join(', ');
}

function renderAddresses(addresses: Address[]) {
  const list = document.querySelector<HTMLElement>('[data-addresses]');
  if (!list) return;
  if (!addresses.length)
    return fill(list, el('li', { class: 'muted', text: t('account.noAddresses') }));
  fill(
    list,
    ...addresses.map((a) => {
      const remove = el('button', {
        type: 'button',
        class: 'link-button',
        text: t('account.delete'),
      });
      remove.addEventListener('click', async () => {
        try {
          await api(`/account/addresses/${a.id}`, { method: 'DELETE' });
          await load();
        } catch (err) {
          show(problem(err));
        }
      });
      return el(
        'li',
        {},
        el('strong', { text: a.label ?? a.name }),
        a.isDefault
          ? el('span', { class: 'muted small', text: ` (${t('account.default')})` })
          : null,
        el('br'),
        `${a.name} · ${digits(a.phone.replace(/^\+88/, ''))}`,
        el('br'),
        placeText(a),
        el('br'),
        remove,
      );
    }),
  );
}

async function setupPlaceSelects() {
  geo = (await (await fetch(cfg.geo ?? '/geo/bd.json')).json()) as GeoFile;
  const division = byId<HTMLSelectElement>('ad-division');
  const district = byId<HTMLSelectElement>('ad-district');
  const area = byId<HTMLSelectElement>('ad-area');
  if (!division || !district || !area || !geo) return;
  const g = geo;
  const fillSelect = (select: HTMLSelectElement, rows: [number, ...unknown[]][]) => {
    const sorted = [...rows].sort((a, b) => name(a).localeCompare(name(b), cfg.locale));
    fill(
      select,
      el('option', { value: '', text: t('checkout.choose') }),
      ...sorted.map((r) => el('option', { value: String(r[0]), text: name(r) })),
    );
    select.disabled = rows.length === 0;
  };
  fillSelect(division, g.d);
  division.addEventListener('change', () => {
    fillSelect(
      district,
      g.s.filter((s) => s[1] === Number(division.value)),
    );
    fillSelect(area, []);
  });
  district.addEventListener('change', () =>
    fillSelect(
      area,
      g.a.filter((a) => a[1] === Number(district.value)),
    ),
  );
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

const addressForm = document.querySelector<HTMLFormElement>('[data-address]');
addressForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(addressForm);
  const value = (k: string) => String(data.get(k) ?? '').trim();
  const phone = latin(value('phone')).replace(/[\s\-.()]/g, '');
  const checks = [
    fieldError('ad-name', value('name') ? '' : t('checkout.required')),
    fieldError('ad-phone', PHONE.test(phone) ? '' : t('checkout.badPhone')),
    fieldError('ad-division', value('divisionId') ? '' : t('checkout.required')),
    fieldError('ad-district', value('districtId') ? '' : t('checkout.required')),
    fieldError('ad-area', value('areaId') ? '' : t('checkout.required')),
    fieldError('ad-line', value('line') ? '' : t('checkout.required')),
  ];
  if (checks.includes(false)) return;
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
    addressForm.reset();
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
  if (hello) hello.textContent = t('account.hello', { email: who });
  const nameInput = byId<HTMLInputElement>('a-name');
  const phoneInput = byId<HTMLInputElement>('a-phone');
  if (nameInput) nameInput.value = account.profile.name;
  if (phoneInput) phoneInput.value = account.profile.phone?.replace(/^\+88/, '') ?? '';
  if (!geo) await setupPlaceSelects().catch(() => undefined);
  renderAddresses(account.addresses);
  renderOrders(await api<Order[]>('/account/orders').catch(() => []));
}

void load();
