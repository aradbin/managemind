// The confirmation queue (phase-6-plan §3.5, §3.6): every pending order
// with an amount to collect on delivery (and, if the store says so, orders
// paid in full online), called one at a time. Opening an order's call
// panel claims it for 5 minutes with a conditional update, so two staff
// never call the same order. Each call's outcome is a history row; "due
// again" is a time the queue compares with now, so nothing runs on a timer.
import { AppError, formatPhone } from '@managemind/shared';
import {
  type ConfirmationOutcome,
  type ConfirmationQuery,
  type ConfirmedVia,
  confirmationOutcomeInput,
  confirmationQuery,
  formatOrderNumber,
  type LinkAnswer,
  RECOVERY_LIMITS,
  renderCallScript,
} from '@managemind/shared/orders';
import type { TenantSettings } from '@managemind/shared/settings';
import { type SQL, sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { blockPhone } from '../customers/blocklist';
import { type PhoneRisk, phoneRisks } from '../fraud/index';
import { formatTaka } from '../notifications/plan';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { recordHistory } from './history';
import { cancelOrder, confirmOrder, lockOrder } from './lifecycle';
import type { Localized } from './variants';
import { maskPhone } from './views';

const iso = (d: unknown) =>
  d === null || d === undefined ? null : new Date(d as string).toISOString();
const pick = (v: Localized | null | undefined, locale: 'bn' | 'en') =>
  v?.[locale] ?? v?.[locale === 'bn' ? 'en' : 'bn'] ?? '';

/**
 * Which orders wait in the queue: pending, not waiting for an online
 * advance, with something to collect on delivery, or paid in full online
 * when the store includes those.
 */
export function inQueueSql(settings: Pick<TenantSettings, 'confirmation'>): SQL {
  const cod = sql`exists (select 1 from store.payments p
                           where p.order_id = o.id and p.provider = 'cod' and p.status = 'pending'
                             and p.amount > 0)`;
  return sql`o.status = 'pending'
    and not exists (select 1 from store.payments p
                     where p.order_id = o.id and p.provider = 'sslcommerz' and p.status = 'pending')
    and (${cod} ${settings.confirmation.includePaid ? sql`or o.payment_status = 'paid'` : sql``})`;
}

export interface QueueItem {
  orderId: string;
  displayNumber: string;
  name: string;
  phone: string;
  locale: 'bn' | 'en';
  items: { title: Localized; quantity: number }[];
  itemCount: number;
  total: number;
  codDue: number;
  area: Localized | null;
  risk: PhoneRisk;
  flags: string[];
  attempts: number;
  lastOutcome: ConfirmationOutcome | null;
  lastNote: string | null;
  dueAt: string | null;
  /** Someone else is calling: their name, until when. */
  claim: { userId: string; name: string; until: string; mine: boolean } | null;
  /** The shopper answered the SMS link (a risky phone's order still waits for a call). */
  linkAnswer: LinkAnswer | null;
  placedAt: string;
}

export interface Queue {
  /** The store turned the queue off: nothing waits. */
  enabled: boolean;
  counts: { toCall: number; later: number; unreachable: number };
  items: QueueItem[];
}

const TAB_WHERE: Record<ConfirmationQuery['tab'], SQL> = {
  to_call: sql`not ('unreachable' = any(o.flags)) and (c.due_at is null or c.due_at <= now())`,
  risky: sql`not ('unreachable' = any(o.flags)) and (c.due_at is null or c.due_at <= now())`,
  later: sql`not ('unreachable' = any(o.flags)) and c.due_at > now()`,
  unreachable: sql`'unreachable' = any(o.flags)`,
};

/** The queue's tab, oldest first; Risky first sorts the To call tab by risk. */
export async function listConfirmations(
  tx: TenantTx,
  actor: Actor,
  query: unknown = {},
): Promise<Queue> {
  authorize(actor, 'orders.read');
  const q = parseInput(confirmationQuery, query);
  const { settings, checkout } = await orderSettings(tx);
  if (!settings.confirmation.queue) {
    return { enabled: false, counts: { toCall: 0, later: 0, unreachable: 0 }, items: [] };
  }
  const queue = inQueueSql(settings);
  const { rows: counts } = await tx.db.execute<{
    to_call: number;
    later: number;
    unreachable: number;
  }>(sql`
    select count(*) filter (where ${TAB_WHERE.to_call})::int as to_call,
           count(*) filter (where ${TAB_WHERE.later})::int as later,
           count(*) filter (where ${TAB_WHERE.unreachable})::int as unreachable
      from store.orders o left join store.order_confirmations c on c.order_id = o.id
     where ${queue}`);
  const order =
    q.tab === 'risky'
      ? sql`('flagged_phone' = any(o.flags)) desc, coalesce(o.phone_score, 101), o.placed_at`
      : q.tab === 'later'
        ? sql`c.due_at, o.placed_at`
        : sql`o.placed_at`;
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select o.id, o.number, o.contact->>'name' as name, o.phone, o.locale, o.total, o.flags,
           o.address->'names'->'area' as area, o.placed_at,
           (select coalesce(sum(amount), 0) from store.payments p
             where p.order_id = o.id and p.provider = 'cod' and p.status = 'pending') as cod_due,
           (select coalesce(json_agg(json_build_object('title', l.title, 'quantity', l.quantity)
                                     order by l.position), '[]'::json)
              from store.order_lines l where l.order_id = o.id) as items,
           c.attempts, c.last_outcome, c.last_note, c.due_at, c.claimed_by, c.claimed_until,
           c.link_answer, coalesce(c.claimed_until > now(), false) as claimed,
           u.name as claimed_name
      from store.orders o
      left join store.order_confirmations c on c.order_id = o.id
      left join platform.users u on u.id = c.claimed_by
     where ${queue} and ${TAB_WHERE[q.tab]}
     order by ${order} limit ${q.limit ?? 50}`);
  const risks = await phoneRisks(
    tx,
    rows.map((r) => r.phone as string),
    settings,
  );
  const personal = actor.permissions.has('customers.read');
  return {
    enabled: true,
    counts: {
      toCall: counts[0]?.to_call ?? 0,
      later: counts[0]?.later ?? 0,
      unreachable: counts[0]?.unreachable ?? 0,
    },
    items: rows.map((r): QueueItem => {
      const items = r.items as { title: Localized; quantity: number }[];
      const claimed = Boolean(r.claimed);
      return {
        orderId: r.id as string,
        displayNumber: formatOrderNumber(checkout.orderNumberPrefix, Number(r.number)),
        name: r.name as string,
        phone: personal ? (r.phone as string) : maskPhone(r.phone as string),
        locale: r.locale as 'bn' | 'en',
        items: items.slice(0, 5),
        itemCount: items.reduce((n, i) => n + i.quantity, 0),
        total: Number(r.total),
        codDue: Number(r.cod_due),
        area: (r.area as Localized) ?? null,
        risk: risks.get(r.phone as string) as PhoneRisk,
        flags: r.flags as string[],
        attempts: Number(r.attempts ?? 0),
        lastOutcome: (r.last_outcome as ConfirmationOutcome) ?? null,
        lastNote: (r.last_note as string) ?? null,
        dueAt: iso(r.due_at),
        claim: claimed
          ? {
              userId: r.claimed_by as string,
              name: (r.claimed_name as string) ?? '',
              until: iso(r.claimed_until) as string,
              mine: r.claimed_by === actor.userId,
            }
          : null,
        linkAnswer: (r.link_answer as LinkAnswer) ?? null,
        placedAt: iso(r.placed_at) as string,
      };
    }),
  };
}

export interface CallPanel {
  orderId: string;
  displayNumber: string;
  name: string;
  phone: string;
  /** The store's script in the order's language, filled in (§3.6). */
  script: string;
  claimedUntil: string;
  attempts: number;
  maxAttempts: number;
}

/** The order's queue row, made on first use. */
async function ensureRow(tx: TenantTx, orderId: string) {
  await tx.db.execute(sql`
    insert into store.order_confirmations (order_id) values (${orderId})
    on conflict (tenant_id, order_id) do nothing`);
}

async function assertQueued(tx: TenantTx, orderId: string, settings: TenantSettings) {
  const { rows } = await tx.db.execute(sql`
    select 1 from store.orders o where o.id = ${orderId} and ${inQueueSql(settings)}`);
  if (!rows.length) {
    const { rows: exists } = await tx.db.execute(
      sql`select 1 from store.orders where id = ${orderId}`,
    );
    if (!exists.length) throw new AppError('not_found');
    throw new AppError('illegal_transition', {
      detail: 'This order is not waiting for confirmation',
      extensions: { reason: 'not_queued' },
    });
  }
}

/**
 * Claims the order for the caller for 5 minutes and returns the call
 * panel. A second person gets 409 with the caller's name; the same person
 * claiming again extends their claim.
 */
export async function claimConfirmation(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
): Promise<CallPanel> {
  authorize(actor, 'orders.write');
  const { settings, checkout, name: storeName } = await orderSettings(tx);
  await assertQueued(tx, orderId, settings);
  await ensureRow(tx, orderId);
  const { rows } = await tx.db.execute<{ claimed_until: string; attempts: number }>(sql`
    update store.order_confirmations
       set claimed_by = ${actor.userId}::uuid,
           claimed_until = now() + make_interval(mins => ${RECOVERY_LIMITS.claimMinutes})
     where order_id = ${orderId}
       and (claimed_by is null or claimed_until < now() or claimed_by = ${actor.userId}::uuid)
    returning claimed_until, attempts`);
  if (!rows[0]) {
    const { rows: holder } = await tx.db.execute<{ name: string; until: string }>(sql`
      select u.name, c.claimed_until as until from store.order_confirmations c
        join platform.users u on u.id = c.claimed_by where c.order_id = ${orderId}`);
    throw new AppError('conflict', {
      detail: 'Someone else is calling this order',
      extensions: {
        reason: 'claimed',
        claimedBy: holder[0]?.name ?? null,
        until: iso(holder[0]?.until),
      },
    });
  }
  const { rows: o } = await tx.db.execute<Record<string, unknown>>(sql`
    select o.number, o.contact->>'name' as name, o.phone, o.locale, o.total,
           o.address->'names'->'area' as area, z.estimate,
           (select coalesce(sum(amount), 0) from store.payments p
             where p.order_id = o.id and p.provider = 'cod' and p.status = 'pending') as cod_due,
           (select coalesce(json_agg(json_build_object('title', l.title, 'quantity', l.quantity)
                                     order by l.position), '[]'::json)
              from store.order_lines l where l.order_id = o.id) as items
      from store.orders o left join store.delivery_zones z on z.id = o.zone_id
     where o.id = ${orderId}`);
  const r = o[0] as Record<string, unknown>;
  const locale = r.locale as 'bn' | 'en';
  const displayNumber = formatOrderNumber(checkout.orderNumberPrefix, Number(r.number));
  const items = (r.items as { title: Localized; quantity: number }[])
    .map((i) => `${pick(i.title, locale)} × ${i.quantity}`)
    .join(', ');
  const script = renderCallScript(settings.confirmation.script, locale, {
    name: r.name as string,
    order_number: displayNumber,
    items,
    total: formatTaka(Number(r.total), locale),
    cod_amount: formatTaka(Number(r.cod_due), locale),
    area: pick(r.area as Localized, locale),
    delivery_estimate: pick(r.estimate as Localized, locale),
    store_name: storeName,
  });
  return {
    orderId,
    displayNumber,
    name: r.name as string,
    phone: actor.permissions.has('customers.read')
      ? (r.phone as string)
      : maskPhone(r.phone as string),
    script,
    claimedUntil: iso(rows[0].claimed_until) as string,
    attempts: Number(rows[0].attempts),
    maxAttempts: settings.confirmation.maxAttempts,
  };
}

export interface OutcomeResult {
  orderId: string;
  status: string;
  attempts: number;
  dueAt: string | null;
  unreachable: boolean;
}

/**
 * Records one call. Confirmed confirms the order; no answer counts an
 * attempt and is due again later, flagging the order unreachable at the
 * store's limit (and cancelling it, if the store says so); call back is due
 * at the time chosen; wrong number and cancelled cancel it with their code.
 */
export async function recordOutcome(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<OutcomeResult> {
  authorize(actor, 'orders.write');
  const v = parseInput(confirmationOutcomeInput, input);
  const { settings } = await orderSettings(tx);
  const order = await lockOrder(tx, orderId);
  await assertQueued(tx, orderId, settings);
  await ensureRow(tx, orderId);
  const { rows: held } = await tx.db.execute<{ attempts: number; other: boolean; phone: string }>(
    sql`
    select c.attempts, coalesce(c.claimed_until > now() and c.claimed_by <> ${actor.userId}::uuid,
                                false) as other, o.phone
      from store.order_confirmations c join store.orders o on o.id = c.order_id
     where c.order_id = ${orderId} for update of c`,
  );
  const row = held[0];
  if (!row) throw new AppError('not_found');
  if (row.other) {
    throw new AppError('conflict', {
      detail: 'Someone else is calling this order',
      extensions: { reason: 'claimed' },
    });
  }
  const c = settings.confirmation;
  let attempts = Number(row.attempts);
  let dueAt: string | null = null;
  let unreachable = false;
  const note = v.note ?? null;

  switch (v.outcome) {
    case 'confirmed':
      break;
    case 'no_answer': {
      attempts += 1;
      unreachable = attempts >= c.maxAttempts;
      dueAt = new Date(Date.now() + c.retryAfterMinutes * 60_000).toISOString();
      break;
    }
    case 'call_back': {
      const at = Date.parse(v.dueAt as string);
      if (at <= Date.now() || at > Date.now() + 7 * 86_400_000) {
        throw new AppError('validation_failed', {
          fields: [{ path: 'dueAt', code: 'out_of_range', message: 'within the next 7 days' }],
        });
      }
      dueAt = new Date(at).toISOString();
      break;
    }
    default:
      break;
  }

  await tx.db.execute(sql`
    update store.order_confirmations
       set attempts = ${attempts}, last_outcome = ${v.outcome}, last_note = ${note},
           due_at = ${dueAt}::timestamptz, claimed_by = null, claimed_until = null
     where order_id = ${orderId}`);
  await recordHistory(tx, actor, {
    orderId,
    machine: 'confirmation',
    from: null,
    to: null,
    event: v.outcome,
    reason: note,
    data: {
      attempts,
      ...(dueAt ? { dueAt } : {}),
      ...(v.code ? { code: v.code } : {}),
    },
  });

  let status: string = order.status;
  if (v.outcome === 'confirmed') {
    status = (await confirmOrder(tx, actor, orderId, 'call')).status;
  } else if (v.outcome === 'wrong_number') {
    status = (
      await cancelOrder(tx, actor, orderId, {
        reason: note ?? 'Wrong number',
        code: 'wrong_number',
      })
    ).status;
    if (v.block) {
      await blockPhone(tx, actor, {
        phone: formatPhone(row.phone),
        reason: note ?? 'Wrong number',
      });
    }
  } else if (v.outcome === 'cancelled') {
    status = (
      await cancelOrder(tx, actor, orderId, {
        reason: note ?? v.code ?? 'other',
        code: v.code ?? 'other',
      })
    ).status;
  } else if (unreachable) {
    await tx.db.execute(sql`
      update store.orders set flags = array_append(array_remove(flags, 'unreachable'), 'unreachable')
       where id = ${orderId}`);
    if (c.cancelUnreachable) {
      status = (
        await cancelOrder(tx, actor, orderId, {
          reason: note ?? `No answer after ${attempts} calls`,
          code: 'no_answer',
        })
      ).status;
    }
  }
  return { orderId, status, attempts, dueAt, unreachable };
}

/** The order's place in the queue, for its detail page. */
export interface ConfirmationState {
  inQueue: boolean;
  attempts: number;
  lastOutcome: ConfirmationOutcome | null;
  dueAt: string | null;
  confirmedVia: ConfirmedVia | null;
  linkSentAt: string | null;
  linkAnswer: LinkAnswer | null;
}

export async function confirmationState(
  tx: TenantTx,
  orderId: string,
  settings: TenantSettings,
): Promise<ConfirmationState | null> {
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select ${settings.confirmation.queue ? sql`(${inQueueSql(settings)})` : sql`false`} as in_queue,
           c.attempts, c.last_outcome, c.due_at, c.confirmed_via, c.link_sent_at, c.link_answer
      from store.orders o left join store.order_confirmations c on c.order_id = o.id
     where o.id = ${orderId}`);
  const r = rows[0];
  if (!r || (!r.in_queue && r.attempts === null)) return null;
  return {
    inQueue: Boolean(r.in_queue),
    attempts: Number(r.attempts ?? 0),
    lastOutcome: (r.last_outcome as ConfirmationOutcome) ?? null,
    dueAt: iso(r.due_at),
    confirmedVia: (r.confirmed_via as ConfirmedVia) ?? null,
    linkSentAt: iso(r.link_sent_at),
    linkAnswer: (r.link_answer as LinkAnswer) ?? null,
  };
}
