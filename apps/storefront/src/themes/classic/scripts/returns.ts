// A return request from the tracking page (phase-5a-plan §3.12, §8): the
// delivered lines and how many of each, a reason, a note and up to 3 photos.
// Loaded only when the shopper opens the form. Photos are resized in the
// browser (1600 px, JPEG), which also drops their EXIF data, uploaded by
// their SHA-256, then attached by name; Turnstile checks the request where
// the store's host runs it.
import { add, api, el, type Localized, pick, ShopError, t } from './shop';
import { type Check, mountTurnstile } from './turnstile';

export interface ReturnOptions {
  open: boolean;
  until: string | null;
  turnstileSiteKey: string | null;
  reasons: string[];
  lines: {
    orderLineId: string;
    title: Localized;
    optionLabels: Localized[];
    returnable: number;
    excluded: boolean;
  }[];
}

const MAX_SIDE = 1600;
const MAX_PHOTOS = 3;

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('resize'))), 'image/jpeg', 0.82),
  );
}

async function upload(blob: Blob, token: string): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const name = `${hash}.jpg`;
  const res = await fetch(`/api/returns/photos/${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', 'x-order-token': token },
    body: bytes,
    credentials: 'same-origin',
  });
  if (!res.ok) throw new ShopError(res.status, 'upload_failed', {});
  return name;
}

/** The form, replacing `box`'s content; `done` gets the new return's number. */
export function mountReturnForm(
  box: HTMLElement,
  token: string,
  options: ReturnOptions,
  locale: string,
  done: (number: string) => void,
): void {
  const lines = options.lines.filter((l) => l.returnable > 0 && !l.excluded);
  const form = el('form', { class: 'return-form', novalidate: true });
  const error = el('p', { class: 'notice', role: 'alert', hidden: true });
  const show = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };

  const qty = new Map<string, HTMLInputElement>();
  const items = el(
    'fieldset',
    {},
    el('legend', { text: t('return.items') }),
    ...lines.map((l, i) => {
      const input = el('input', {
        id: `r-qty-${i}`,
        type: 'number',
        min: '0',
        max: String(l.returnable),
        value: lines.length === 1 && l.returnable === 1 ? '1' : '0',
        inputmode: 'numeric',
      });
      qty.set(l.orderLineId, input);
      const name = [pick(l.title), ...l.optionLabels.map((o) => pick(o))]
        .filter(Boolean)
        .join(' — ');
      return el(
        'div',
        { class: 'field' },
        el('label', {
          for: `r-qty-${i}`,
          text: `${name} (${t('return.upTo', { count: l.returnable })})`,
        }),
        input,
      );
    }),
  );
  const excluded = options.lines.filter((l) => l.excluded);
  const reason = el(
    'select',
    { id: 'r-reason', required: true },
    el('option', { value: '', text: t('checkout.choose') }),
    ...options.reasons.map((r) => el('option', { value: r, text: t(`return.reason.${r}`) })),
  );
  const note = el('textarea', { id: 'r-note', rows: '3', maxlength: '500' });
  const photos = el('input', {
    id: 'r-photos',
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    multiple: true,
    'aria-describedby': 'r-photos-h',
  });
  const turnstileBox = el('div');
  const submit = el('button', { type: 'submit', class: 'button', text: t('return.send') });
  add(
    form,
    el('h2', { text: t('return.title') }),
    ...(options.until
      ? [
          el('p', {
            class: 'muted small',
            text: t('return.until', { date: new Date(options.until).toLocaleDateString(locale) }),
          }),
        ]
      : []),
    items,
    ...(excluded.length
      ? [
          el('p', {
            class: 'muted small',
            text: t('return.notReturnable', {
              items: excluded.map((l) => pick(l.title)).join(', '),
            }),
          }),
        ]
      : []),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'r-reason', text: t('return.reason') }),
      reason,
    ),
    el(
      'div',
      { class: 'field' },
      el(
        'label',
        { for: 'r-note' },
        t('return.note'),
        ' ',
        el('span', { class: 'muted', text: t('checkout.optional') }),
      ),
      note,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'r-photos', text: t('return.photos') }),
      photos,
      el('p', { class: 'muted small', id: 'r-photos-h', text: t('return.photosHint') }),
    ),
    turnstileBox,
    error,
    el('p', {}, submit),
  );
  let check: Check | null = null;
  if (options.turnstileSiteKey)
    check = mountTurnstile(turnstileBox, options.turnstileSiteKey, locale);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const chosen = lines
      .map((l) => ({
        orderLineId: l.orderLineId,
        quantity: Number(qty.get(l.orderLineId)?.value ?? 0),
      }))
      .filter((l) => l.quantity > 0);
    const bad = lines.some((l) => {
      const n = Number(qty.get(l.orderLineId)?.value ?? 0);
      return !Number.isInteger(n) || n < 0 || n > l.returnable;
    });
    if (bad || !chosen.length) return show(t('return.pickItems'));
    if (!reason.value) return show(t('return.pickReason'));
    const files = [...(photos.files ?? [])];
    if (files.length > MAX_PHOTOS) return show(t('return.tooManyPhotos'));
    submit.disabled = true;
    try {
      const names: string[] = [];
      for (const file of files) names.push(await upload(await shrink(file), token));
      const turnstileToken = await check?.token();
      const created = await api<{ number: string }>('/returns', {
        body: {
          token,
          reason: reason.value,
          lines: chosen,
          photos: names,
          ...(note.value.trim() ? { note: note.value.trim() } : {}),
          ...(turnstileToken ? { turnstileToken } : {}),
        },
      });
      done(created.number);
    } catch (err) {
      check?.reset();
      const code = err instanceof ShopError ? err.code : '';
      show(
        code === 'rate_limited'
          ? t('return.tooMany')
          : code === 'upload_failed'
            ? t('return.uploadFailed')
            : t('cart.error'),
      );
    } finally {
      submit.disabled = false;
    }
  });
  box.replaceChildren(form);
}
