// Shopper accounts on many hosts (phase-4-plan §3.11, ADR 0020): one Better
// Auth instance per request, built for the store's host and run inside the
// store's transaction, so RLS shows it only that store's shoppers. Sessions
// are signed with a per-store secret (HKDF of the auth secret and the
// tenant ID), the cookie cache is off, and the session cookie `mm_session`
// has Path=/api: it never reaches a page request, so pages stay cached.
// Sign-in is by email code, from the store domain (ADR 0022), or, where the
// store has SMS, by a code to the phone (phase-5a-plan §3.14). A phone
// account is its own account: email and phone accounts stay separate.
import { schema } from '@managemind/db';
import type { Locale } from '@managemind/shared/i18n';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, phoneNumber } from 'better-auth/plugins';

/** Where the storefront serves auth: {store host}/api/auth/*. */
export const SHOPPER_AUTH_PATH = '/api/auth';
export const SHOPPER_SESSION_COOKIE = 'mm_session';

const DAY = 24 * 60 * 60;
export const SHOPPER_SESSION_SECONDS = 30 * DAY;
export const SHOPPER_CODE_SECONDS = 10 * 60;

/** The endpoints a storefront may call; everything else answers 404. */
export const SHOPPER_AUTH_ENDPOINTS: Record<string, string> = {
  'POST /email-otp/send-verification-otp':
    'Send a sign-in code by email (rate-limited; Turnstile token in x-turnstile-token)',
  'POST /sign-in/email-otp': 'Sign in with the code; a new email creates the account',
  'POST /phone-number/send-otp':
    'Send a sign-in code by SMS, where the store has SMS (rate-limited; Turnstile in x-turnstile-token)',
  'POST /phone-number/verify': 'Sign in with the code; a new number creates the account',
  'GET /get-session': 'The current shopper, or null',
  'POST /sign-out': 'Sign out',
};

/** A store's own signing secret: HKDF-SHA-256 of the auth secret, salted with the tenant ID. */
export async function storeSecret(authSecret: string, tenantId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authSecret),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(tenantId),
      info: new TextEncoder().encode('managemind shopper sessions'),
    },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export interface ShopperAuthOptions {
  /** The store transaction's database handle. */
  db: unknown;
  secret: string;
  /** The store's origin, e.g. https://demo-fashion.managemind.store. */
  origin: string;
  storeName: string;
  sendCode: (input: { email: string; code: string; locale: Locale }) => void;
  locale: Locale;
  /** The store's SMS codes (the OtpCodes object), when it has an SMS gateway. */
  phone?: {
    send: (phone: string) => Promise<void>;
    verify: (phone: string, code: string) => Promise<boolean>;
  };
}

const BD_MOBILE = /^\+8801[3-9]\d{8}$/;

export function createShopperAuth(o: ShopperAuthOptions) {
  return betterAuth({
    appName: o.storeName,
    baseURL: o.origin,
    basePath: SHOPPER_AUTH_PATH,
    secret: o.secret,
    trustedOrigins: [o.origin],
    database: drizzleAdapter(o.db as Parameters<typeof drizzleAdapter>[0], {
      provider: 'pg',
      schema: {
        user: schema.shopperUsers,
        session: schema.shopperSessions,
        account: schema.shopperAccounts,
        verification: schema.shopperVerifications,
      },
    }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        // Set from the account page and checkout, through our own endpoints.
        phone: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: SHOPPER_SESSION_SECONDS,
      updateAge: DAY,
      // Off: with it, one store's cookie could replay on another (ADR 0005).
      cookieCache: { enabled: false },
      freshAge: 0,
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: SHOPPER_CODE_SECONDS,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') return;
          o.sendCode({ email, code: otp, locale: o.locale });
        },
      }),
      ...(o.phone ? [phoneSignIn(o.phone)] : []),
    ],
    // The API's Durable Object limits the code endpoints instead (ADR 0006).
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      database: { generateId: false },
      useSecureCookies: true,
      cookies: { session_token: { name: SHOPPER_SESSION_COOKIE } },
      // Every auth cookie stays under /api, out of page requests.
      defaultCookieAttributes: { path: '/api' },
      ipAddress: { ipAddressHeaders: ['x-shopper-ip'] },
    },
  });
}

/**
 * Phone codes through the store's own codes object, not Better Auth's table:
 * codes never reach the database. A new number signs up with an address at
 * .invalid, which no email code can ever reach.
 */
function phoneSignIn(phone: NonNullable<ShopperAuthOptions['phone']>) {
  return phoneNumber({
    otpLength: 6,
    expiresIn: SHOPPER_CODE_SECONDS,
    phoneNumberValidator: (n) => BD_MOBILE.test(n),
    sendOTP: ({ phoneNumber: n }) => phone.send(n),
    verifyOTP: ({ phoneNumber: n, code }) => phone.verify(n, code),
    signUpOnVerification: {
      getTempEmail: (n) => `${n.replace(/\D/g, '')}@phone.invalid`,
      getTempName: (n) => n,
    },
  });
}

export type ShopperAuth = ReturnType<typeof createShopperAuth>;
