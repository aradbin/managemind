// Where the shopper came from, kept only after they accept the cookie banner
// (phase-9-plan §3.1.6): Meta's click ID as its _fbc cookie when the pixel
// hasn't set one, the first landing's UTM fields and a Meta Shops checkout's
// origin, for 30 days. Checkout sends it with the order, so the server can
// tell Meta about the purchase and match it to the ad.

const KEY = 'mm_attr';
const THIRTY_DAYS = 30 * 86_400;
const UTM = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const ORIGINS = ['facebook', 'instagram', 'meta_shops'] as const;

type Origin = (typeof ORIGINS)[number];
interface Kept {
  utm?: Partial<Record<(typeof UTM)[number], string>>;
  cartOrigin?: Origin;
  at: number;
}

const cookie = (name: string): string | null =>
  new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie)?.[1] ?? null;

function read(): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Kept | null;
    return kept && Date.now() - kept.at < THIRTY_DAYS * 1000 ? kept : null;
  } catch {
    return null;
  }
}

/** After consent: what the landing URL says. The first landing's UTM fields win. */
export function captureAttribution(url: URL = new URL(location.href)): void {
  const fbclid = url.searchParams.get('fbclid');
  if (fbclid && /^[\w-]{1,500}$/.test(fbclid) && !cookie('_fbc')?.endsWith(`.${fbclid}`)) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Safari and Firefox
    document.cookie = `_fbc=fb.1.${Date.now()}.${fbclid}; Path=/; Max-Age=${90 * 86_400}; SameSite=Lax${secure}`;
  }
  const kept = read() ?? { at: Date.now() };
  const utm: Kept['utm'] = {};
  for (const k of UTM) {
    const v = url.searchParams.get(`utm_${k}`)?.trim().slice(0, 100);
    if (v) utm[k] = v;
  }
  const origin = url.searchParams.get('cart_origin');
  const next: Kept = {
    ...kept,
    ...(Object.keys(utm).length && !kept.utm ? { utm } : {}),
    ...(ORIGINS.includes(origin as Origin) ? { cartOrigin: origin as Origin } : {}),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the order goes without it.
  }
}

/** After "Reject": nothing is kept. */
export function forgetAttribution(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** What checkout sends, only with consent; undefined otherwise. */
export function attributionForCheckout() {
  if (!/(?:^|;\s*)mm_consent=granted/.test(document.cookie)) return undefined;
  const kept = read();
  const fbp = cookie('_fbp');
  const fbc = cookie('_fbc');
  return {
    ...(fbp && /^fb\.\d\.\d{10,13}\.\d{1,20}$/.test(fbp) ? { fbp } : {}),
    ...(fbc && /^fb\.\d\.\d{10,13}\.[\w-]{1,500}$/.test(fbc) ? { fbc } : {}),
    ...(kept?.utm ? { utm: kept.utm } : {}),
    ...(kept?.cartOrigin ? { cartOrigin: kept.cartOrigin } : {}),
  };
}
