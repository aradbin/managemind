// Staff email delivery (phase-1-plan §5.7, ADR 0014). Emails that carry a
// secret (sign-in codes, invitation links) are sent after the response with
// waitUntil, never through the outbox, so no live code sits in the database.
import {
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
