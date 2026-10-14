// Worker bindings and the validated configuration derived from them.
import type { OutboxEvent } from '@managemind/core';
import { baseConfig, hostname, loadConfig } from '@managemind/shared/config';
import { z } from 'zod';
import type { RateLimiter } from './rate-limit/durable-object';

export interface Env {
  /** Neon through Hyperdrive, as the mm_app role (ADR 0002, ADR 0009). */
  HYPERDRIVE: Hyperdrive;
  /** Outbox events, relayed after commit (ADR 0010). */
  OUTBOX: Queue<OutboxEvent>;
  /** Rate limits and the daily email count, one object per key (ADR 0006). */
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  /** Host-to-store map read by the storefront (ADR 0015); absent in previews. */
  EDGE?: KVNamespace;
  /** Static assets: the admin SPA under /admin. */
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  PLATFORM_NAME: string;
  PLATFORM_DOMAIN: string;
  STORE_DOMAIN: string;
  /** Git commit of the deployed build, set by CI. */
  COMMIT_SHA?: string;
  /** Share of successful requests to log, 0 to 1 (errors are always logged). */
  LOG_SAMPLE_RATE?: string;
  /** Sentry project DSN, set by CI; Sentry is off without it. */
  SENTRY_DSN?: string;
  /** Signs session cookies and encrypts TOTP secrets (a Worker secret; Q10). */
  AUTH_SECRET?: string;
  /** The admin's host; sign-in cookies and CSRF checks are bound to it. */
  ADMIN_HOST?: string;
  /** `resend` in production; `capture` saves emails to platform.dev_emails. */
  EMAIL_PROVIDER?: string;
  /** "Name <address>" for staff emails. */
  EMAIL_FROM?: string;
  /** Resend API key with sending access (a Worker secret). */
  RESEND_API_KEY?: string;
}

const DEV_AUTH_SECRET = 'development-only-auth-secret-never-deployed';

export const apiConfig = baseConfig
  .extend({
    COMMIT_SHA: z.string().default('dev'),
    LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    // 32 random bytes in base64 are 44 characters; Better Auth wants at least 32.
    AUTH_SECRET: z.string().min(32).optional(),
    ADMIN_HOST: hostname().optional(),
    EMAIL_PROVIDER: z.enum(['resend', 'capture']).default('capture'),
    EMAIL_FROM: z
      .string()
      .regex(/^[^<>]+ <[^\s<>@]+@[^\s<>@]+>$/, 'must look like "Name <address>"')
      .optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (c.ENVIRONMENT !== 'development' && !c.AUTH_SECRET) issue('AUTH_SECRET', 'is required');
    // Outside development the admin has a fixed host; locally it is the request's.
    if (c.ENVIRONMENT !== 'development' && !c.ADMIN_HOST) issue('ADMIN_HOST', 'is required');
    // Captured emails are readable through the dev mailbox, so never in production.
    if (c.ENVIRONMENT === 'production' && c.EMAIL_PROVIDER !== 'resend') {
      issue('EMAIL_PROVIDER', 'must be resend in production');
    }
    if (c.EMAIL_PROVIDER === 'resend' && !c.RESEND_API_KEY) issue('RESEND_API_KEY', 'is required');
  })
  // wrangler dev works without setup; deployed Workers always get the real secret.
  .transform((c) => ({ ...c, AUTH_SECRET: c.AUTH_SECRET ?? DEV_AUTH_SECRET }));
export type ApiConfig = z.output<typeof apiConfig>;

export const getConfig = (env: Env): ApiConfig => loadConfig(apiConfig, env);

export interface Variables {
  requestId: string;
  config: ApiConfig;
  tenantId?: string;
  userId?: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
