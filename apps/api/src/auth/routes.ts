// Staff auth at /api/auth/* (phase-1-plan §7.1): only the endpoints the admin
// uses are reachable, each request gets its own Better Auth instance and
// database connection, and the sensitive endpoints are rate-limited first.
import type { OpenAPIHono } from '@hono/zod-openapi';
import { createDb } from '@managemind/db';
import { signInCodeEmail } from '@managemind/providers/email';
import { AppError } from '@managemind/shared';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { withClient } from '../db';
import type { AppEnv } from '../env';
import { log } from '../log';
import { createLimiter, type Limiter, type RuleName } from '../rate-limit/index';
import { createMailer } from './email';
import { AUTH_BASE_PATH, CODE_SECONDS, createStaffAuth, type StaffAuth } from './staff';

/**
 * Every endpoint the admin may call, by method and path under /api/auth.
 * Better Auth's routes aren't zod-openapi routes, so these summaries are
 * their entry in the OpenAPI document.
 */
export const AUTH_ENDPOINTS: Record<string, string> = {
  'POST /email-otp/send-verification-otp':
    'Send a sign-in code by email. Answers the same for unknown addresses',
  'POST /sign-in/email-otp':
    'Sign in with the code. With 2FA on, returns twoFactorRedirect and no session',
  'POST /email-otp/verify-email': 'Verify the email address with a code',
  'GET /get-session': 'The current session and user, or null',
  'POST /sign-out': 'Sign out of this session',
  'GET /list-sessions': "The user's sessions",
  'POST /revoke-session': 'Sign out one session',
  'POST /revoke-other-sessions': 'Sign out every other session',
  'POST /two-factor/enable': 'Start authenticator setup: returns the TOTP URI and backup codes',
  'POST /two-factor/verify-totp':
    'Check an authenticator code, to finish setup or a sign-in challenge',
  'POST /two-factor/disable': 'Turn two-factor login off',
  'POST /two-factor/generate-backup-codes': 'Replace the backup codes',
  'POST /two-factor/verify-backup-code': 'Finish a sign-in challenge with a backup code',
};

const SEND_CODE = '/email-otp/send-verification-otp';
const SIGN_IN = '/sign-in/email-otp';
const VERIFY_2FA = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

/** The admin's origin: its fixed host, or the request's own origin in local development. */
export function adminOrigin(c: Context<AppEnv>): string {
  const host = c.var.config.ADMIN_HOST;
  return host ? `https://${host}` : new URL(c.req.url).origin;
}

async function bodyEmail(request: Request): Promise<string | undefined> {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { email?: unknown } | null;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
}

/**
 * Whose two-factor attempt this is: the user behind the pending challenge
 * cookie, or the signed-in user while enrolling. The lookup only picks the
 * rate-limit key; Better Auth checks the cookie's signature itself.
 */
async function twoFactorSubject(c: Context<AppEnv>, auth: StaffAuth): Promise<string> {
  const context = await auth.$context;
  const challenge = getCookie(c, context.createAuthCookie('two_factor').name);
  if (challenge) {
    const identifier = challenge.slice(0, challenge.lastIndexOf('.'));
    const row = identifier ? await context.internalAdapter.findVerificationValue(identifier) : null;
    if (row) return `user:${row.value}`;
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  if (session) return `user:${session.user.id}`;
  return `ip:${c.req.header('cf-connecting-ip') ?? 'unknown'}`;
}

/** Records the outcome of a verification for the rules with a lockout. */
async function settle(limiter: Limiter, rule: RuleName, key: string, response: Response) {
  if (response.ok) await limiter.succeed(rule, key);
  else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    await limiter.fail(rule, key);
  }
}

export function registerAuth(app: OpenAPIHono<AppEnv>): void {
  for (const [endpoint, summary] of Object.entries(AUTH_ENDPOINTS)) {
    const [method = '', path = ''] = endpoint.split(' ');
    app.openAPIRegistry.registerPath({
      method: method.toLowerCase() as 'get' | 'post',
      path: `${AUTH_BASE_PATH}${path}`,
      tags: ['auth'],
      summary,
      responses: { 200: { description: 'Better Auth response (JSON)' } },
    });
  }

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, async (c) => {
    const path = c.req.path.slice(AUTH_BASE_PATH.length);
    if (!Object.hasOwn(AUTH_ENDPOINTS, `${c.req.method} ${path}`)) throw new AppError('not_found');

    const config = c.var.config;
    const limiter = createLimiter(c.env.RATE_LIMITER, (e) =>
      log('error', 'rate limiter unavailable', { request_id: c.var.requestId, error: String(e) }),
    );
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const email = path === SEND_CODE || path === SIGN_IN ? await bodyEmail(c.req.raw) : undefined;

    // Checked before any database work, so a refused request costs nothing.
    if (path === SEND_CODE) {
      await limiter.check('otp-send:ip', ip);
      if (email) await limiter.check('otp-send:email', email);
    }
    if (path === SIGN_IN && email) await limiter.check('otp-verify:email', email);

    const mailer = createMailer(c.env, config, c.executionCtx);
    return withClient(c.env, c.executionCtx, async (client) => {
      const auth = createStaffAuth({
        db: createDb(client),
        secret: config.AUTH_SECRET,
        origin: adminOrigin(c),
        appName: config.PLATFORM_NAME,
        sendCode: ({ email: to, code, locale }) => {
          const minutes = CODE_SECONDS / 60;
          const rendered = signInCodeEmail({
            locale,
            platformName: config.PLATFORM_NAME,
            code,
            minutes,
          });
          mailer.sendLater({ to, ...rendered }, 'sign_in_code');
        },
      });

      const subject = VERIFY_2FA.has(path) ? await twoFactorSubject(c, auth) : undefined;
      if (subject) await limiter.check('2fa-verify:user', subject);

      const response = await auth.handler(c.req.raw);
      if (path === SIGN_IN && email) await settle(limiter, 'otp-verify:email', email, response);
      if (subject) await settle(limiter, '2fa-verify:user', subject, response);
      return response;
    });
  });
}
