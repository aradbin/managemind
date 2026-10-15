// Staff auth calls (Better Auth at /api/auth on the admin's own host;
// phase-1-plan §3.5, §5.5). Its endpoints aren't zod-openapi routes, so the
// SDK has no types for them; these are the few the admin uses.

/** A refused auth call: Better Auth's `code` (e.g. INVALID_OTP) or our problem code. */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Seconds to wait, from Retry-After on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(code);
    this.name = 'AuthError';
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api/auth${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = (await res.json().catch(() => null)) as T & { code?: unknown };
  if (!res.ok) {
    const code = typeof data?.code === 'string' ? data.code : `http_${res.status}`;
    const retry = Number(res.headers.get('retry-after'));
    throw new AuthError(res.status, code, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return data;
}

export interface Session {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export const auth = {
  /** Always answers the same, known address or not (§5.5). */
  sendCode: (email: string) =>
    call<{ success: boolean }>('/email-otp/send-verification-otp', { email, type: 'sign-in' }),
  /** With two-factor login on, no session yet: the challenge comes next. */
  signIn: (email: string, otp: string) =>
    call<{ twoFactorRedirect?: boolean }>('/sign-in/email-otp', { email, otp }),
  verifyTotp: (code: string, trustDevice = false) =>
    call<unknown>('/two-factor/verify-totp', { code, trustDevice }),
  verifyBackupCode: (code: string, trustDevice = false) =>
    call<unknown>('/two-factor/verify-backup-code', { code, trustDevice }),
  session: () => call<{ session: Session } | null>('/get-session'),
  signOut: () => call<unknown>('/sign-out', {}),
  listSessions: () => call<Session[]>('/list-sessions'),
  revokeSession: (token: string) => call<unknown>('/revoke-session', { token }),
  revokeOtherSessions: () => call<unknown>('/revoke-other-sessions', {}),
  /** Starts authenticator setup; two-factor login is on only after verifyTotp. */
  enableTwoFactor: () => call<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', {}),
  disableTwoFactor: () => call<unknown>('/two-factor/disable', {}),
  newBackupCodes: () => call<{ backupCodes: string[] }>('/two-factor/generate-backup-codes', {}),
};

/** The key from an otpauth:// URI, grouped in fours for typing by hand. */
export function totpSecret(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    return secret.replace(/(.{4})(?=.)/g, '$1 ');
  } catch {
    return '';
  }
}

/**
 * Where to go after signing in: only a path on this site, so a crafted
 * ?redirect= can't send anyone elsewhere.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return;
  // Backslashes and control characters can make a browser read it as another host.
  if ([...value].some((ch) => ch === '\\' || ch.charCodeAt(0) < 0x20)) return;
  if (value.startsWith('/sign-in') || value.startsWith('/two-factor')) return;
  return value;
}
