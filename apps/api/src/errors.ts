// Every error leaves as RFC 9457 problem details (packages/shared). Unknown
// errors are logged with their stack, reported to Sentry, and returned as
// `internal`, with nothing from the message.
import { AppError, type FieldError, toProblem } from '@managemind/shared';
import { captureException } from '@sentry/cloudflare';
import type { Context } from 'hono';
import type { ZodError } from 'zod';
import type { AppEnv } from './env';
import { log } from './log';
import { RateLimitedError } from './rate-limit/index';

export function problemResponse(c: Context<AppEnv>, error: unknown): Response {
  const config = c.var.config;
  const problem = toProblem(error, {
    errorBaseUrl: config ? `https://${config.PLATFORM_DOMAIN}/errors` : 'about:blank',
    requestId: c.var.requestId,
  });
  if (problem.status >= 500) {
    captureException(error, { tags: { request_id: c.var.requestId } });
    log('error', 'unhandled error', {
      request_id: c.var.requestId,
      route: c.req.routePath,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/problem+json' };
  if (error instanceof RateLimitedError) headers['Retry-After'] = String(error.retryAfter);
  return c.json(problem, problem.status as 400, headers);
}

/** Maps zod issues to field errors for a validation_failed problem. */
export function validationError(error: ZodError): AppError {
  const fields: FieldError[] = error.issues.map((i) => ({
    path: i.path.join('.'),
    code: i.code,
    message: i.message,
  }));
  return new AppError('validation_failed', { fields });
}
