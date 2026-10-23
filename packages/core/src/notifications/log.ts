// The delivery log and rendering (phase-5a-plan §3.6, §3.7). Planned
// messages are written once each, keyed by event, channel and recipient;
// what still needs sending is whatever is `queued`, so a redelivered event
// sends only what a failure left behind.
import { schema } from '@managemind/db';
import type { Locale } from '@managemind/shared/money';
import {
  type Channel,
  defaultTemplate,
  type MessageEvent,
  renderTemplate,
} from '@managemind/shared/notifications';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';
import type { PlannedMessage } from './plan';

const m = schema.messages;

export interface QueuedMessage extends PlannedMessage {
  id: string;
  attempts: number;
}

/** Writes new planned messages and returns the ones still to send, new or left by a failure. */
export async function recordMessages(
  tx: TenantTx,
  planned: readonly PlannedMessage[],
): Promise<QueuedMessage[]> {
  if (!planned.length) return [];
  await tx.db
    .insert(m)
    .values(
      planned.map((p) => ({
        idempotencyKey: p.idempotencyKey,
        event: p.event,
        channel: p.channel,
        recipientType: p.recipientType,
        recipient: p.recipient,
        orderId: p.orderId,
        locale: p.locale,
        status: p.skip ? ('skipped' as const) : ('queued' as const),
        reason: p.skip,
      })),
    )
    .onConflictDoNothing({ target: [m.tenantId, m.idempotencyKey] });
  const rows = await tx.db
    .select({ id: m.id, key: m.idempotencyKey, attempts: m.attempts })
    .from(m)
    .where(
      and(
        inArray(
          m.idempotencyKey,
          planned.map((p) => p.idempotencyKey),
        ),
        eq(m.status, 'queued'),
      ),
    );
  const byKey = new Map(planned.map((p) => [p.idempotencyKey, p]));
  return rows.flatMap((r) => {
    const p = byKey.get(r.key);
    return p ? [{ ...p, id: r.id, attempts: r.attempts }] : [];
  });
}

export type MessageOutcome =
  | { status: 'sent'; provider: string; providerMessageId?: string | null }
  | { status: 'skipped'; reason: string }
  /** `retry` leaves it queued for the queue's next attempt; otherwise it fails for good. */
  | { status: 'failed'; reason: string; retry: boolean; provider?: string };

export async function markMessage(tx: TenantTx, id: string, outcome: MessageOutcome) {
  const base = { attempts: sql`${m.attempts} + 1` };
  if (outcome.status === 'sent') {
    await tx.db
      .update(m)
      .set({
        ...base,
        status: 'sent',
        reason: null,
        provider: outcome.provider,
        providerMessageId: outcome.providerMessageId?.slice(0, 200) ?? null,
        sentAt: new Date(),
      })
      .where(eq(m.id, id));
  } else if (outcome.status === 'skipped') {
    await tx.db.update(m).set({ status: 'skipped', reason: outcome.reason }).where(eq(m.id, id));
  } else {
    await tx.db
      .update(m)
      .set({
        ...base,
        status: outcome.retry ? 'queued' : 'failed',
        reason: outcome.reason.slice(0, 300),
        provider: outcome.provider ?? null,
      })
      .where(eq(m.id, id));
  }
}

export interface RenderedMessage {
  /** Email subject or push title. */
  subject: string;
  body: string;
}

/** The store's template for the event, channel and locale, or the default; null when none applies. */
export async function renderMessage(
  tx: TenantTx,
  message: Pick<PlannedMessage, 'event' | 'channel' | 'locale' | 'values'>,
  mode: 'html' | 'plain' = 'plain',
): Promise<RenderedMessage | null> {
  const template = await templateFor(tx, message.event, message.channel, message.locale);
  if (!template) return null;
  return {
    subject: renderTemplate(template.subject ?? '', message.values, 'plain'),
    body: renderTemplate(template.body, message.values, mode),
  };
}

async function templateFor(
  tx: TenantTx,
  event: MessageEvent,
  channel: Channel,
  locale: Locale,
): Promise<{ subject?: string | undefined; body: string } | null> {
  const t = schema.messageTemplates;
  const [own] = await tx.db
    .select({ subject: t.subject, body: t.body })
    .from(t)
    .where(and(eq(t.event, event), eq(t.channel, channel), eq(t.locale, locale)));
  if (own) return { subject: own.subject ?? undefined, body: own.body };
  return defaultTemplate(event, channel, locale);
}
