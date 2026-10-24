// Test helpers for staff requests: a cookie-keeping browser stand-in and
// sign-in with the code from the captured email.
import { createHmac } from 'node:crypto';
import type pg from 'pg';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { makeCtx, makeEnv } from './support';

export const ORIGIN = 'https://admin.platform.example.test';
export const COOKIE = '__Secure-mm_staff.session_token';

/** A browser stand-in: keeps cookies between calls and sends the admin's Origin. */
export function browser(env: Env = makeEnv()) {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown, headers = {}) => {
    const ctx = makeCtx();
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await createApp().request(
      path,
      {
        method,
        headers: {
          origin: ORIGIN,
          'cf-connecting-ip': '203.0.113.7',
          ...(body === undefined || body instanceof Uint8Array
            ? {}
            : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        // Bytes go as they are (image uploads); anything else as JSON.
        ...(body === undefined
          ? {}
          : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
      },
      env,
      ctx,
    );
    await ctx.settle();
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (/max-age=0/i.test(line) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
  return {
    jar,
    call,
    post: (path: string, body: unknown = {}, headers = {}) => call('POST', path, body, headers),
    get: (path: string) => call('GET', path),
  };
}

export type Browser = ReturnType<typeof browser>;

export async function latestCode(owner: pg.Client, email: string): Promise<string> {
  const { rows } = await owner.query<{ text: string; subject: string }>(
    `select text, subject from platform.dev_emails where "to" = $1 order by created_at desc limit 1`,
    [email],
  );
  const match = rows[0]?.text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error(`no sign-in code for ${email}`);
  return match[1];
}

export async function signIn(b: Browser, owner: pg.Client, email: string) {
  expect(
    (await b.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status,
  ).toBe(200);
  return b.post('/api/auth/sign-in/email-otp', { email, otp: await latestCode(owner, email) });
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds), as authenticator apps compute it. */
export function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}

/** Sets up an authenticator for the signed-in user; returns its otpauth URI. */
export async function enrollAuthenticator(b: Browser): Promise<string> {
  const enable = await b.post('/api/auth/two-factor/enable', {});
  expect(enable.status).toBe(200);
  const { totpURI } = (await enable.json()) as { totpURI: string };
  expect((await b.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) })).status).toBe(
    200,
  );
  return totpURI;
}
