import { describe, expect, it } from 'vitest';
import {
  encryptPush,
  fromBase64Url,
  generateVapidKeys,
  importSenderKeys,
  sendPush,
  toBase64Url,
  vapidAuthorization,
} from './index';

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

describe('web push encryption (RFC 8291)', () => {
  it('matches the RFC test vector byte for byte', async () => {
    const body = await encryptPush(
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      fromBase64Url(RFC.plaintext),
      {
        salt: fromBase64Url(RFC.salt),
        sender: await importSenderKeys(RFC.asPublic, RFC.asPrivate),
      },
    );
    const header = fromBase64Url(RFC.header);
    expect(toBase64Url(body.slice(0, header.length))).toBe(RFC.header);
    expect(toBase64Url(body.slice(header.length))).toBe(RFC.ciphertext);
  });

  it('uses a fresh salt and key for every message', async () => {
    const a = await encryptPush({ p256dh: RFC.uaPublic, auth: RFC.auth }, new Uint8Array([1]));
    const b = await encryptPush({ p256dh: RFC.uaPublic, auth: RFC.auth }, new Uint8Array([1]));
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service that verifies with the public key', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:ops@example.test' };
    const now = Date.UTC(2026, 9, 18);
    const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, now);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth);
    expect(match).not.toBeNull();
    const [, header, claims, signature, k] = match as unknown as string[];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims as string)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'mailto:ops@example.test',
    });
    const publicKey = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64Url(signature as string),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });
});

describe('sending', () => {
  const subscription = {
    endpoint: 'https://push.example.test/x',
    p256dh: RFC.uaPublic,
    auth: RFC.auth,
  };
  const message = { title: 'New order #1001', body: '৳600', url: '/orders/1' };

  it('reports a gone subscription, and which failures to retry', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:ops@example.test' };
    const answer =
      (status: number): typeof fetch =>
      async () =>
        new Response(null, { status });
    expect(await sendPush(subscription, message, keys, answer(201))).toBe('sent');
    expect(await sendPush(subscription, message, keys, answer(410))).toBe('gone');
    expect(await sendPush(subscription, message, keys, answer(503))).toMatchObject({
      retryable: true,
    });
    expect(await sendPush(subscription, message, keys, answer(400))).toMatchObject({
      retryable: false,
    });
  });
});
