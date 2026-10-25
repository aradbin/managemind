// The confirmation page and tracking (phase-4-plan §3.16): the order's
// number, status, lines, totals, the COD amount and its parcels' tracking
// links, and "Cancel order" while the store hasn't confirmed it. The
// confirmation's token is in the URL's fragment, which never reaches a
// server or a log; tracking asks for the number and the phone. An online
// payment still waiting gets "pay now" (phase-5a-plan §3.3, §8).

import type { ReturnOptions } from './returns';
import {
  add,
  api,
  config,
  digits,
  el,
  fill,
  imageUrl,
  type Localized,
  money,
  pick,
  ShopError,
  t,
} from './shop';

interface OrderView {
  displayNumber: string;
  status: string;
  deliveryStatus: string;
  contact: { name: string; phone: string };
  address: {
    line: string;
    names: { division: Localized; district: Localized; area: Localized };
  } | null;
  lines: {
    title: Localized;
    optionLabels: Localized[];
    image: { files: { width: number; file: string }[] } | null;
    unitPrice: number;
    quantity: number;
    total: number;
  }[];
  adjustments: { title: Localized; amount: number; target: string }[];
  totals: {
    subtotal: number;
    discountTotal: number;
    deliveryFee: number;
    deliveryDiscount: number;
    vatTotal: number;
    vatIncluded: boolean;
    total: number;
    codDue: number;
  };
  shipments: {
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    /** The courier's updates (phase-7-plan §3.10), oldest first. */
    events?: { update: string; message: { en?: string; bn?: string }; at: string }[];
  }[];
  cancellable: boolean;
  onlineDue: number;
}

const cfg = config();

/** The courier's updates, newest first, in the shopper's language. */
function courierEvents(events: NonNullable<OrderView['shipments'][number]['events']>) {
  const when = new Intl.DateTimeFormat(cfg.locale === 'bn' ? 'bn-BD' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  });
  return el(
    'details',
    {},
    el('summary', { text: t('track.updates') }),
    el(
      'ol',
      {},
      ...[...events]
        .reverse()
        .map((e) =>
          el(
            'li',
            {},
            [t(`courier.${e.update}`), digits(when.format(new Date(e.at))), pick(e.message)]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
    ),
  );
}
const row = (label: string, value: string, cls = 'row') =>
  el('div', { class: cls }, el('dt', { text: label }), el('dd', { text: value }));

function view(
  o: OrderView,
  cancelToken: string | null,
  onChange: (o: OrderView) => void,
  /** Pays with the view token on the confirmation, with the track token on tracking. */
  payToken: string | null = cancelToken,
): HTMLElement {
  const fee = o.totals.deliveryFee - o.totals.deliveryDiscount;
  const totalsList = el(
    'dl',
    { class: 'totals' },
    row(t('cart.subtotal'), money(o.totals.subtotal)),
    ...o.adjustments
      .filter((a) => a.target !== 'delivery')
      .map((a) => row(pick(a.title) || t('cart.discount'), `−${money(a.amount)}`, 'row discount')),
    row(t('cart.delivery'), fee === 0 && o.totals.deliveryFee > 0 ? t('cart.free') : money(fee)),
    ...(o.totals.vatTotal > 0 && !o.totals.vatIncluded
      ? [row(t('cart.vat'), money(o.totals.vatTotal))]
      : []),
    row(t('cart.total'), money(o.totals.total), 'row total'),
  );
  const parts: (Node | null)[] = [
    el(
      'dl',
      { class: 'order-head' },
      row(t('thanks.number'), o.displayNumber),
      row(t('track.status'), t(`status.${o.status}`)),
      row(t('track.delivery'), t(`delivery.${o.deliveryStatus}`)),
    ),
  ];
  if (o.onlineDue > 0 && payToken) {
    const amount = money(o.onlineDue);
    const pay = el('button', { type: 'button', class: 'button', text: t('pay.now', { amount }) });
    pay.addEventListener('click', async () => {
      pay.disabled = true;
      try {
        const { url } = await api<{ url: string }>('/payments/retry', {
          body: { token: payToken },
        });
        location.assign(url);
      } catch {
        pay.disabled = false;
        alert(t('cart.error'));
      }
    });
    parts.push(el('p', { class: 'muted', text: t('pay.due', { amount }) }), el('p', {}, pay));
  }
  if (o.totals.codDue > 0 && o.status !== 'cancelled') {
    parts.push(
      el('p', { class: 'cod-due', text: t('thanks.cod', { amount: money(o.totals.codDue) }) }),
    );
  }
  parts.push(
    el('h2', { text: t('thanks.items') }),
    el(
      'ul',
      { class: 'lines', role: 'list' },
      ...o.lines.map((l) => {
        const src = imageUrl(l.image, 160);
        return el(
          'li',
          { class: 'line' },
          src
            ? el('img', {
                src,
                alt: '',
                width: '56',
                height: '56',
                class: 'line-image',
                loading: 'lazy',
              })
            : el('span', { class: 'line-image' }),
          el(
            'div',
            { class: 'line-body' },
            el('span', { text: pick(l.title) }),
            l.optionLabels.length
              ? el('p', { class: 'muted small', text: l.optionLabels.map(pick).join(' / ') })
              : null,
            el('p', {
              class: 'muted small',
              text: `${money(l.unitPrice)} × ${digits(String(l.quantity))}`,
            }),
          ),
          el('p', { class: 'line-total', text: money(l.total) }),
        );
      }),
    ),
    totalsList,
  );
  if (o.address) {
    const n = o.address.names;
    parts.push(
      el('h2', { text: t('thanks.deliverTo') }),
      el('p', {
        text: `${o.contact.name}, ${o.address.line}, ${pick(n.area)}, ${pick(n.district)}`,
      }),
    );
  }
  if (o.shipments.length) {
    parts.push(
      el('h2', { text: t('track.shipments') }),
      el(
        'ul',
        { role: 'list' },
        ...o.shipments.map((s) =>
          el(
            'li',
            {},
            [t(`shipment.${s.status}`), s.carrier, s.trackingNumber].filter(Boolean).join(' · '),
            s.trackingUrl
              ? el(
                  'span',
                  {},
                  ' ',
                  el('a', {
                    href: s.trackingUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    text: t('track.courier'),
                  }),
                )
              : null,
            s.events?.length ? courierEvents(s.events) : null,
          ),
        ),
      ),
    );
  }
  if (o.cancellable && cancelToken) {
    const button = el('button', {
      type: 'button',
      class: 'button secondary',
      text: t('track.cancel'),
    });
    button.addEventListener('click', async () => {
      if (!confirm(t('track.cancelConfirm'))) return;
      button.disabled = true;
      try {
        onChange(await api<OrderView>('/orders/cancel', { body: { token: cancelToken } }));
      } catch {
        button.disabled = false;
        alert(t('cart.error'));
      }
    });
    parts.push(el('p', {}, button));
  }
  if (o.status === 'cancelled')
    parts.unshift(el('p', { class: 'notice', role: 'status', text: t('track.cancelled') }));
  return el('div', { class: 'order-view' }, ...parts.filter((p): p is Node => p !== null));
}

// The confirmation page: the view token from the fragment.
const thanks = document.querySelector<HTMLElement>('[data-thanks]');
if (thanks) {
  const token = location.hash.slice(1);
  const missing = () =>
    add(
      thanks,
      el('p', { text: t('thanks.missing') }),
      el('p', {}, el('a', { class: 'button', href: cfg.links.track, text: t('track.title') })),
    );
  // Back from SSLCommerz (the return page's redirect): what happened.
  const payment = new URLSearchParams(location.search).get('payment');
  const result =
    payment === 'paid'
      ? t('pay.paid')
      : payment === 'failed'
        ? t('pay.failed')
        : payment === 'cancelled'
          ? t('pay.cancelled')
          : null;
  if (!token) missing();
  else {
    api<OrderView>('/orders/view', { body: { token } })
      .then((o) => {
        add(
          thanks,
          ...(result
            ? [
                el('p', {
                  class: 'notice',
                  'data-kind': payment === 'paid' ? 'info' : 'error',
                  role: 'status',
                  text: result,
                }),
              ]
            : []),
          view(o, null, () => {}, token),
          el('p', { class: 'muted', text: t('thanks.next') }),
        );
      })
      .catch(missing);
  }
}

// Tracking: number and phone, then the order with a cancel button while pending.
// A payment link from the store (phase-5a-plan §3.3) opens it with "pay now":
// its token is in the fragment, and can't cancel.
const form = document.querySelector<HTMLFormElement>('[data-track]');
const out = document.querySelector<HTMLElement>('[data-order]');
const notice = document.querySelector<HTMLElement>('[data-notice]');
const linkToken = location.hash.slice(1);
if (form && out && linkToken) {
  api<OrderView>('/orders/view', { body: { token: linkToken } })
    .then((o) => {
      const draw = (next: OrderView) => fill(out, view(next, null, draw, linkToken));
      draw(o);
    })
    .catch(() => {
      if (!notice) return;
      notice.textContent = t('track.linkExpired');
      notice.hidden = false;
    });
}
if (form && out) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const number = String(data.get('number') ?? '').trim();
    const phone = String(data.get('phone') ?? '').trim();
    const numberError = document.getElementById('t-number-e');
    const phoneError = document.getElementById('t-phone-e');
    if (numberError) numberError.textContent = number ? '' : t('checkout.required');
    if (phoneError) phoneError.textContent = phone ? '' : t('checkout.required');
    if (!number || !phone) return;
    if (notice) notice.hidden = true;
    fill(out);
    try {
      const r = await api<{ order: OrderView; token: string }>('/orders/track', {
        body: { number, phone },
      });
      const draw = (o: OrderView) => fill(out, view(o, r.token, draw));
      draw(r.order);
      offerReturn(out, r.token);
    } catch (err) {
      if (!notice) return;
      const code = err instanceof ShopError ? err.code : '';
      notice.textContent =
        code === 'rate_limited'
          ? t('track.locked')
          : code === 'validation_failed'
            ? t('checkout.badPhone')
            : code === 'not_found'
              ? t('track.notFound')
              : t('cart.error');
      notice.hidden = false;
    }
  });
}

/**
 * "Request a return" under a tracked order, while the store's window is open
 * (phase-5a-plan §3.12). The form's code loads only when it's opened.
 */
function offerReturn(out: HTMLElement, token: string) {
  api<ReturnOptions>('/returns/options', { body: { token } })
    .then((options) => {
      if (!options.open) return;
      const box = el('section', { class: 'return-box', 'aria-live': 'polite' });
      const open = el('button', {
        type: 'button',
        class: 'button secondary',
        text: t('return.request'),
      });
      open.addEventListener('click', async () => {
        open.disabled = true;
        const { mountReturnForm } = await import('./returns');
        mountReturnForm(box, token, options, cfg.locale, (number) => {
          box.replaceChildren(
            el('p', {
              class: 'notice',
              'data-kind': 'info',
              role: 'status',
              text: t('return.sent', { number }),
            }),
          );
        });
      });
      add(box, open);
      add(out, box);
    })
    .catch(() => {});
}
