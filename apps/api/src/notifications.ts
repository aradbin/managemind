// Sends what the outbox events say to send (phase-5a-plan §3.6–§3.9). For
// each event: plan and record the messages in one transaction (the log
// makes a redelivery send nothing twice), send outside it, then record each
// outcome. A store's own email key sends from its own domain, falling back
// to the platform sender if it fails; the platform's shared daily quota
// skips shopper order updates past 70% (§3.8) so sign-in codes keep working.

import {
  approvedTemplates,
  contactState,
  FREE_SERVICE_MESSAGES,
  freeServiceUsed,
  importKeyring,
  type Keyring,
  loadCredentials,
  type MessageOutcome,
  markMessage,
  type OutboxEvent,
  type PushTarget,
  planMessages,
  pushTargets,
  type QueuedMessage,
  recordMessages,
  renderMessage,
  settleFallback,
  settlePushTargets,
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
import type { WhatsappApi } from '@managemind/providers/meta';
import { sendPush, type VapidKeys } from '@managemind/providers/push';
import { SmsError, type SmsProvider, smsProviderFor } from '@managemind/providers/sms';
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
import { scheduleFallback, sendWhatsapp, whatsappFor } from './whatsapp';

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
  /** The staff member's devices, for push. */
  devices: PushTarget[];
  /** WhatsApp: the approved template, and whether a plain message is free now (phase-9-plan §3.2.2). */
  whatsapp?: { name: string; variables: string[]; plain: boolean };
}

interface StoreSender {
  name: string;
  replyTo?: string | undefined;
  /** The store's own email service, when it saved one. */
  own: { provider: EmailProvider; from: string } | null;
  /** The store's SMS gateway, when it saved one (phase-5a-plan §3.6). */
  sms: SmsProvider | null;
  /** The store's WhatsApp, when it connected it (phase-9-plan §3.2). */
  whatsapp: WhatsappApi | null;
}

/** Plans, records, sends and logs one event's messages. Throws to have the queue retry. */
export async function notify(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  event: OutboxEvent,
  /** Once more after WhatsApp couldn't reach the shopper, for the SMS it let go. */
  again = true,
): Promise<void> {
  const config = getConfig(env);
  const keyring = await credentialsKeyring(env);
  const { prepared, store } = await withClient(env, ctx, (client) =>
    withTenant(client, event.tenantId, async (tx) => {
      const sms = await loadCredentials(tx, keyring, 'sms');
      const whatsapp = await whatsappFor(env, tx);
      const urls = await storeUrlsFor(config, tx);
      const planned = await planMessages(tx, event, {
        trackUrl: urls.page('track'),
        pageUrl: urls.page,
        linkKey: `confirm-link:${config.AUTH_SECRET}`,
        smsGateway: sms !== null,
        whatsapp: whatsapp !== null,
      });
      const queued = await recordMessages(tx, planned);
      const prepared: Prepared[] = [];
      const templates = queued.some((m) => m.channel === 'whatsapp')
        ? await approvedTemplates(tx)
        : new Map();
      let freeLeft = templates.size ? FREE_SERVICE_MESSAGES - (await freeServiceUsed(tx)) : 0;
      for (const message of queued) {
        const rendered = await renderMessage(tx, message);
        const devices = message.channel === 'push' ? await pushTargets(tx, message.recipient) : [];
        if (!rendered) continue;
        if (message.channel === 'whatsapp') {
          const template = templates.get(`${message.event}:${message.locale}`);
          if (!template) continue;
          // Free inside the shopper's window while the month's allowance lasts (§2.1).
          const plain = freeLeft > 0 && (await contactState(tx, message.recipient)).windowOpen;
          if (plain) freeLeft--;
          prepared.push({ message, ...rendered, devices, whatsapp: { ...template, plain } });
          continue;
        }
        prepared.push({ message, ...rendered, devices });
      }
      const sender = await storeSender(tx, keyring, config.PLATFORM_NAME);
      return {
        prepared,
        store: {
          ...sender,
          sms: sms ? smsProviderFor(sms.provider, sms.secrets, sms.config) : null,
          whatsapp: whatsapp?.api ?? null,
        },
      };
    }),
  );
  if (!prepared.length) return;

  const outcomes = new Map<string, MessageOutcome>();
  const devices = { used: [] as string[], gone: [] as string[] };
  for (const p of prepared) {
    outcomes.set(p.message.id, await send(env, ctx, p, store, devices));
  }
  // A WhatsApp message that can't reach the shopper lets its waiting SMS go now.
  const released = await withClient(env, ctx, (client) =>
    withTenant(client, event.tenantId, async (tx) => {
      let released = false;
      for (const [id, outcome] of outcomes) await markMessage(tx, id, outcome);
      for (const p of prepared) {
        const outcome = outcomes.get(p.message.id);
        if (p.message.channel === 'whatsapp' && outcome?.status === 'failed' && !outcome.retry) {
          if ((await settleFallback(tx, p.message.idempotencyKey, 'send')).resend) released = true;
        }
      }
      await settlePushTargets(tx, devices.used, devices.gone);
      return released;
    }),
  );
  // The rest wait for Meta's receipts, or ten minutes (Q7).
  if (
    prepared.some(
      (p) => p.message.channel === 'whatsapp' && outcomes.get(p.message.id)?.status === 'sent',
    )
  ) {
    await scheduleFallback(env, event.tenantId, event.id);
  }
  const retry = [...outcomes.values()].some((o) => o.status === 'failed' && o.retry);
  log(retry ? 'warn' : 'info', 'messages sent', {
    event_id: event.id,
    tenant_id: event.tenantId,
    outcomes: [...outcomes.values()].map((o) => o.status),
  });
  if (released && again) await notify(env, ctx, event, false);
  // A retryable failure stays queued; the queue's next attempt sends only it.
  if (retry) throw new Error('some messages will be retried');
}

async function storeSender(
  tx: TenantTx,
  keyring: Keyring | null,
  platformName: string,
): Promise<Omit<StoreSender, 'sms' | 'whatsapp'>> {
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
  devices: { used: string[]; gone: string[] },
): Promise<MessageOutcome> {
  const { message } = p;
  if (message.channel === 'email') return sendEmailMessage(env, ctx, p, store);
  if (message.channel === 'push') return sendPushMessage(env, p, devices);
  if (message.channel === 'whatsapp') {
    if (!store.whatsapp || !p.whatsapp) return { status: 'skipped', reason: 'no_template' };
    return sendWhatsapp(store.whatsapp, {
      to: message.recipient,
      template: { ...p.whatsapp, locale: message.locale },
      values: message.values,
      text: p.body,
      plain: p.whatsapp.plain,
      confirmCode:
        message.event === 'confirm_request' ? message.values.confirm_code || undefined : undefined,
    });
  }
  return sendSmsMessage(p, store);
}

/** One SMS through the store's own gateway; the store pays for it (§3.6). */
async function sendSmsMessage(p: Prepared, store: StoreSender): Promise<MessageOutcome> {
  if (!store.sms) return { status: 'skipped', reason: 'no_gateway' };
  try {
    const sent = await store.sms.send(p.message.recipient, p.body);
    return { status: 'sent', provider: store.sms.name, providerMessageId: sent.id };
  } catch (e) {
    const err = e instanceof SmsError ? e : new SmsError('unknown', { retryable: true });
    return {
      status: 'failed',
      reason: err.message.slice(0, 300),
      retry: err.retryable,
      provider: store.sms.name,
    };
  }
}

/** The platform's VAPID keys, or null until the owner adds them (phase-5a-plan §1). */
export function vapidKeys(env: Env): VapidKeys | null {
  const config = getConfig(env);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const address = /<([^>]+)>/.exec(emailFrom(config))?.[1] ?? `no-reply@${config.PLATFORM_DOMAIN}`;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: `mailto:${address}`,
  };
}

/** One push per device of the staff member; sent when any device took it (§3.9). */
async function sendPushMessage(
  env: Env,
  p: Prepared,
  devices: { used: string[]; gone: string[] },
): Promise<MessageOutcome> {
  const keys = vapidKeys(env);
  if (!keys) return { status: 'skipped', reason: 'no_push_key' };
  if (!p.devices.length) return { status: 'skipped', reason: 'no_device' };
  const payload = {
    title: p.subject,
    body: p.body,
    // The admin opens the order (its route is /orders/<id>).
    url: `/orders/${p.message.orderId}`,
    tag: `order-${p.message.orderId}`,
  };
  let sent = 0;
  let lastError: { error: string; retryable: boolean } | null = null;
  for (const device of p.devices) {
    const result = await sendPush(device, payload, keys);
    if (result === 'sent') {
      sent++;
      devices.used.push(device.id);
    } else if (result === 'gone') {
      devices.gone.push(device.id);
    } else {
      lastError = result;
    }
  }
  if (sent) return { status: 'sent', provider: 'webpush' };
  if (lastError) {
    return {
      status: 'failed',
      reason: lastError.error,
      retry: lastError.retryable,
      provider: 'webpush',
    };
  }
  return { status: 'skipped', reason: 'no_device' };
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
