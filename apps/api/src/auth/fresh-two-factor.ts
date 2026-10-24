// A fresh authenticator code on the request itself (phase-5b-plan §3.17):
// closing and purging a store ask for one, on top of the two-factor login
// every platform route already needs. The code is checked against the
// user's Better Auth TOTP secret exactly as its verify-totp endpoint does
// (RFC 6238: HMAC-SHA1, 6 digits, 30 seconds, one step either side), with
// the same rate limit, and nothing is signed in.
import { createDb, schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { symmetricDecrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { StaffEnv } from '../admin/context';
import { log } from '../log';
import { createLimiter } from '../rate-limit/index';
import { adminOrigin } from './routes';
import { createStaffAuth } from './staff';

const PERIOD_MS = 30_000;

async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(counter), false);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const value =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(value % 1_000_000).padStart(6, '0');
}

/** Constant time for a 6-digit code: every candidate is compared in full. */
export async function verifyTotp(secret: string, code: string, at = Date.now()): Promise<boolean> {
  const counter = Math.floor(at / PERIOD_MS);
  let matched = false;
  for (let i = -1; i <= 1; i++) {
    const expected = await hotp(secret, counter + i);
    let diff = code.length ^ expected.length;
    for (let j = 0; j < expected.length; j++) {
      diff |= code.charCodeAt(j) ^ expected.charCodeAt(j);
    }
    matched = diff === 0 || matched;
  }
  return matched;
}

/** Throws `two_factor_required` unless `code` is the user's current authenticator code. */
export async function requireFreshTwoFactor(
  c: Context<StaffEnv>,
  code: string | undefined,
): Promise<void> {
  const { user, client } = c.var.staff;
  const limiter = createLimiter(c.env.RATE_LIMITER, (e) =>
    log('error', 'rate limiter unavailable', { request_id: c.var.requestId, error: String(e) }),
  );
  const key = `user:${user.id}`; // the same limit as sign-in's challenge
  await limiter.check('2fa-verify:user', key);
  const refuse = () =>
    new AppError('two_factor_required', { detail: 'enter the code from your authenticator app' });
  if (!code || !/^\d{6}$/.test(code)) throw refuse();
  const db = createDb(client);
  const [row] = await db
    .select({ secret: schema.twoFactors.secret, verified: schema.twoFactors.verified })
    .from(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, user.id));
  if (!row?.verified) throw refuse();
  const auth = createStaffAuth({
    db,
    secret: c.var.config.AUTH_SECRET,
    origin: adminOrigin(c as unknown as Parameters<typeof adminOrigin>[0]),
    appName: c.var.config.PLATFORM_NAME,
    sendCode: () => {},
  });
  const secret = await symmetricDecrypt({
    key: (await auth.$context).secretConfig,
    data: row.secret,
  });
  if (!(await verifyTotp(secret, code))) {
    await limiter.fail('2fa-verify:user', key);
    throw refuse();
  }
  await limiter.succeed('2fa-verify:user', key);
}
