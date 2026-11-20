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

/**
 * Where the order is, as five steps (design/storefront-redesign: Track):
 * placed, confirmed, prepared, on the way, delivered. 0-based index of the
 * current step; 5 when delivered, -1 when cancelled.
 */
function stage(o: OrderView): number {
  if (o.status === 'cancelled') return -1;
  if (o.deliveryStatus === 'delivered') return 5;
  if (o.deliveryStatus === 'shipped' || o.deliveryStatus === 'partially_shipped') return 3;
  if (o.status === 'confirmed' || o.status === 'processing' || o.status === 'completed') return 2;
  return 1;
}

/** One headline: the order's status until it leaves, then the parcel's. */
function headline(o: OrderView, at: number): string {
  if (at < 0) return t('status.cancelled');
  if (o.deliveryStatus === 'failed') return t('delivery.failed');
  return (
    [
      t('step.placed'),
      t('track.waiting'),
      t('step.prepared'),
      t('step.onTheWay'),
      '',
      t('step.delivered'),
    ][at] ?? ''
  );
}

function progress(at: number): HTMLElement {
  const steps: [string, string][] = [
    [t('step.placed'), ''],
    [t('step.confirmed'), at <= 1 ? t('step.waitingNote') : t('step.confirmedNote')],
    [t('step.prepared'), t('step.preparedNote')],
    [t('step.onTheWay'), t('step.onTheWayNote')],
    [t('step.delivered'), at === 5 ? '' : t('step.deliveredNote')],
  ];
  return el(
    'ol',
    { class: 'steps' },
    ...steps.map(([label, note], i) => {
      const state = i < at || at === 5 ? 'done' : i === at ? 'now' : 'todo';
      return el(
        'li',
        { class: state, 'aria-current': state === 'now' ? 'step' : undefined },
        el('span', { class: 'step-dot', 'aria-hidden': 'true' }),
        el(
          'span',
          {},
          el('strong', { text: label }),
          state === 'now'
            ? el('span', { class: 'visually-hidden', text: ` ${t('track.currentStep')}` })
            : null,
          note ? el('span', { class: 'hint', text: note }) : null,
        ),
      );
    }),
  );
}

function view(
  o: OrderView,
  cancelToken: string | null,
  onChange: (o: OrderView) => void,
  /** Pays with the view token on the confirmation, with the track token on tracking. */
  payToken: string | null = cancelToken,
): HTMLElement {
  const at = stage(o);
  const fee = o.totals.deliveryFee - o.totals.deliveryDiscount;
  const main = el(
    'section',
    { class: 'track-card' },
    el(
      'div',
      { class: 'order-head' },
      el('h2', { text: t('track.orderNumber', { number: o.displayNumber }) }),
    ),
  );
  const body = el(
    'div',
    { class: 'track-body' },
    el('p', { class: 'track-status', text: headline(o, at) }),
    at >= 0
      ? progress(at)
      : el('p', { class: 'notice', role: 'status', text: t('track.cancelled') }),
  );
  if (o.shipments.length) {
    add(
      body,
      el('h3', { text: t('track.shipments') }),
      ...o.shipments.map((sh) =>
        el(
          'div',
          { class: 'parcel' },
          el(
            'div',
            { class: 'parcel-head' },
            el(
              'span',
              {},
              el('strong', { text: t(`shipment.${sh.status}`) }),
              el('span', {
                class: 'hint',
                text: [sh.carrier, sh.trackingNumber].filter(Boolean).join(' · '),
              }),
            ),
            sh.trackingUrl
              ? el('a', {
                  class: 'button outline-primary',
                  href: sh.trackingUrl,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  text: t('track.courier'),
                })
              : null,
          ),
          sh.events?.length ? courierEvents(sh.events) : null,
        ),
      ),
    );
  }
  add(
    body,
    el('h3', { text: t('thanks.items') }),
    el(
      'dl',
      { class: 'totals track-items' },
      ...o.lines.map((l) =>
        row(
          `${[pick(l.title), ...l.optionLabels.map(pick)].filter(Boolean).join(' · ')} × ${digits(String(l.quantity))}`,
          money(l.total),
        ),
      ),
      ...o.adjustments
        .filter((a) => a.target !== 'delivery')
        .map((a) =>
          row(pick(a.title) || t('cart.discount'), `−${money(a.amount)}`, 'row discount'),
        ),
      row(t('cart.delivery'), fee === 0 && o.totals.deliveryFee > 0 ? t('cart.free') : money(fee)),
      row(t('cart.total'), money(o.totals.total), 'row total'),
    ),
  );
  add(main, body);

  const side = el('div', { class: 'track-side' });
  const facts = el('section', { class: 'track-card track-facts' });
  const payment =
    o.totals.codDue > 0
      ? t('track.payCod', { amount: money(o.totals.codDue) })
      : o.onlineDue > 0
        ? t('pay.due', { amount: money(o.onlineDue) })
        : t('track.paid', { amount: money(o.totals.total) });
  add(facts, el('p', { class: 'hint', text: t('track.payment') }), el('p', { text: payment }));
  if (o.address) {
    const n = o.address.names;
    add(
      facts,
      el('p', { class: 'hint', text: t('track.deliveringTo') }),
      el('p', {
        text: [o.contact.name, o.address.line, pick(n.area), pick(n.district)]
          .filter(Boolean)
          .join(', '),
      }),
    );
  }
  add(side, facts);
  if (o.onlineDue > 0 && payToken) {
    const pay = el('button', {
      type: 'button',
      class: 'button wide',
      text: t('pay.now', { amount: money(o.onlineDue) }),
    });
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
    add(side, pay);
  }
  if (cfg.whatsapp) {
    add(
      side,
      el('a', {
        class: 'button order-wa wide',
        href: `https://wa.me/${cfg.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`${t('track.orderNumber', { number: o.displayNumber })}`)}`,
        target: '_blank',
        rel: 'noopener',
        text: t('track.whatsapp'),
      }),
    );
  }
  if (o.cancellable && cancelToken) {
    const button = el('button', {
      type: 'button',
      class: 'button outline-primary wide',
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
    add(side, button);
  }
  add(
    side,
    el('p', { class: 'another' }, el('a', { href: cfg.links.track, text: t('track.another') })),
  );
  return el('div', { class: 'order-view track-grid' }, main, side);
}

// The confirmation page (design/storefront-redesign: Thanks): the order
// number with Copy, what to pay and when, what was ordered and where it goes,
// Continue shopping and Track your order, and signing in for next time.
const card = (title: string, ...children: (Node | null)[]) =>
  el('section', { class: 'thanks-card' }, el('h2', { text: title }), ...children);

function payBox(o: OrderView, token: string): HTMLElement {
  if (o.onlineDue > 0) {
    const amount = money(o.onlineDue);
    const pay = el('button', { type: 'button', class: 'button', text: t('pay.now', { amount }) });
    pay.addEventListener('click', async () => {
      pay.disabled = true;
      try {
        const { url } = await api<{ url: string }>('/payments/retry', { body: { token } });
        location.assign(url);
      } catch {
        pay.disabled = false;
        alert(t('cart.error'));
      }
    });
    return el(
      'div',
      { class: 'pay-box due' },
      el('p', { class: 'pay-box-title', text: t('pay.due', { amount }) }),
      el('p', {}, pay),
    );
  }
  const total = o.totals.total;
  const due = o.totals.codDue;
  const title =
    o.status === 'cancelled'
      ? t('track.cancelled')
      : due === 0
        ? t('pay.paid')
        : due < total
          ? t('thanks.advancePaid', { amount: money(due) })
          : t('thanks.cod', { amount: money(due) });
  return el(
    'div',
    { class: 'pay-box' },
    el('p', { class: 'pay-box-title', text: title }),
    el('p', { text: t('thanks.next') }),
  );
}

function thanksView(o: OrderView, token: string): HTMLElement[] {
  const copy = el('button', {
    type: 'button',
    class: 'copy',
    'aria-label': t('thanks.copyNumber'),
    text: t('thanks.copy'),
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(o.displayNumber);
      copy.textContent = t('thanks.copied');
      setTimeout(() => {
        copy.textContent = t('thanks.copy');
      }, 2000);
    } catch {
      // No clipboard (an old browser or no permission): the number is on screen.
    }
  });
  const number = el(
    'div',
    { class: 'order-number' },
    el(
      'span',
      {},
      el('span', { class: 'hint', text: t('thanks.number') }),
      el('strong', { text: o.displayNumber }),
    ),
    copy,
  );
  const fee = o.totals.deliveryFee - o.totals.deliveryDiscount;
  const items = card(
    t('thanks.items'),
    el(
      'ul',
      { class: 'thanks-lines', role: 'list' },
      ...o.lines.map((l) => {
        const src = imageUrl(l.image, 160);
        return el(
          'li',
          {},
          el(
            'span',
            { class: 'mini-media' },
            src ? el('img', { src, alt: '', width: '52', height: '52', loading: 'lazy' }) : null,
          ),
          el(
            'span',
            { class: 'mini-name' },
            el('span', { text: pick(l.title) }),
            el('span', {
              class: 'hint',
              text: [...l.optionLabels.map(pick), digits(String(l.quantity))]
                .filter(Boolean)
                .join(' · '),
            }),
          ),
          el('span', { class: 'mini-total', text: money(l.total) }),
        );
      }),
    ),
    el(
      'dl',
      { class: 'totals' },
      ...o.adjustments
        .filter((a) => a.target !== 'delivery')
        .map((a) =>
          row(pick(a.title) || t('cart.discount'), `−${money(a.amount)}`, 'row discount'),
        ),
      row(t('cart.delivery'), fee === 0 && o.totals.deliveryFee > 0 ? t('cart.free') : money(fee)),
      row(t('cart.total'), money(o.totals.total), 'row total'),
    ),
  );
  const n = o.address?.names;
  const address = o.address
    ? card(
        t('thanks.deliverTo'),
        el('p', { text: `${o.contact.name} · ${digits(o.contact.phone.replace(/^\+88/, ''))}` }),
        el('p', { text: o.address.line }),
        el('p', { text: n ? [pick(n.area), pick(n.district)].filter(Boolean).join(', ') : '' }),
      )
    : null;
  const actions = el(
    'div',
    { class: 'thanks-actions' },
    el('a', { class: 'button wide', href: cfg.links.home, text: t('cart.continue') }),
    el('a', {
      class: 'button outline-primary wide',
      href: cfg.links.track,
      text: t('track.title'),
    }),
    cfg.shop.accounts
      ? el(
          'section',
          { class: 'thanks-card save-card' },
          el('h2', { text: t('thanks.saveTitle') }),
          el('p', { class: 'hint', text: t('thanks.saveText') }),
          el('a', {
            class: 'button outline-primary wide',
            href: cfg.links.account,
            text: t('thanks.saveAction'),
          }),
        )
      : null,
  );
  return [
    number,
    el(
      'div',
      { class: 'thanks-grid' },
      el('div', { class: 'thanks-main' }, payBox(o, token), items, address),
      actions,
    ),
  ];
}

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
          ...(result && payment !== 'paid'
            ? [el('p', { class: 'notice', 'data-kind': 'error', role: 'status', text: result })]
            : []),
          ...thanksView(o, token),
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
      // The order takes the form's place; "Track another order" brings it back.
      form.hidden = true;
      document.querySelector<HTMLElement>('[data-track-intro]')?.setAttribute('hidden', '');
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
