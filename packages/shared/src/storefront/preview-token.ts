// Theme preview tokens (phase-3-plan §3.4): short-lived, signed by the API,
// passed by the storefront back to the API, which returns the draft theme.
// HMAC-SHA-256 over `<tenantId>.<expiry>` with Web Crypto, so it runs in
// Workers and Node alike. The token only unlocks the draft of one store.

export const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

const encoder = new TextEncoder();

const base64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`preview:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** `<tenantId>.<expiry in unix seconds>.<signature>` */
export async function signPreviewToken(
  tenantId: string,
  secret: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(now.getTime() / 1000) + PREVIEW_TOKEN_TTL_SECONDS;
  const payload = `${tenantId}.${exp}`;
  return {
    token: `${payload}.${await hmac(secret, payload)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** The token's store, if the signature holds and it hasn't expired; null otherwise. */
export async function verifyPreviewToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<string | null> {
  const match = /^([0-9a-f-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, tenantId, exp, signature] = match as unknown as [string, string, string, string];
  if (Number(exp) * 1000 <= now.getTime()) return null;
  const expected = await hmac(secret, `${tenantId}.${exp}`);
  // Constant-time comparison of equal-length strings.
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0 ? tenantId : null;
}
