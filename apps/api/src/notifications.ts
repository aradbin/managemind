// Sends what the outbox events say to send (phase-5a-plan §3.6–§3.9). For
// each event: plan and record the messages in one transaction (the log
// makes a redelivery send nothing twice), send outside it, then record each
// outcome. A store's own email key sends from its own domain, falling back
// to the platform sender if it fails; the platform's shared daily quota
// skips shopper order updates past 70% (§3.8) so sign-in codes keep working.
import {
  importKeyring,
  type Keyring,
  loadCredentials,
  type MessageOutcome,
  markMessage,
  type OutboxEvent,
  planMessages,
  type QueuedMessage,
  recordMessages,
  renderMessage,
  type TenantTx,
  triggeredBy,
  withTenant,
} from '@managemind/core';
import { schema } from '@managemind/db';
import {
  brevoProvider,
  EmailError,
  type EmailProvider,
  resendProvider,
  sendEmail,
  storeMessageEmail,
} from '@managemind/providers/email';
import { tenantSettings } from '@managemind/shared/settings';
import { eq } from 'drizzle-orm';
import { storeUrlsFor } from './admin/store-urls';
import { emailFrom, emailProvider, shopperEmailFrom, shopperEmailProvider } from './auth/email';
import { withClient } from './db';
import { type ApiConfig, type Env, getConfig } from './env';
import { log } from './log';
import {
  countEmailSent,
  EMAIL_DAILY_CAP,
  EMAIL_GUARD_SHARE,
  emailsSentToday,
} from './rate-limit/email-quota';

/** Whether an event sends anything, so the consumer knows to call notify. */
export const sendsMessages = (event: OutboxEvent) => triggeredBy(event) !== null;

let cachedKey: { base64: string; keyring: Promise<Keyring> } | undefined;

/** The credentials key, imported once per isolate; null when CREDENTIALS_KEY isn't set. */
export function credentialsKeyring(env: Env): Promise<Keyring> | null {
  const base64 = env.CREDENTIALS_KEY;
  if (!base64) return null;
  if (cachedKey?.base64 !== base64) cachedKey = { base64, keyring: importKeyring(base64) };
  return cachedKey.keyring;
}

interface Prepared {
  message: QueuedMessage;
  subject: string;
  body: string;
}

interface StoreSender {
  name: string;
  replyTo?: string | undefined;
  /** The store's own email service, when it saved one. */
  own: { provider: EmailProvider; from: string } | null;
}

/** Plans, records, sends and logs one event's messages. Throws to have the queue retry. */
export async function notify(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  event: OutboxEvent,
): Promise<void> {
  const config = getConfig(env);
  const keyring = await credentialsKeyring(env);
  const { prepared, store } = await withClient(env, ctx, (client) =>
    withTenant(client, event.tenantId, async (tx) => {
      const sms = await loadCredentials(tx, keyring, 'sms');
      const urls = await storeUrlsFor(config, tx);
      const planned = await planMessages(tx, event, {
        trackUrl: urls.page('track'),
        smsGateway: sms !== null,
      });
      const queued = await recordMessages(tx, planned);
      const prepared: Prepared[] = [];
      for (const message of queued) {
        const rendered = await renderMessage(tx, message);
        if (rendered) prepared.push({ message, ...rendered });
      }
      return { prepared, store: await storeSender(tx, keyring, config.PLATFORM_NAME) };
    }),
  );
  if (!prepared.length) return;

  const outcomes = new Map<string, MessageOutcome>();
  for (const p of prepared) {
    outcomes.set(p.message.id, await send(env, ctx, p, store));
  }
  await withClient(env, ctx, (client) =>
    withTenant(client, event.tenantId, async (tx) => {
      for (const [id, outcome] of outcomes) await markMessage(tx, id, outcome);
    }),
  );
  const retry = [...outcomes.values()].some((o) => o.status === 'failed' && o.retry);
  log(retry ? 'warn' : 'info', 'messages sent', {
    event_id: event.id,
    tenant_id: event.tenantId,
    outcomes: [...outcomes.values()].map((o) => o.status),
  });
  // A retryable failure stays queued; the queue's next attempt sends only it.
  if (retry) throw new Error('some messages will be retried');
}

async function storeSender(
  tx: TenantTx,
  keyring: Keyring | null,
  platformName: string,
): Promise<StoreSender> {
  const t = schema.tenants;
  const [row] = await tx.db
    .select({ name: t.name, settings: t.settings })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  const settings = tenantSettings.parse(row?.settings ?? {});
  const name = row?.name ?? platformName;
  let own: StoreSender['own'] = null;
  try {
    const saved = await loadCredentials(tx, keyring, 'email');
    if (saved) {
      const apiKey = String(saved.secrets.apiKey ?? '');
      const config = saved.config as { from: string; fromName?: string };
      const display = (config.fromName ?? name).replace(/["<>]/g, '').slice(0, 60);
      own = {
        provider:
          saved.provider === 'brevo' ? brevoProvider({ apiKey }) : resendProvider({ apiKey }),
        from: `${display} <${config.from}>`,
      };
    }
  } catch (e) {
    // Unreadable credentials (another key): the platform sender stands in.
    log('error', 'store email credentials unreadable', {
      tenant_id: tx.tenantId,
      error: String(e),
    });
  }
  return { name, replyTo: settings.profile.contactEmail, own };
}

async function send(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  p: Prepared,
  store: StoreSender,
): Promise<MessageOutcome> {
  const { message } = p;
  if (message.channel === 'email') return sendEmailMessage(env, ctx, p, store);
  // SMS gateways (plan PR 12) and web push (PR 6) plug in here.
  return {
    status: 'failed',
    reason: `${message.channel} sending is not available yet`,
    retry: false,
  };
}

/**
 * Whether a platform email counts against the shared daily quota, and
 * whether it is skipped past 70% (§3.8): every platform email counts unless
 * shopper email goes through Brevo, and only shopper updates after "order
 * placed" are skipped, so sign-in codes and staff alerts keep the rest.
 */
export function quotaApplies(
  config: Pick<ApiConfig, 'SHOPPER_EMAIL_PROVIDER'>,
  message: Pick<QueuedMessage, 'recipientType' | 'event'>,
): { counted: boolean; guarded: boolean } {
  const shopper = message.recipientType === 'shopper';
  const counted = !shopper || config.SHOPPER_EMAIL_PROVIDER === 'resend';
  return { counted, guarded: counted && shopper && message.event !== 'order_placed' };
}

async function sendEmailMessage(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  p: Prepared,
  store: StoreSender,
): Promise<MessageOutcome> {
  const config = getConfig(env);
  const { message } = p;
  const email = storeMessageEmail({
    locale: message.locale,
    storeName: store.name,
    subject: p.subject,
    body: p.body,
  });
  const base = {
    to: message.recipient,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: message.idempotencyKey,
    tags: { kind: message.event },
  };
  const shopper = message.recipientType === 'shopper';

  // The store's own service first, for shopper email; the platform if it fails.
  if (shopper && store.own) {
    try {
      const sent = await sendEmail(store.own.provider, {
        ...base,
        from: store.own.from,
        ...(store.replyTo ? { replyTo: store.replyTo } : {}),
      });
      return {
        status: 'sent',
        provider: `store_${store.own.provider.name}`,
        providerMessageId: sent.id,
      };
    } catch (e) {
      log('warn', 'store email failed, using the platform sender', {
        event: message.event,
        error: String(e),
      });
    }
  }

  const provider = shopper
    ? shopperEmailProvider(env, config, ctx)
    : emailProvider(env, config, ctx);
  if (!provider) return { status: 'skipped', reason: 'no_sender' };
  const { counted, guarded } = quotaApplies(config, message);
  if (guarded) {
    const sent = await emailsSentToday(env.RATE_LIMITER);
    if (sent >= EMAIL_DAILY_CAP * EMAIL_GUARD_SHARE) return { status: 'skipped', reason: 'quota' };
  }
  try {
    const sent = await sendEmail(provider, {
      ...base,
      from: shopper ? shopperEmailFrom(config, store.name) : emailFrom(config),
      ...(shopper && store.replyTo ? { replyTo: store.replyTo } : {}),
    });
    if (counted) await countEmailSent(env.RATE_LIMITER);
    return { status: 'sent', provider: provider.name, providerMessageId: sent.id };
  } catch (e) {
    const retryable = !(e instanceof EmailError) || e.retryable;
    return {
      status: 'failed',
      reason: e instanceof Error ? e.message : String(e),
      retry: retryable,
      provider: provider.name,
    };
  }
}
