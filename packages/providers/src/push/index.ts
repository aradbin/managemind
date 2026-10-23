// Web Push for staff alerts (phase-5a-plan §3.9, Q14): the message encrypted
// for one browser subscription (RFC 8291, aes128gcm) and signed with the
// platform's VAPID key (RFC 8292), all through Web Crypto. Push services
// (Google, Mozilla, Apple) are free; a 404 or 410 means the subscription is
// gone and should be deleted.

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, base64url, uncompressed (65 bytes). */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** Base64url, uncompressed P-256 point (65 bytes); the admin subscribes with it. */
  publicKey: string;
  /** Base64url, the private scalar (32 bytes). */
  privateKey: string;
  /** A contact for push services: "mailto:…" or an https URL. */
  subject: string;
}

const encoder = new TextEncoder();
/** UTF-8 bytes on their own ArrayBuffer, as Web Crypto's types want. */
const utf8 = (text: string) => new Uint8Array(encoder.encode(text));

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** A private P-256 key as a JWK, from the raw scalar and the uncompressed public point. */
function privateJwk(publicKey: Uint8Array, privateKey: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4)
    throw new Error('not an uncompressed P-256 point');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33, 65)),
    d: toBase64Url(privateKey),
  };
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** The application server's one-off key pair; tests pass RFC 8291's fixed one. */
export interface SenderKeys {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: CryptoKey;
}

async function newSenderKeys(): Promise<SenderKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  );
  return { publicKey, privateKey: pair.privateKey };
}

/** RFC 8291's test vector keys, imported for the test. */
export async function importSenderKeys(publicKey: string, privateKey: string): Promise<SenderKeys> {
  const pub = fromBase64Url(publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(pub, fromBase64Url(privateKey)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  return { publicKey: pub, privateKey: key };
}

/**
 * The aes128gcm body for one subscription (RFC 8291 §3, RFC 8188): a header
 * of salt, record size and the sender's public key, then one record holding
 * the payload and its 0x02 delimiter.
 */
export async function encryptPush(
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  payload: Uint8Array<ArrayBuffer>,
  options: { salt?: Uint8Array<ArrayBuffer>; sender?: SenderKeys } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = options.sender ?? (await newSenderKeys());

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // The Web Crypto spec calls the field `public`; Workers' types spell it `$public`.
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      sender.privateKey,
      256,
    ),
  );
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, sender.publicKey);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aes,
      concat(payload, new Uint8Array([2])),
    ),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = sender.publicKey.length;
  return concat(header, sender.publicKey, ciphertext);
}

/** The Authorization header for a push service (RFC 8292): a JWT signed with ES256. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): Promise<string> {
  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        // Push services accept at most 24 hours.
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(fromBase64Url(keys.publicKey), fromBase64Url(keys.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // Web Crypto's ECDSA signature is r || s, which is what JWS wants.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

export type PushResult = 'sent' | 'gone' | { error: string; retryable: boolean };

/** Sends one message to one subscription. */
export async function sendPush(
  subscription: PushSubscriptionKeys,
  message: { title: string; body: string; url: string; tag?: string },
  keys: VapidKeys,
  f: typeof fetch = fetch,
): Promise<PushResult> {
  const body = await encryptPush(subscription, utf8(JSON.stringify(message)));
  let res: Response;
  try {
    res = await f(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(subscription.endpoint, keys),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        // A new order is worth a day of retries by the push service, not more.
        ttl: '86400',
        urgency: 'high',
      },
      body,
    });
  } catch (e) {
    return { error: String(e), retryable: true };
  }
  if (res.status === 404 || res.status === 410) return 'gone';
  if (res.ok) return 'sent';
  return {
    error: `push service answered ${res.status}`,
    retryable: res.status >= 500 || res.status === 429,
  };
}

/** A new VAPID key pair, for the owner's one-time setup. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: toBase64Url(raw), privateKey: jwk.d as string };
}
