// WhatsApp with the store's own number (phase-9-plan §3.2, ADR 0032): the
// account from its sealed credentials, one message's send, the SMS fallback
// ten minutes later, the store's webhook (receipts, button replies, stop
// words, template reviews), and connecting with the templates' submission.
import {
  answerLink,
  applyTemplateStatus,
  applyWhatsappStatus,
  FALLBACK_SECONDS,
  linkView,
  loadCredentials,
  type MessageOutcome,
  orderSettings,
  outboxEvent,
  recordInbound,
  recordTemplateSubmitted,
  settleFallbacksOf,
  type TenantTx,
  templatesToSubmit,
  withTenant,
} from '@managemind/core';
import {
  fakeWhatsappApi,
  MetaError,
  UNREACHABLE_CODES,
  verifyMetaSignature,
  type WhatsappApi,
  whatsappApi,
} from '@managemind/providers/meta';
import {
  CONFIRM_BUTTONS,
  confirmPayload,
  readConfirmPayload,
} from '@managemind/shared/notifications';
import { withClient } from './db';
import { type Env, getConfig } from './env';
import { log } from './log';
import { credentialsKeyring } from './notifications';

type Ctx = Pick<ExecutionContext, 'waitUntil'>;

/** What the fake account was asked: previews, local runs and tests. */
export const fakeWhatsappLog: { kind: string; to?: string; body: unknown }[] = [];
const fake = fakeWhatsappApi(fakeWhatsappLog);

export interface WhatsappAccount {
  api: WhatsappApi;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string | null;
}

/** The store's WhatsApp, or null when it has none; the fake one for the token `fake` outside production. */
export async function whatsappFor(env: Env, tx: TenantTx): Promise<WhatsappAccount | null> {
  const saved = await loadCredentials(tx, await credentialsKeyring(env), 'whatsapp');
  if (!saved) return null;
  const token = String(saved.secrets.accessToken ?? '');
  const phoneNumberId = String(saved.config.phoneNumberId ?? '');
  const isFake = token === 'fake' && getConfig(env).ENVIRONMENT !== 'production';
  return {
    api: isFake
      ? fake
      : whatsappApi({ phoneNumberId, wabaId: String(saved.config.wabaId ?? ''), token }),
    phoneNumberId,
    appSecret: String(saved.secrets.appSecret ?? ''),
    verifyToken: typeof saved.secrets.verifyToken === 'string' ? saved.secrets.verifyToken : null,
  };
}

export interface WhatsappSend {
  to: string;
  template: { name: string; variables: string[]; locale: 'bn' | 'en' };
  values: Record<string, string>;
  /** The approved wording with the values in, for a plain message inside the window. */
  text: string;
  /** The shopper wrote within 24 hours and the month's free service messages remain. */
  plain: boolean;
  /** For the confirmation request: its buttons carry the order's code. */
  confirmCode?: string | undefined;
}

/**
 * One message. A plain message inside an open window costs the store
 * nothing while the free allowance lasts (§2.1); otherwise the template. A
 * shopper who isn't on WhatsApp fails for good, which lets the SMS go.
 */
export async function sendWhatsapp(api: WhatsappApi, m: WhatsappSend): Promise<MessageOutcome> {
  try {
    if (m.plain && !m.confirmCode) {
      const sent = await api.sendText(m.to, m.text);
      return { status: 'sent', provider: 'whatsapp_text', providerMessageId: sent.id };
    }
    const sent = await api.sendTemplate(m.to, {
      name: m.template.name,
      language: m.template.locale,
      values: m.template.variables.map((v) => m.values[v] ?? ''),
      ...(m.confirmCode
        ? {
            payloads: [
              confirmPayload('confirm', m.confirmCode),
              confirmPayload('cancel', m.confirmCode),
            ],
          }
        : {}),
    });
    return { status: 'sent', provider: 'whatsapp', providerMessageId: sent.id };
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError('unknown', { retryable: true });
    const unreachable = UNREACHABLE_CODES.has(err.code);
    return {
      status: 'failed',
      reason: (unreachable ? `not_on_whatsapp: ${err.message}` : err.message).slice(0, 300),
      retry: err.retryable && !unreachable,
      provider: 'whatsapp',
    };
  }
}

/** Ten minutes after an event's WhatsApp messages went out (Q7). */
export interface NotifyFallbackMessage {
  kind: 'notify_fallback';
  tenantId: string;
  eventId: string;
}

export async function scheduleFallback(env: Env, tenantId: string, eventId: string) {
  await env.DOMAINS?.send(
    { kind: 'notify_fallback', tenantId, eventId } satisfies NotifyFallbackMessage,
    {
      contentType: 'json',
      delaySeconds: FALLBACK_SECONDS,
    },
  );
}

/**
 * Lets each waiting SMS go whose WhatsApp message Meta hasn't confirmed, and
 * skips the rest; then sends what was let go, through the same plan.
 */
export async function handleFallbacks(
  messages: readonly Message<NotifyFallbackMessage>[],
  env: Env,
  ctx: Ctx,
  notify: (
    env: Env,
    ctx: Ctx,
    event: NonNullable<Awaited<ReturnType<typeof outboxEvent>>>,
  ) => Promise<void>,
): Promise<void> {
  for (const m of messages) {
    try {
      const event = await withClient(env, ctx, (client) =>
        withTenant(client, m.body.tenantId, async (tx) =>
          (await settleFallbacksOf(tx, m.body.eventId)) ? outboxEvent(tx, m.body.eventId) : null,
        ),
      );
      if (event) await notify(env, ctx, event);
      m.ack();
    } catch (e) {
      log('error', 'sms fallback failed', { tenant_id: m.body.tenantId, error: String(e) });
      m.retry({ delaySeconds: 60 });
    }
  }
}

// ---- The store's webhook (§3.2.4) -------------------------------------------------------

interface WebhookChange {
  field?: string;
  value?: {
    metadata?: { phone_number_id?: string };
    statuses?: {
      id?: string;
      status?: string;
      timestamp?: string;
      errors?: { title?: string }[];
    }[];
    messages?: {
      from?: string;
      timestamp?: string;
      type?: string;
      text?: { body?: string };
      button?: { payload?: string; text?: string };
      interactive?: { button_reply?: { id?: string } };
    }[];
    message_template_name?: string;
    message_template_language?: string;
    event?: string;
    reason?: string;
  };
}

const REPLIES = {
  confirmed: {
    en: (n: string) => `Thank you! Your order ${n} is confirmed.`,
    bn: (n: string) => `ধন্যবাদ! আপনার অর্ডার ${n} নিশ্চিত হয়েছে।`,
  },
  noted: {
    en: (n: string) =>
      `Thank you! We have your answer for order ${n}; we may call you before sending it.`,
    bn: (n: string) => `ধন্যবাদ! অর্ডার ${n}-এর উত্তর পেয়েছি; পাঠানোর আগে আমরা ফোন করতে পারি।`,
  },
  cancelled: {
    en: (n: string) => `Your order ${n} is cancelled.`,
    bn: (n: string) => `আপনার অর্ডার ${n} বাতিল হয়েছে।`,
  },
  gone: {
    en: () => 'This order can no longer be changed here. Please contact the store.',
    bn: () => 'এই অর্ডার এখান থেকে আর বদলানো যাবে না। দোকানের সাথে যোগাযোগ করুন।',
  },
} as const;

export type WhatsappWebhookResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'refused' }
  | { status: 'challenge'; challenge: string };

/** Meta's GET handshake: the verify token we gave the store, then the challenge back. */
export async function verifyWhatsappWebhook(
  env: Env,
  ctx: Ctx,
  tenantId: string,
  query: { mode?: string | undefined; token?: string | undefined; challenge?: string | undefined },
): Promise<WhatsappWebhookResult> {
  const account = await withClient(env, ctx, (client) =>
    withTenant(client, tenantId, (tx) => whatsappFor(env, tx)).catch(() => null),
  );
  if (!account?.verifyToken) return { status: 'not_found' };
  if (query.mode !== 'subscribe' || query.token !== account.verifyToken)
    return { status: 'refused' };
  return { status: 'challenge', challenge: (query.challenge ?? '').slice(0, 200) };
}

/**
 * One delivery of the store's webhook. The signature is checked against the
 * store's app secret before anything is read; a payload for another number
 * is ignored. Throws when the database can't be reached, so Meta retries.
 */
export async function handleWhatsappWebhook(
  env: Env,
  ctx: Ctx,
  tenantId: string,
  raw: string,
  signature: string | null,
  resend: (eventId: string) => Promise<void>,
): Promise<WhatsappWebhookResult> {
  return withClient(env, ctx, async (client) => {
    const account = await withTenant(client, tenantId, (tx) => whatsappFor(env, tx)).catch(
      () => null,
    );
    if (!account) return { status: 'not_found' };
    if (!(await verifyMetaSignature(account.appSecret, raw, signature))) {
      log('warn', 'whatsapp webhook refused', { tenant_id: tenantId });
      return { status: 'refused' };
    }
    let body: { entry?: { changes?: WebhookChange[] }[] };
    try {
      body = JSON.parse(raw);
    } catch {
      return { status: 'ok' };
    }
    const resends = new Set<string>();
    const replies: { to: string; text: string }[] = [];
    for (const change of (body.entry ?? []).flatMap((e) => e.changes ?? [])) {
      const v = change.value ?? {};
      if (change.field === 'message_template_status_update') {
        if (v.message_template_name && v.message_template_language && v.event) {
          await withTenant(client, tenantId, (tx) =>
            applyTemplateStatus(tx, {
              name: v.message_template_name as string,
              language: v.message_template_language as string,
              status: v.event as string,
              reason: v.reason ?? null,
            }),
          );
        }
        continue;
      }
      if (v.metadata?.phone_number_id !== account.phoneNumberId) continue;
      for (const s of v.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const done = await withTenant(client, tenantId, (tx) =>
          applyWhatsappStatus(tx, {
            id: s.id as string,
            status: s.status as string,
            at: new Date(Number(s.timestamp ?? 0) * 1000 || Date.now()),
            error: s.errors?.[0]?.title ?? null,
          }),
        );
        if (done.resend) resends.add(done.resend);
      }
      for (const msg of v.messages ?? []) {
        if (!msg.from || !/^\d{8,15}$/.test(msg.from)) continue;
        const phone = `+${msg.from}`;
        const at = new Date(Number(msg.timestamp ?? 0) * 1000 || Date.now());
        await withTenant(client, tenantId, (tx) =>
          recordInbound(tx, phone, { text: msg.text?.body ?? msg.button?.text ?? null, at }),
        );
        const payload = msg.button?.payload ?? msg.interactive?.button_reply?.id;
        const answer = payload ? readConfirmPayload(payload) : null;
        if (!answer) continue;
        // The button carries the order's code: the same checks as the SMS link.
        // An answered or expired code finds no order: the store's own language then.
        const text = await withTenant(client, tenantId, async (tx) => {
          const view = await linkView(tx, answer.code);
          if (!view) return REPLIES.gone[(await orderSettings(tx)).defaultLocale]();
          const result = await answerLink(tx, answer.code, answer.action);
          return REPLIES[result][view.locale](view.displayNumber);
        }).catch(() => null);
        if (text) replies.push({ to: phone, text });
      }
    }
    // Replies inside the window the shopper just opened are free (§3.2.5).
    for (const r of replies) {
      await account.api
        .sendText(r.to, r.text)
        .catch((e) =>
          log('warn', 'whatsapp reply not sent', { tenant_id: tenantId, error: String(e) }),
        );
    }
    for (const eventId of resends) await resend(eventId);
    return { status: 'ok' };
  });
}

/**
 * Submits the templates the store's account still needs, one call each, and
 * records Meta's answers (§3.2.3). Returns how many were submitted.
 */
export async function submitTemplates(env: Env, ctx: Ctx, tenantId: string): Promise<number> {
  return withClient(env, ctx, async (client) => {
    const { account, todo } = await withTenant(client, tenantId, async (tx) => ({
      account: await whatsappFor(env, tx),
      todo: await templatesToSubmit(tx),
    }));
    if (!account) return 0;
    for (const t of todo) {
      let result: { id: string; status: string } | { error: string };
      try {
        result = await account.api.createTemplate({
          name: t.name,
          language: t.locale,
          category: 'UTILITY',
          body: t.body,
          examples: t.examples,
          ...(t.event === 'confirm_request'
            ? { quickReplies: [...CONFIRM_BUTTONS[t.locale]] }
            : {}),
        });
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      await withTenant(client, tenantId, (tx) => recordTemplateSubmitted(tx, t, result));
    }
    // What Meta decided since: a listing settles anything still pending.
    try {
      const listed = await account.api.templates();
      await withTenant(client, tenantId, async (tx) => {
        for (const t of listed) await applyTemplateStatus(tx, t);
      });
    } catch (e) {
      log('warn', 'whatsapp templates not listed', { tenant_id: tenantId, error: String(e) });
    }
    return todo.length;
  });
}
