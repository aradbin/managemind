// Order tokens (phase-4-plan §3.5, §6.1): what lets a shopper see or cancel
// their own order without an account. `view` comes with the placed order
// (24 hours, in the confirmation page's fragment, so it never reaches a log);
// `track` comes from tracking by number and phone (1 hour) and also allows
// cancelling. `pay` is a payment link from staff (phase-5a-plan §3.3, 3
// days): it shows the order and pays it, and can't cancel. HMAC-SHA-256 over the purpose, the store, the order and the
// expiry: a token of one store or purpose is worthless in another.

export const ORDER_TOKEN_TTL_SECONDS = {
  view: 24 * 3600,
  track: 3600,
  pay: 3 * 24 * 3600,
} as const;
export type OrderTokenPurpose = keyof typeof ORDER_TOKEN_TTL_SECONDS;

const encoder = new TextEncoder();
const base64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`order:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** `<orderId>.<expiry in unix seconds>.<signature>` */
export async function signOrderToken(
  purpose: OrderTokenPurpose,
  tenantId: string,
  orderId: string,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + ORDER_TOKEN_TTL_SECONDS[purpose];
  return `${orderId}.${exp}.${await hmac(secret, `${purpose}.${tenantId}.${orderId}.${exp}`)}`;
}

/** The token's order, if it is this store's, of this purpose, and not expired. */
export async function verifyOrderToken(
  purpose: OrderTokenPurpose,
  tenantId: string,
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<string | null> {
  const match = /^([0-9a-f-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, orderId, exp, signature] = match as unknown as [string, string, string, string];
  if (Number(exp) * 1000 <= now.getTime()) return null;
  const expected = await hmac(secret, `${purpose}.${tenantId}.${orderId}.${exp}`);
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0 ? orderId : null;
}
