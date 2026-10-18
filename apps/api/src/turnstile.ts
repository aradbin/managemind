// Cloudflare Turnstile (phase-4-plan §3.15): placing an order and requesting
// sign-in codes carry a token, checked with siteverify. The token's hostname
// must be the request's host, so a token solved on one store can't be spent
// on another. Without a secret (local development and the API tests) the
// check is skipped; previews use Cloudflare's published test keys.
import { AppError } from '@managemind/shared';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  hostname?: string;
  'error-codes'?: string[];
}

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  options: { host: string; ip?: string | undefined; fetcher?: typeof fetch },
): Promise<void> {
  if (!secret) return;
  if (!token)
    throw new AppError('validation_failed', {
      fields: [{ path: 'turnstileToken', code: 'required', message: 'complete the check' }],
    });
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (options.ip && options.ip !== 'unknown') form.append('remoteip', options.ip);
  let result: TurnstileResult;
  try {
    const res = await (options.fetcher ?? fetch)(SITEVERIFY, { method: 'POST', body: form });
    result = (await res.json()) as TurnstileResult;
  } catch (e) {
    throw new AppError('feature_unavailable', {
      detail: 'The check could not be verified',
      cause: e,
    });
  }
  const host = options.host.toLowerCase();
  // Cloudflare's test keys answer with "example.com".
  const hostOk = !result.hostname || result.hostname === host || result.hostname === 'example.com';
  if (!result.success || !hostOk) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'turnstileToken', code: 'failed', message: 'the check failed; try again' }],
    });
  }
}
