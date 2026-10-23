// Staff email delivery (phase-1-plan §5.7, ADR 0014). Emails that carry a
// secret (sign-in codes, invitation links) are sent after the response with
// waitUntil, never through the outbox, so no live code sits in the database.
import {
  brevoProvider,
  captureProvider,
  type EmailMessage,
  type EmailProvider,
  resendProvider,
  sendEmail,
} from '@managemind/providers/email';
import { captureException } from '@sentry/cloudflare';
import { withClient } from '../db';
import type { ApiConfig, Env } from '../env';
import { log } from '../log';
import { countEmailSent } from '../rate-limit/email-quota';

/** The sender: EMAIL_FROM when set, otherwise no-reply at the platform domain (Q8). */
export const emailFrom = (config: ApiConfig): string =>
  config.EMAIL_FROM ?? `${config.PLATFORM_NAME} <no-reply@${config.PLATFORM_DOMAIN}>`;

export function emailProvider(
  env: Env,
  config: ApiConfig,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): EmailProvider {
  if (config.EMAIL_PROVIDER === 'resend') {
    return resendProvider({ apiKey: config.RESEND_API_KEY ?? '' });
  }
  return devMailbox(env, ctx);
}

/** Saves emails to platform.dev_emails, read through the dev mailbox (never in production). */
function devMailbox(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): EmailProvider {
  // The capture provider runs after the response, when the request's own
  // connection is closed, so each save opens its own.
  return captureProvider((message) =>
    withClient(env, ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into platform.dev_emails ("to", subject, text, html)
         values ($1, $2, $3, $4) returning id`,
        [message.to, message.subject, message.text, message.html],
      );
      return { id: rows[0]?.id ?? '' };
    }),
  );
}

export interface Mailer {
  /** Sends after the response; failures are reported, never thrown. */
  sendLater(message: Omit<EmailMessage, 'from'>, kind: string): void;
}

export function createMailer(
  env: Env,
  config: ApiConfig,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Mailer {
  const provider = emailProvider(env, config, ctx);
  const from = emailFrom(config);
  return {
    sendLater(message, kind) {
      const send = async () => {
        try {
          await sendEmail(provider, { ...message, from, tags: { kind, ...message.tags } });
        } catch (e) {
          // The recipient is never logged (ADR 0014); the person can ask for a new code.
          log('error', 'email failed', { kind, provider: provider.name, error: String(e) });
          captureException(e, { tags: { email_kind: kind } });
          return;
        }
        await countEmailSent(env.RATE_LIMITER);
      };
      ctx.waitUntil(send());
    },
  };
}

/** Whether shopper email can go out, so accounts can be on (ADR 0022). */
export const shopperEmailReady = (config: ApiConfig) => config.SHOPPER_EMAIL_PROVIDER !== 'none';

/**
 * The shopper email's From: the store's name, at no-reply@ the store domain
 * through Brevo, or at the staff sender's address through Resend, whose free
 * plan verifies only the platform domain (ADR 0022 amendment).
 */
export function shopperEmailFrom(config: ApiConfig, storeName: string): string {
  // Quotes and angle brackets would break the From header.
  const name = storeName.replace(/["<>]/g, '').slice(0, 60) || config.PLATFORM_NAME;
  if (config.SHOPPER_EMAIL_PROVIDER === 'resend') {
    const staff = emailFrom(config);
    return `${name} <${/<([^>]+)>/.exec(staff)?.[1] ?? staff}>`;
  }
  return `${name} <no-reply@${config.STORE_DOMAIN}>`;
}

/** The platform's shopper email provider (ADR 0022), or null when shopper email is off. */
export function shopperEmailProvider(
  env: Env,
  config: ApiConfig,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): EmailProvider | null {
  switch (config.SHOPPER_EMAIL_PROVIDER) {
    case 'brevo':
      return brevoProvider({ apiKey: config.BREVO_API_KEY ?? '' });
    case 'resend':
      return resendProvider({ apiKey: config.RESEND_API_KEY ?? '' });
    case 'capture':
      return devMailbox(env, ctx);
    default:
      return null;
  }
}

/**
 * Shopper email (ADR 0022): from the store's name, through Brevo or Resend in
 * production, replies to the store's own address.
 */
export function createShopperMailer(
  env: Env,
  config: ApiConfig,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  store: { name: string; replyTo?: string | undefined },
): Mailer {
  const provider = shopperEmailProvider(env, config, ctx);
  if (!provider) throw new Error('shopper email is not set up');
  const viaResend = config.SHOPPER_EMAIL_PROVIDER === 'resend';
  const from = shopperEmailFrom(config, store.name);
  return {
    sendLater(message, kind) {
      const send = async () => {
        try {
          await sendEmail(provider, {
            ...message,
            from,
            ...(store.replyTo ? { replyTo: store.replyTo } : {}),
            tags: { kind, ...message.tags },
          });
        } catch (e) {
          log('error', 'shopper email failed', { kind, provider: provider.name, error: String(e) });
          captureException(e, { tags: { email_kind: kind } });
          return;
        }
        // Through Resend, shopper email shares the staff email's daily quota.
        if (viaResend) await countEmailSent(env.RATE_LIMITER);
      };
      ctx.waitUntil(send());
    },
  };
}
