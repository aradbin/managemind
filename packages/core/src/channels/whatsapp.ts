// WhatsApp order updates with the store's own number (phase-9-plan §3.2,
// ADR 0032): its templates and Meta's review of them, what the store knows
// of each shopper's WhatsApp (the 24-hour window, opt-out), and SMS as the
// fallback. The delivery log stays the idempotency (ADR 0025): a WhatsApp
// message and the SMS for the same event share their key but the channel,
// so either finds the other.
import { AppError } from '@managemind/shared';
import type { Locale } from '@managemind/shared/money';
import {
  toWhatsappTemplate,
  WHATSAPP_DEFAULTS,
  WHATSAPP_EVENTS,
  type WhatsappEvent,
  whatsappTemplateName,
} from '@managemind/shared/notifications';
import { sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import type { OutboxEvent } from '../outbox';
import type { TenantTx } from '../tenant';

/** Meta's free service messages a month, per number, since October 2026 (§2.1). */
export const FREE_SERVICE_MESSAGES = 1000;
/** How long an SMS waits for WhatsApp to say it got through (Q7). */
export const FALLBACK_SECONDS = 600;

/** Words that mean "stop sending me messages", in English and Bangla (§3.2.4). */
const STOP_WORDS = /^\s*(stop|unsubscribe|বন্ধ|বন্ধ করুন|আর না)\s*[.!।]?\s*$/i;
export const isStopWord = (text: string) => STOP_WORDS.test(text);

export interface ApprovedTemplate {
  name: string;
  /** Our variable for each {{n}}, in order. */
  variables: string[];
  body: string;
}

/** The store's approved templates, by `${event}:${locale}`. */
export async function approvedTemplates(tx: TenantTx): Promise<Map<string, ApprovedTemplate>> {
  const { rows } = await tx.db.execute<{
    event: string;
    locale: string;
    name: string;
    variables: string[];
    body: string;
  }>(sql`select event, locale, name, variables, body from store.whatsapp_templates
          where status = 'approved'`);
  return new Map(
    rows.map((r) => [
      `${r.event}:${r.locale}`,
      { name: r.name, variables: r.variables, body: r.body },
    ]),
  );
}

export interface TemplateToSubmit {
  event: WhatsappEvent;
  locale: Locale;
  name: string;
  body: string;
  variables: string[];
  examples: string[];
}

/**
 * The templates the store's account still needs: a draft row for every event
 * and language, made from the default wording on first use, and every draft
 * or rejected one returned for submission (§3.2.3).
 */
export async function templatesToSubmit(tx: TenantTx): Promise<TemplateToSubmit[]> {
  for (const event of WHATSAPP_EVENTS) {
    for (const locale of ['bn', 'en'] as const) {
      const { variables } = toWhatsappTemplate(WHATSAPP_DEFAULTS[event][locale]);
      await tx.db.execute(sql`
        insert into store.whatsapp_templates (event, locale, name, body, variables)
        values (${event}, ${locale}, ${whatsappTemplateName(event)}, ${WHATSAPP_DEFAULTS[event][locale]},
                ${sql.param(variables)}::text[])
        on conflict do nothing`);
    }
  }
  const { rows } = await tx.db.execute<{
    event: WhatsappEvent;
    locale: Locale;
    name: string;
    body: string;
  }>(sql`select event, locale, name, body from store.whatsapp_templates
          where status in ('draft', 'rejected') order by event, locale`);
  return rows.map((r) => {
    const t = toWhatsappTemplate(r.body);
    return { ...r, variables: t.variables, examples: t.examples };
  });
}

/** Records Meta's answer to a submission. */
export async function recordTemplateSubmitted(
  tx: TenantTx,
  t: { event: string; locale: string },
  result: { id: string; status: string } | { error: string },
): Promise<void> {
  if ('error' in result) {
    await tx.db.execute(sql`
      update store.whatsapp_templates set status = 'rejected', reason = ${result.error.slice(0, 300)},
             submitted_at = now()
       where event = ${t.event} and locale = ${t.locale}`);
    return;
  }
  await tx.db.execute(sql`
    update store.whatsapp_templates
       set status = ${templateStatus(result.status)}, meta_template_id = ${result.id},
           reason = null, submitted_at = now()
     where event = ${t.event} and locale = ${t.locale}`);
}

/** Meta's word for a template's state, as ours. */
function templateStatus(meta: string): string {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'PAUSED':
      return 'paused';
    case 'DISABLED':
      return 'disabled';
    default:
      return 'pending';
  }
}

/** A review's outcome from Meta's webhook, or a listing: matched by name and language. */
export async function applyTemplateStatus(
  tx: TenantTx,
  t: { name: string; language: string; status: string; reason?: string | null },
): Promise<void> {
  await tx.db.execute(sql`
    update store.whatsapp_templates
       set status = ${templateStatus(t.status)}, reason = ${t.reason?.slice(0, 300) ?? null}
     where name = ${t.name} and locale = ${t.language.slice(0, 2)}`);
}

export interface TemplateRow {
  event: string;
  locale: Locale;
  name: string;
  status: string;
  reason: string | null;
  submittedAt: string | null;
}

/** The store's templates and their review, for the settings page (settings.read). */
export async function listWhatsappTemplates(tx: TenantTx, actor: Actor): Promise<TemplateRow[]> {
  authorize(actor, 'settings.read');
  const { rows } = await tx.db.execute<{
    event: string;
    locale: Locale;
    name: string;
    status: string;
    reason: string | null;
    submitted_at: string | null;
  }>(sql`select event, locale, name, status, reason, submitted_at from store.whatsapp_templates
          order by event, locale`);
  return rows.map((r) => ({
    event: r.event,
    locale: r.locale,
    name: r.name,
    status: r.status,
    reason: r.reason,
    submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null,
  }));
}

export interface ContactState {
  /** The shopper wrote within 24 hours: plain messages are allowed (and free, within the allowance). */
  windowOpen: boolean;
  optedOut: boolean;
}

/** What the store knows of a phone's WhatsApp. */
export async function contactState(tx: TenantTx, phone: string): Promise<ContactState> {
  const { rows } = await tx.db.execute<{ open: boolean; out: boolean }>(sql`
    select coalesce(last_inbound_at > now() - interval '24 hours', false) as open,
           opted_out_at is not null as out
      from store.whatsapp_contacts where phone = ${phone}`);
  return { windowOpen: rows[0]?.open ?? false, optedOut: rows[0]?.out ?? false };
}

/** A message from the shopper: their window opens; a stop word opts them out. */
export async function recordInbound(
  tx: TenantTx,
  phone: string,
  options: { text?: string | null; at?: Date } = {},
): Promise<{ optedOut: boolean }> {
  const stop = options.text ? isStopWord(options.text) : false;
  const at = (options.at ?? new Date()).toISOString();
  await tx.db.execute(sql`
    insert into store.whatsapp_contacts (phone, last_inbound_at, opted_out_at)
    values (${phone}, ${at}, ${stop ? sql`now()` : null})
    on conflict (tenant_id, phone) do update
       set last_inbound_at = greatest(store.whatsapp_contacts.last_inbound_at, excluded.last_inbound_at),
           opted_out_at = coalesce(excluded.opted_out_at, store.whatsapp_contacts.opted_out_at)`);
  return { optedOut: stop };
}

/** Plain WhatsApp messages sent this month (Dhaka time), against Meta's free allowance. */
export async function freeServiceUsed(tx: TenantTx): Promise<number> {
  const { rows } = await tx.db.execute<{ n: number }>(sql`
    select count(*)::int as n from store.messages
     where channel = 'whatsapp' and provider = 'whatsapp_text' and status = 'sent'
       and sent_at >= date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`);
  return rows[0]?.n ?? 0;
}

/** The SMS's key for a WhatsApp message's key: they differ only in the channel. */
export const pairedSmsKey = (whatsappKey: string) => whatsappKey.replace(':whatsapp:', ':sms:');

/**
 * A receipt from Meta (§3.2.4). Records it on the message, and settles the
 * SMS waiting for it: sent, delivered or read skip it; failed queues it.
 * Returns the outbox event to run again when an SMS was queued.
 */
export async function applyWhatsappStatus(
  tx: TenantTx,
  receipt: { id: string; status: string; at: Date; error?: string | null },
): Promise<{ resend: string | null }> {
  if (!['sent', 'delivered', 'read', 'failed'].includes(receipt.status)) return { resend: null };
  const { rows } = await tx.db.execute<{ id: string; key: string }>(sql`
    update store.messages
       set delivery_status = case
             -- Receipts can arrive out of order: read beats delivered beats sent.
             when delivery_status = 'read' then delivery_status
             when delivery_status = 'delivered' and ${receipt.status} = 'sent' then delivery_status
             else ${receipt.status} end,
           delivery_at = ${receipt.at.toISOString()},
           reason = case when ${receipt.status} = 'failed' then ${receipt.error?.slice(0, 300) ?? 'failed'} else reason end
     where channel = 'whatsapp' and provider_message_id = ${receipt.id}
     returning id, idempotency_key as key`);
  const message = rows[0];
  if (!message) return { resend: null };
  return settleFallback(tx, message.key, receipt.status === 'failed' ? 'send' : 'skip');
}

/**
 * Settles the SMS waiting for a WhatsApp message: `skip` when WhatsApp got
 * through, `send` when it didn't. Returns the event to run again for `send`.
 */
export async function settleFallback(
  tx: TenantTx,
  whatsappKey: string,
  decision: 'send' | 'skip',
): Promise<{ resend: string | null }> {
  const { rows } = await tx.db.execute<{ key: string }>(sql`
    update store.messages
       set status = ${decision === 'send' ? 'queued' : 'skipped'},
           reason = ${decision === 'send' ? 'whatsapp_failed' : 'sent_by_whatsapp'}
     where idempotency_key = ${pairedSmsKey(whatsappKey)} and status = 'waiting'
     returning idempotency_key as key`);
  const key = rows[0]?.key;
  return { resend: decision === 'send' && key ? (key.split(':')[0] ?? null) : null };
}

/**
 * Ten minutes after the send (Q7): each WhatsApp message of the event that
 * Meta hasn't confirmed lets its SMS go; the rest skip theirs. Returns whether
 * any SMS was queued, so the caller runs the event again.
 */
export async function settleFallbacksOf(tx: TenantTx, eventId: string): Promise<boolean> {
  const { rows } = await tx.db.execute<{ key: string; delivered: boolean }>(sql`
    select idempotency_key as key,
           coalesce(delivery_status in ('sent', 'delivered', 'read'), false) as delivered
      from store.messages
     where channel = 'whatsapp' and idempotency_key like ${`${eventId}:%`}`);
  let queued = false;
  for (const r of rows) {
    const settled = await settleFallback(tx, r.key, r.delivered ? 'skip' : 'send');
    if (settled.resend) queued = true;
  }
  return queued;
}

/** The outbox event a message came from, to plan and send again. */
export async function outboxEvent(tx: TenantTx, eventId: string): Promise<OutboxEvent | null> {
  const { rows } = await tx.db.execute<{
    id: string;
    tenant_id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string | null;
    payload: unknown;
    request_id: string | null;
    created_at: string;
  }>(sql`select id, tenant_id, event_type, aggregate_type, aggregate_id, payload, request_id, created_at
           from store.outbox where id = ${eventId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    eventType: r.event_type as OutboxEvent['eventType'],
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    payload: r.payload,
    requestId: r.request_id,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** A template's values in {{n}} order, from the message's values. */
export function templateValues(
  template: Pick<ApprovedTemplate, 'variables'>,
  values: Readonly<Record<string, string>>,
): string[] {
  return template.variables.map((v) => values[v] ?? '');
}

/** The connection's settings page needs a verify token, made once and kept sealed. */
export function newVerifyToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

/** Refuses a WhatsApp payload naming another number than the store's. */
export function assertOwnNumber(expected: string, got: string | undefined): void {
  if (got !== expected) throw new AppError('not_found');
}
