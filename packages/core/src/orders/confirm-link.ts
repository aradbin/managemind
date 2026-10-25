// The SMS link to confirm or cancel a COD order (phase-6-plan §3.7). The
// code is 10 base-62 characters (about 59 bits), so the SMS stays one part
// in English. It is derived from the order and the send's number with an
// HMAC, so a redelivered event plans the same code, and stored only as a
// SHA-256 hash. A link works while the order is pending, once, for 48
// hours; a wrong code, a used one and an expired one look the same.
import { AppError } from '@managemind/shared';
import {
  formatOrderNumber,
  LINK_CODE,
  type LinkAnswer,
  RECOVERY_LIMITS,
} from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import { type Actor, authorize, shopperActor } from '../access';
import { phoneRisk } from '../fraud/index';
import { emit } from '../outbox';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { inQueueSql } from './confirmation';
import { recordHistory } from './history';
import { cancelOrder, confirmOrder, lockOrder } from './lifecycle';
import type { Localized } from './variants';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const encoder = new TextEncoder();

/** The code of an order's nth link: the same every time it is computed. */
export async function linkCode(
  key: string,
  tenantId: string,
  orderId: string,
  send: number,
): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', k, encoder.encode(`confirm:${tenantId}:${orderId}:${send}`)),
  );
  let n = 0n;
  for (const b of mac.slice(0, 8)) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < RECOVERY_LIMITS.linkCodeLength; i++) {
    out += BASE62[Number(n % 62n)];
    n /= 62n;
  }
  return out;
}

export async function hashLinkCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Records the nth link as sent, for the message plan: its hash, when it
 * expires. Returns the code, or null when the order isn't waiting for
 * confirmation any more. Planning a redelivered event writes the same row.
 */
export async function issueLink(
  tx: TenantTx,
  key: string,
  orderId: string,
  send: number,
): Promise<string | null> {
  const { settings } = await orderSettings(tx);
  const { rows } = await tx.db.execute(sql`
    select 1 from store.orders o where o.id = ${orderId} and ${inQueueSql(settings)}`);
  if (!rows.length) return null;
  const code = await linkCode(key, tx.tenantId, orderId, send);
  const hash = await hashLinkCode(code);
  await tx.db.execute(sql`
    insert into store.order_confirmations (order_id, link_hash, link_sends, link_sent_at, link_expires_at)
    values (${orderId}, ${hash}, ${send}, now(), now() + make_interval(hours => ${RECOVERY_LIMITS.linkHours}))
    on conflict (tenant_id, order_id) do update
      set link_hash = excluded.link_hash, link_sends = greatest(store.order_confirmations.link_sends, ${send}),
          link_sent_at = excluded.link_sent_at, link_expires_at = excluded.link_expires_at
      where store.order_confirmations.link_sends <= ${send}`);
  return code;
}

/** What the link page shows: never the street, never the phone. */
export interface LinkView {
  displayNumber: string;
  locale: 'bn' | 'en';
  storeName: string;
  items: { title: Localized; optionLabels: Localized[]; quantity: number }[];
  total: number;
  codDue: number;
  area: Localized | null;
}

/** The order behind a working link, locked when it is about to be answered. */
async function findLink(tx: TenantTx, code: string, lock: boolean) {
  if (!LINK_CODE.test(code)) return null;
  const hash = await hashLinkCode(code);
  const { rows } = await tx.db.execute<{ order_id: string }>(sql`
    select c.order_id from store.order_confirmations c join store.orders o on o.id = c.order_id
     where c.link_hash = ${hash} and c.link_expires_at > now() and c.link_answered_at is null
       and o.status = 'pending'
     ${lock ? sql`for update of c` : sql``}`);
  return rows[0]?.order_id ?? null;
}

export async function linkView(tx: TenantTx, code: string): Promise<LinkView | null> {
  const orderId = await findLink(tx, code, false);
  if (!orderId) return null;
  const { checkout, name } = await orderSettings(tx);
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select o.number, o.locale, o.total, o.address->'names'->'area' as area,
           (select coalesce(sum(amount), 0) from store.payments p
             where p.order_id = o.id and p.provider = 'cod' and p.status = 'pending') as cod_due,
           (select coalesce(json_agg(json_build_object('title', l.title, 'optionLabels', l.option_labels,
                                                       'quantity', l.quantity) order by l.position), '[]'::json)
              from store.order_lines l where l.order_id = o.id) as items
      from store.orders o where o.id = ${orderId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    displayNumber: formatOrderNumber(checkout.orderNumberPrefix, Number(r.number)),
    locale: r.locale as 'bn' | 'en',
    storeName: name,
    items: r.items as LinkView['items'],
    total: Number(r.total),
    codDue: Number(r.cod_due),
    area: (r.area as Localized) ?? null,
  };
}

export type LinkResult = 'confirmed' | 'noted' | 'cancelled';

/**
 * The shopper's answer. Confirm confirms the order, except a risky phone's
 * when the store calls those first: then the answer is noted and the order
 * stays in the queue, marked "confirmed by SMS, call first". Cancel is the
 * shopper's own cancellation, with its staff alert. Either way the link is used.
 */
export async function answerLink(
  tx: TenantTx,
  code: string,
  action: LinkAnswer,
): Promise<LinkResult> {
  const orderId = await findLink(tx, code, true);
  if (!orderId) throw new AppError('not_found', { detail: 'This link no longer works' });
  await lockOrder(tx, orderId);
  const { settings } = await orderSettings(tx);
  await tx.db.execute(sql`
    update store.order_confirmations set link_answer = ${action}, link_answered_at = now()
     where order_id = ${orderId}`);
  await recordHistory(tx, shopperActor(), {
    orderId,
    machine: 'confirmation',
    from: null,
    to: null,
    event: action === 'confirm' ? 'link_confirmed' : 'link_cancelled',
  });
  if (action === 'cancel') {
    await cancelOrder(tx, shopperActor(), orderId, { reason: 'Cancelled from the SMS link' });
    return 'cancelled';
  }
  const { rows } = await tx.db.execute<{ phone: string }>(
    sql`select phone from store.orders where id = ${orderId}`,
  );
  const risk = await phoneRisk(tx, rows[0]?.phone ?? '', settings, orderId);
  if (risk.risky && settings.confirmation.callRisky) return 'noted';
  await confirmOrder(tx, shopperActor(), orderId, 'link');
  return 'confirmed';
}

/** Staff send the link again (at most twice an order): a new code, the old one stops working. */
export async function resendLink(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  options: { smsReady: boolean },
): Promise<{ sends: number }> {
  authorize(actor, 'orders.write');
  const { settings } = await orderSettings(tx);
  await lockOrder(tx, orderId);
  const refuse = (reason: string, detail: string) =>
    new AppError('illegal_transition', { detail, extensions: { reason } });
  if (!settings.confirmation.smsLink || !options.smsReady) {
    throw refuse('link_off', 'The SMS link is off, or the store has no SMS gateway');
  }
  const { rows } = await tx.db.execute<{ sends: number | null; answered: boolean }>(sql`
    select c.link_sends as sends, c.link_answered_at is not null as answered
      from store.orders o left join store.order_confirmations c on c.order_id = o.id
     where o.id = ${orderId} and ${inQueueSql(settings)}`);
  const row = rows[0];
  if (!row) throw refuse('not_queued', 'This order is not waiting for confirmation');
  if (row.answered) throw refuse('answered', 'The customer already answered the link');
  const sent = row.sends ?? 0;
  if (sent >= 1 + RECOVERY_LIMITS.linkResends) {
    throw refuse('limit', 'The link was sent as often as it can be');
  }
  await emit(tx, 'confirmation.link_requested', {
    aggregateType: 'order',
    aggregateId: orderId,
    payload: { send: sent + 1 },
  });
  return { sends: sent + 1 };
}
