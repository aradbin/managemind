// The SMS confirmation link's page (phase-6-plan §3.7): the order's number,
// items, total, the amount to pay on delivery and the area (never the
// street), and Confirm or Cancel. A wrong, used or expired code gets the
// same message.
import { api, el, fill, type Localized, money, pick, ShopError, t } from './shop';

interface LinkOrder {
  displayNumber: string;
  items: { title: Localized; optionLabels: Localized[]; quantity: number }[];
  total: number;
  codDue: number;
  area: Localized | null;
}

const root = document.querySelector<HTMLElement>('[data-confirm]');
const notice = document.querySelector<HTMLElement>('[data-notice]');
const code = location.hash.slice(1);
// The code leaves the address bar, so it isn't shared by a copied link.
if (code) history.replaceState(null, '', location.pathname + location.search);

function say(text: string) {
  if (!notice) return;
  notice.textContent = text;
  notice.hidden = false;
}

const problem = (e: unknown) =>
  e instanceof ShopError && e.status === 429
    ? t('confirm.locked')
    : e instanceof ShopError && e.status === 404
      ? t('confirm.gone')
      : t('cart.error');

function done(result: 'confirmed' | 'noted' | 'cancelled', number: string) {
  if (!root) return;
  fill(root, el('p', { class: 'done', text: t(`confirm.${result}`, { number }) }));
}

function render(o: LinkOrder) {
  if (!root) return;
  const row = (label: string, value: string) =>
    el('div', { class: 'row' }, el('dt', { text: label }), el('dd', { text: value }));
  const yes = el('button', { type: 'button', class: 'button', text: t('confirm.yes') });
  const no = el('button', { type: 'button', class: 'button secondary', text: t('confirm.no') });
  const answer = async (action: 'confirm' | 'cancel') => {
    if (action === 'cancel' && !window.confirm(t('confirm.noConfirm'))) return;
    yes.disabled = true;
    no.disabled = true;
    try {
      const r = await api<{ result: 'confirmed' | 'noted' | 'cancelled' }>('/v1/store/confirm', {
        body: { code, action },
      });
      done(r.result, o.displayNumber);
    } catch (e) {
      yes.disabled = false;
      no.disabled = false;
      say(problem(e));
    }
  };
  yes.addEventListener('click', () => void answer('confirm'));
  no.addEventListener('click', () => void answer('cancel'));
  fill(
    root,
    el('p', { text: t('confirm.order', { number: o.displayNumber }) }),
    el('h2', { text: t('confirm.items') }),
    el(
      'ul',
      { class: 'lines' },
      ...o.items.map((i) =>
        el(
          'li',
          {},
          [pick(i.title), ...i.optionLabels.map(pick)].filter(Boolean).join(' · '),
          ` × ${i.quantity}`,
        ),
      ),
    ),
    el(
      'dl',
      { class: 'totals' },
      row(t('confirm.total'), money(o.total)),
      row(t('confirm.cod'), money(o.codDue)),
      o.area && row(t('confirm.area'), pick(o.area)),
    ),
    el('div', { class: 'actions' }, yes, no),
  );
}

async function load() {
  if (!code) return say(t('confirm.gone'));
  try {
    render(await api<LinkOrder>('/v1/store/confirm/view', { body: { code } }));
  } catch (e) {
    if (root) fill(root);
    say(problem(e));
  }
}

void load();
