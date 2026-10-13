// Staff sign-in end to end against the test database (phase-1-plan §3.4,
// §5.5): email codes, sessions and cookies, the 2FA challenge on code
// sign-ins (Plan A), rate limits and the CSRF checks.
import { createHmac } from 'node:crypto';
import { connect } from '@managemind/db/testing';
import { twoFactor } from 'better-auth/plugins';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiPath, createApp } from '../src/app';
import { emailFrom } from '../src/auth/email';
import {
  capPlatformExpiry,
  challengeEmailCodeSignIns,
  createStaffAuth,
  PLATFORM_SESSION_SECONDS,
} from '../src/auth/staff';
import { apiConfig, type Env } from '../src/env';
import { makeCtx, makeEnv, ownerUrl } from './support';

const ORIGIN = 'https://admin.platform.example.test';
const COOKIE = '__Secure-mm_staff.session_token';

let owner: pg.Client;
beforeAll(async () => {
  owner = await connect(ownerUrl);
});
afterAll(() => owner.end());

let seq = 0;
async function staffUser(opts: { platformRole?: string; locale?: string } = {}): Promise<string> {
  const email = `staff-${Date.now()}-${seq++}@example.test`;
  await owner.query(
    `insert into platform.users (name, email, email_verified, platform_role, locale)
     values ('Test Staff', $1, true, $2, $3)`,
    [email, opts.platformRole ?? null, opts.locale ?? 'en'],
  );
  return email;
}

/** A browser stand-in: keeps cookies between calls and sends the admin's Origin. */
function browser(env: Env = makeEnv()) {
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

type SessionBody = { user: { email: string; twoFactorEnabled: boolean; locale: string } } | null;

const sessionOf = async (b: ReturnType<typeof browser>) =>
  (await (await b.get('/api/auth/get-session')).json()) as SessionBody;

async function latestCode(email: string): Promise<string> {
  const { rows } = await owner.query<{ text: string; subject: string }>(
    `select text, subject from platform.dev_emails where "to" = $1 order by created_at desc limit 1`,
    [email],
  );
  const match = rows[0]?.text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error(`no sign-in code for ${email}`);
  return match[1];
}

async function signIn(b: ReturnType<typeof browser>, email: string) {
  expect(
    (await b.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status,
  ).toBe(200);
  return b.post('/api/auth/sign-in/email-otp', { email, otp: await latestCode(email) });
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds), as authenticator apps compute it. */
function totp(uri: string, at = Date.now()): string {
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

describe('staff auth configuration', () => {
  const auth = createStaffAuth({
    db: {} as never,
    secret: 'x'.repeat(40),
    origin: ORIGIN,
    appName: 'managemind',
    sendCode: () => {},
  });

  it('keeps the cookie cache off, sign-up off and roles out of reach (ADR 0005)', () => {
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
    expect(auth.options.emailAndPassword?.enabled).toBe(false);
    expect(auth.options.rateLimit?.enabled).toBe(false);
    expect(auth.options.user?.additionalFields?.platformRole?.input).toBe(false);
    expect(auth.options.user?.additionalFields?.locale?.input).toBe(false);
    const otp = auth.options.plugins?.find((p) => p.id === 'email-otp') as {
      options?: { disableSignUp?: boolean; storeOTP?: string };
    };
    expect(otp.options).toMatchObject({ disableSignUp: true, storeOTP: 'hashed' });
  });

  it('extends the twoFactor sign-in challenge to email codes, and notices if the plugin changes', () => {
    const plugin = challengeEmailCodeSignIns(twoFactor({ allowPasswordless: true }));
    const [hook] = plugin.hooks.after;
    const matches = (path: string) => hook?.matcher({ path } as never);
    expect(matches('/sign-in/email-otp')).toBe(true);
    expect(matches('/sign-in/email')).toBe(true);
    expect(matches('/get-session')).toBe(false);
    const changed = twoFactor();
    changed.hooks.after.push(changed.hooks.after[0] as never);
    expect(() => challengeEmailCodeSignIns(changed)).toThrow(/changed shape/);
  });

  it('caps platform sessions at 12 hours after sign-in', () => {
    const created = new Date('2026-10-13T00:00:00Z');
    const week = new Date('2026-10-20T00:00:00Z');
    expect(capPlatformExpiry(week, created, null)).toEqual(week);
    expect(capPlatformExpiry(week, created, 'support')).toEqual(
      new Date(created.getTime() + PLATFORM_SESSION_SECONDS * 1000),
    );
  });

  it('maps the admin host paths onto the API', () => {
    expect(apiPath('/api/admin/me')).toBe('/v1/admin/me');
    expect(apiPath('/api/platform')).toBe('/v1/platform');
    expect(apiPath('/api/auth/get-session')).toBe('/api/auth/get-session');
    expect(apiPath('/api/administrator')).toBe('/api/administrator');
  });
});

describe('auth and email settings', () => {
  const base = {
    PLATFORM_NAME: 'managemind',
    PLATFORM_DOMAIN: 'example.test',
    STORE_DOMAIN: 'example.test',
  };
  const problems = (env: Record<string, string>) => {
    const r = apiConfig.safeParse({ ...base, ...env });
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };
  const secret = 'y'.repeat(44);

  it('needs the real secret, the admin host and Resend in production', () => {
    expect(problems({ ENVIRONMENT: 'production' })).toEqual(
      expect.arrayContaining(['AUTH_SECRET', 'ADMIN_HOST', 'EMAIL_PROVIDER']),
    );
    expect(
      problems({
        ENVIRONMENT: 'production',
        AUTH_SECRET: secret,
        ADMIN_HOST: 'admin.example.test',
        EMAIL_PROVIDER: 'resend',
      }),
    ).toEqual(['RESEND_API_KEY']);
    expect(
      problems({ ENVIRONMENT: 'preview', AUTH_SECRET: 'short', ADMIN_HOST: 'a.example.test' }),
    ).toEqual(['AUTH_SECRET']);
  });

  it('works locally with no setup, sending from no-reply at the platform domain', () => {
    const config = apiConfig.parse({ ...base, ENVIRONMENT: 'development' });
    expect(config.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(config.EMAIL_PROVIDER).toBe('capture');
    expect(emailFrom(config)).toBe('managemind <no-reply@example.test>');
    expect(emailFrom({ ...config, EMAIL_FROM: 'Support <help@example.test>' })).toBe(
      'Support <help@example.test>',
    );
  });
});

describe('POST /api/auth: email codes', () => {
  it('signs in with a code from the email and sets a host-only secure cookie', async () => {
    const email = await staffUser({ locale: 'en' });
    const b = browser();
    const res = await signIn(b, email);
    expect(res.status).toBe(200);

    const cookie = res.headers.getSetCookie().find((l) => l.startsWith(`${COOKIE}=`)) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);

    const session = await sessionOf(b);
    expect(session?.user).toMatchObject({ email, twoFactorEnabled: false, locale: 'en' });

    // The email: sent from the platform's no-reply address, no code in the subject.
    const { rows } = await owner.query<{ subject: string }>(
      `select subject from platform.dev_emails where "to" = $1`,
      [email],
    );
    expect(rows[0]?.subject).toBe('Your managemind sign-in code');
  });

  it('answers the same for unknown emails and sends them nothing', async () => {
    const known = await staffUser();
    const unknown = `nobody-${Date.now()}@example.test`;
    const send = (email: string) =>
      browser().post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    const [a, b] = [await send(known), await send(unknown)];
    expect(b.status).toBe(a.status);
    expect(await b.json()).toEqual(await a.json());
    expect([...b.headers.keys()].filter((k) => k !== 'x-request-id').sort()).toEqual(
      [...a.headers.keys()].filter((k) => k !== 'x-request-id').sort(),
    );
    const { rows } = await owner.query(`select 1 from platform.dev_emails where "to" = $1`, [
      unknown,
    ]);
    expect(rows).toHaveLength(0);
    // No user is created for an unknown email (sign-up is off).
    const code = '123456';
    const res = await browser().post('/api/auth/sign-in/email-otp', { email: unknown, otp: code });
    expect(res.status).toBe(400);
    const users = await owner.query(`select 1 from platform.users where email = $1`, [unknown]);
    expect(users.rows).toHaveLength(0);
  });

  it('rejects a wrong code, and a code from another origin', async () => {
    const email = await staffUser();
    const b = browser();
    await b.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    const wrong = await b.post('/api/auth/sign-in/email-otp', { email, otp: '000000' });
    expect(wrong.status).toBe(400);
    const otp = await latestCode(email);
    const evil = await b.post(
      '/api/auth/sign-in/email-otp',
      { email, otp },
      { origin: 'https://evil.example' },
    );
    expect(evil.status).toBe(403);
    expect(b.jar.has(COOKIE)).toBe(false);
  });

  it('exposes only the endpoints the admin uses', async () => {
    const b = browser();
    expect((await b.get('/api/auth/ok')).status).toBe(404);
    expect((await b.post('/api/auth/sign-up/email', { email: 'a@example.test' })).status).toBe(404);
    expect((await b.post('/api/auth/update-user', { name: 'x' })).status).toBe(404);
    expect((await b.post('/api/auth/delete-user', {})).status).toBe(404);
    expect((await b.get('/api/auth/get-session')).status).toBe(200);
  });

  it('describes the auth endpoints in the OpenAPI document', async () => {
    const doc = (await (await browser().get('/openapi.json')).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(doc.paths['/api/auth/sign-in/email-otp']).toHaveProperty('post');
    expect(doc.paths['/api/auth/get-session']).toHaveProperty('get');
    expect(doc.paths['/api/auth/sign-up/email']).toBeUndefined();
  });

  it('signs out and lists sessions', async () => {
    const email = await staffUser();
    const b = browser();
    await signIn(b, email);
    const sessions = await (await b.get('/api/auth/list-sessions')).json();
    expect(sessions).toHaveLength(1);
    expect((await b.post('/api/auth/sign-out')).status).toBe(200);
    expect(await sessionOf(b)).toBeNull();
  });
});

describe('rate limits', () => {
  it('allows 3 codes per email per 10 minutes', async () => {
    const env = makeEnv();
    const email = await staffUser();
    const send = () =>
      browser(env).post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    const refused = await send();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('locks an email after 10 failed code checks', async () => {
    const env = makeEnv();
    const email = await staffUser();
    const b = browser(env);
    for (let i = 0; i < 10; i++) {
      expect((await b.post('/api/auth/sign-in/email-otp', { email, otp: '000000' })).status).toBe(
        400,
      );
    }
    expect((await b.post('/api/auth/sign-in/email-otp', { email, otp: '000000' })).status).toBe(
      429,
    );
  });
});

describe('two-factor login on email codes (Plan A)', () => {
  async function enrolled() {
    const env = makeEnv();
    const email = await staffUser();
    const b = browser(env);
    await signIn(b, email);
    const enable = await b.post('/api/auth/two-factor/enable', {});
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(backupCodes.length).toBeGreaterThan(0);
    expect((await b.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) })).status).toBe(
      200,
    );
    const me = await sessionOf(b);
    expect(me?.user.twoFactorEnabled).toBe(true);
    return { env, email, totpURI, backupCodes };
  }

  it('creates no session until the authenticator code is checked', async () => {
    const { env, email, totpURI } = await enrolled();
    const b = browser(env);
    const res = await signIn(b, email);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    expect(b.jar.has(COOKIE)).toBe(false);
    expect(await sessionOf(b)).toBeNull();

    expect((await b.post('/api/auth/two-factor/verify-totp', { code: '000000' })).status).toBe(401);
    expect(b.jar.has(COOKIE)).toBe(false);
    const ok = await b.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) });
    expect(ok.status).toBe(200);
    expect((await sessionOf(b))?.user.email).toBe(email);
  });

  it('accepts a backup code instead', async () => {
    const { env, email, backupCodes } = await enrolled();
    const b = browser(env);
    await signIn(b, email);
    const res = await b.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] });
    expect(res.status).toBe(200);
    expect(b.jar.has(COOKIE)).toBe(true);
  });

  it('never asks twice on a trusted device', async () => {
    const { env, email, totpURI } = await enrolled();
    const b = browser(env);
    await signIn(b, email);
    await b.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI), trustDevice: true });
    await b.post('/api/auth/sign-out');
    const again = await signIn(b, email);
    expect(await again.json()).not.toHaveProperty('twoFactorRedirect');
    expect((await sessionOf(b))?.user.email).toBe(email);
  });

  it('signs the user out everywhere when 2FA is turned on', async () => {
    const env = makeEnv();
    const email = await staffUser();
    const phone = browser(env);
    const laptop = browser(env);
    await signIn(phone, email);
    await signIn(laptop, email);
    const { totpURI } = (await (await laptop.post('/api/auth/two-factor/enable', {})).json()) as {
      totpURI: string;
    };
    await laptop.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) });
    expect(await sessionOf(phone)).toBeNull();
    expect(await sessionOf(laptop)).not.toBeNull();
  });

  it('limits authenticator code checks per user', async () => {
    const { env, email } = await enrolled();
    const statuses: number[] = [];
    for (let i = 0; i < 2; i++) {
      // A fresh challenge each time: the limit follows the user, not the challenge.
      const b = browser(env);
      await signIn(b, email);
      for (let j = 0; j < 3; j++) {
        statuses.push(
          (await b.post('/api/auth/two-factor/verify-totp', { code: '000000' })).status,
        );
      }
    }
    // 5 checks per 15 minutes, counting the one made while enrolling.
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
  });
});

describe('sessions', () => {
  it('gives platform users at most 12 hours, even when refreshed', async () => {
    const email = await staffUser({ platformRole: 'super_admin' });
    const b = browser();
    await signIn(b, email);
    const hours = async () => {
      const { rows } = await owner.query<{ hours: number }>(
        `select extract(epoch from s.expires_at - s.created_at) / 3600 as hours
           from platform.sessions s join platform.users u on u.id = s.user_id where u.email = $1`,
        [email],
      );
      return Number(rows[0]?.hours);
    };
    expect(await hours()).toBeCloseTo(12, 1);

    // Due for a refresh: Better Auth would extend it to 7 days from now.
    await owner.query(
      `update platform.sessions s set created_at = now() - interval '11 hours',
              expires_at = now() + interval '1 hour'
         from platform.users u where u.id = s.user_id and u.email = $1`,
      [email],
    );
    expect((await b.get('/api/auth/get-session')).status).toBe(200);
    expect(await hours()).toBeCloseTo(12, 1);
  });

  it('gives store staff 7 days', async () => {
    const email = await staffUser();
    await signIn(browser(), email);
    const { rows } = await owner.query<{ days: number }>(
      `select extract(epoch from s.expires_at - s.created_at) / 86400 as days
         from platform.sessions s join platform.users u on u.id = s.user_id where u.email = $1`,
      [email],
    );
    expect(Number(rows[0]?.days)).toBeCloseTo(7, 1);
  });
});

describe('CSRF on /api/admin and /api/platform', () => {
  const b = browser();
  it('refuses writes from another origin or without JSON', async () => {
    expect((await b.post('/api/admin/me', {}, { origin: 'https://evil.example' })).status).toBe(
      403,
    );
    const form = await b.call('POST', '/api/platform/tenants', undefined, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(404); // no body: nothing a form could smuggle
    const text = await createApp().request(
      '/api/admin/me',
      { method: 'PATCH', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: 'x' },
      makeEnv(),
      makeCtx(),
    );
    expect(text.status).toBe(403);
  });

  it('lets JSON writes from the admin and all reads through to the routes', async () => {
    expect((await b.post('/api/admin/me', {})).status).toBe(404);
    expect((await b.get('/api/platform/tenants')).status).toBe(404);
  });
});
