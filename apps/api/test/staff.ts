// Test helpers for staff requests: a cookie-keeping browser stand-in and
// sign-in with the code from the captured email.
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
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
