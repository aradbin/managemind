// The staff Better Auth instance (ADR 0005, phase-1-plan §3.3–3.4, §5.5).
// Built per request around that request's database handle (ADR 0013).
// Staff sign in with email codes; sign-up is off, so codes go only to people
// who already have a user row (created by an invitation or the CLI).
import { type Db, schema } from '@managemind/db';
import type { Locale } from '@managemind/shared/i18n';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, twoFactor } from 'better-auth/plugins';

export const AUTH_BASE_PATH = '/api/auth';
export const COOKIE_PREFIX = 'mm_staff';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const SESSION_SECONDS = 7 * DAY;
/** A session is extended when used after this long (`updateAge`). */
export const SESSION_REFRESH_SECONDS = DAY;
/** Platform users get at most 12 hours from sign-in, refreshed or not (§5.5). */
export const PLATFORM_SESSION_SECONDS = 12 * HOUR;
/** Sign-in codes: 6 digits, valid for 10 minutes, 3 tries each. */
export const CODE_LENGTH = 6;
export const CODE_SECONDS = 10 * 60;

/** Caps a platform user's session at 12 hours after it was created. */
export function capPlatformExpiry(
  expiresAt: Date,
  createdAt: Date,
  platformRole: string | null | undefined,
): Date {
  if (!platformRole) return expiresAt;
  const cap = new Date(createdAt.getTime() + PLATFORM_SESSION_SECONDS * 1000);
  return expiresAt < cap ? expiresAt : cap;
}

/**
 * The twoFactor plugin challenges only password sign-ins (§3.4). Plan A: its
 * own after-hook also runs for `/sign-in/email-otp`, so a user with 2FA gets
 * the plugin's challenge (session dropped, two-factor cookie set) and keeps
 * its trusted devices and backup codes, with no copy of its internals.
 */
export function challengeEmailCodeSignIns<T extends ReturnType<typeof twoFactor>>(plugin: T): T {
  const hooks = plugin.hooks.after;
  // The plugin has one after-hook, the sign-in challenge; a test pins it.
  if (hooks.length !== 1 || !hooks[0]) {
    throw new Error('twoFactor plugin changed shape: re-check the email-code challenge');
  }
  const hook = hooks[0];
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: [
        {
          ...hook,
          matcher: (ctx: Parameters<typeof hook.matcher>[0]) =>
            hook.matcher(ctx) || ctx.path === '/sign-in/email-otp',
        },
      ],
    },
  };
}

export interface StaffAuthOptions {
  db: Db;
  secret: string;
  /** The admin's origin, e.g. https://admin.example.com. */
  origin: string;
  appName: string;
  /** Hands a sign-in code to the mailer; must not wait for delivery. */
  sendCode: (input: { email: string; code: string; locale: Locale }) => Promise<void> | void;
}

export function createStaffAuth(o: StaffAuthOptions) {
  return betterAuth({
    appName: o.appName,
    baseURL: o.origin,
    basePath: AUTH_BASE_PATH,
    secret: o.secret,
    trustedOrigins: [o.origin],
    database: drizzleAdapter(o.db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
      },
    }),
    // No passwords on the Free plan (ADR 0013).
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        // Set only by our identity service; no Better Auth endpoint accepts it.
        platformRole: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false, defaultValue: 'bn' },
      },
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // Off: it allowed cross-store session replay (ADR 0005). A test pins it.
      cookieCache: { enabled: false },
      // No "fresh session" check: of the allowed endpoints it only guards
      // list-sessions, and seeing your own sessions on day 2 of 7 shouldn't
      // need a new sign-in (phase-1-plan §5.5).
      freshAge: 0,
      additionalFields: {
        activeTenantId: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        update: {
          // Turning 2FA on or off signs the user out everywhere (§5.5). The
          // plugin then creates the one session this request continues with.
          before: async (data, ctx) => {
            const userId = ctx?.context.session?.user.id;
            if (data.twoFactorEnabled === undefined || !userId) return;
            await ctx.context.internalAdapter.deleteUserSessions(userId);
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = ctx
              ? await ctx.context.internalAdapter.findUserById(session.userId)
              : null;
            const role = (user as { platformRole?: string | null } | null)?.platformRole;
            const expiresAt = capPlatformExpiry(session.expiresAt, new Date(), role);
            return { data: { ...session, expiresAt } };
          },
        },
        update: {
          // A refresh moves expiresAt forward; getSession has already put the
          // current session on the context, so the cap can use its age.
          before: async (data, ctx) => {
            const current = ctx?.context.session as
              | { session: { createdAt: Date }; user: { platformRole?: string | null } }
              | null
              | undefined;
            if (!data.expiresAt || !current) return;
            const expiresAt = capPlatformExpiry(
              new Date(data.expiresAt),
              new Date(current.session.createdAt),
              current.user.platformRole,
            );
            return { data: { ...data, expiresAt } };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        disableSignUp: true,
        otpLength: CODE_LENGTH,
        expiresIn: CODE_SECONDS,
        allowedAttempts: 3,
        // Only a hash is stored, so a database read reveals no live code.
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (type !== 'sign-in') return;
          const found = await ctx?.context.internalAdapter.findUserByEmail(email);
          const locale = (found?.user as { locale?: Locale } | undefined)?.locale ?? 'bn';
          await o.sendCode({ email, code: otp, locale });
        },
      }),
      challengeEmailCodeSignIns(
        twoFactor({
          issuer: o.appName,
          // Staff have no password, so enrolling and disabling can't ask for one.
          allowPasswordless: true,
          trustDeviceMaxAge: 30 * DAY,
        }),
      ),
    ],
    // Our Durable Object limits the sensitive endpoints instead (ADR 0006).
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // Ids are uuidv7() database defaults (ADR 0005).
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
  });
}

export type StaffAuth = ReturnType<typeof createStaffAuth>;
