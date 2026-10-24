// Risky phones (phase-5a-plan §3.11, phase-6-plan §3.3): a phone's delivery
// success score from the store's own orders, read at request time in one
// grouped query, so there are no counters to drift and an anonymized
// customer's orders drop out by themselves. Risky is staff's flag, failed
// deliveries at the store's limit, or a score under the store's threshold.
// Risk never refuses an order (the blocklist does that); it asks for the
// delivery charge in advance, or a code by SMS, as the store chose.

import { AppError, normalizePhone } from '@managemind/shared';
import {
  assessPhone,
  emptyPhoneHistory,
  NOT_RECEIVED_CODES,
  type PhoneHistory,
  type PhoneRisk,
} from '@managemind/shared/orders';
import type { TenantSettings } from '@managemind/shared/settings';
import { sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';

export type { PhoneRisk } from '@managemind/shared/orders';

type FraudSettings = Pick<TenantSettings, 'fraud'>;

type Row = {
  phone: string;
  delivered: number;
  returned: number;
  fake: number;
  wrong_number: number;
  no_answer: number;
  cancelled: number;
  open: number;
  flagged: boolean | null;
  failed: number | null;
};

const codes = sql.raw(NOT_RECEIVED_CODES.map((c) => `'${c}'`).join(', '));

/**
 * Each phone's risk, in one query on the (tenant, phone) index. An order
 * counts once: delivered first (a later return still counts as delivered),
 * then a shipment that came back undelivered, then its cancel code.
 * `excludeOrderId` leaves out the order being looked at, so its own
 * cancellation or flag doesn't count against it.
 */
export async function phoneRisks(
  tx: TenantTx,
  phones: readonly string[],
  settings: FraudSettings,
  excludeOrderId?: string | null,
): Promise<Map<string, PhoneRisk>> {
  const unique = [...new Set(phones)];
  const result = new Map<string, PhoneRisk>();
  if (!unique.length) return result;
  const { rows } = await tx.db.execute<Row>(sql`
    with o as (
      select o.phone,
             case
               when o.delivery_status = 'delivered' or o.status = 'completed' then 'delivered'
               when exists (select 1 from store.shipments s
                             where s.order_id = o.id and s.status in ('failed', 'returned'))
                 then 'returned'
               when o.status = 'cancelled' and o.cancel_code in (${codes}) then o.cancel_code
               when o.status = 'cancelled' then 'cancelled'
               else 'open'
             end as fate
        from store.orders o
       where o.phone = any(${sql.param(unique)}::text[])
         and (${excludeOrderId ?? null}::uuid is null or o.id <> ${excludeOrderId ?? null}::uuid)
    ),
    p as (select unnest(${sql.param(unique)}::text[]) as phone)
    select p.phone,
           count(*) filter (where fate = 'delivered')::int as delivered,
           count(*) filter (where fate = 'returned')::int as returned,
           count(*) filter (where fate = 'fake')::int as fake,
           count(*) filter (where fate = 'wrong_number')::int as wrong_number,
           count(*) filter (where fate = 'no_answer')::int as no_answer,
           count(*) filter (where fate = 'cancelled')::int as cancelled,
           count(*) filter (where fate = 'open')::int as open,
           c.flagged, c.failed_deliveries as failed
      from p
      left join o on o.phone = p.phone
      left join store.customers c on c.phone = p.phone and c.deleted_at is null
     group by p.phone, c.flagged, c.failed_deliveries`);
  for (const r of rows) {
    const history: PhoneHistory = {
      delivered: r.delivered,
      returned: r.returned,
      fake: r.fake,
      wrongNumber: r.wrong_number,
      noAnswer: r.no_answer,
      cancelled: r.cancelled,
      open: r.open,
    };
    const customer =
      r.flagged === null ? null : { flagged: r.flagged, failedDeliveries: r.failed ?? 0 };
    result.set(r.phone, assessPhone(history, customer, settings.fraud));
  }
  for (const phone of unique) {
    if (!result.has(phone)) {
      result.set(phone, assessPhone(emptyPhoneHistory(), null, settings.fraud));
    }
  }
  return result;
}

export async function phoneRisk(
  tx: TenantTx,
  phone: string,
  settings: FraudSettings,
  excludeOrderId?: string | null,
): Promise<PhoneRisk> {
  const risks = await phoneRisks(tx, [phone], settings, excludeOrderId);
  return risks.get(phone) as PhoneRisk;
}

/**
 * The score for the manual order screen as soon as a phone is typed
 * (phase-6-plan §3.8): counts only, so every role that reads orders sees it.
 */
export async function getPhoneRisk(
  tx: TenantTx,
  actor: Actor,
  phoneInput: string,
): Promise<PhoneRisk> {
  authorize(actor, 'orders.read');
  const phone = normalizePhone(phoneInput);
  if (!phone) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'phone', code: 'invalid', message: 'must be a Bangladeshi mobile number' }],
    });
  }
  return phoneRisk(tx, phone, (await orderSettings(tx)).settings);
}

// ---- Duplicates (phase-6-plan §3.4) ---------------------------------------------------

export interface PossibleDuplicate {
  id: string;
  number: number;
  placedAt: string;
}

/**
 * The latest order from the same phone within the store's window, not
 * cancelled, with the same set of variants (quantities may differ): the
 * order a new one may duplicate. One query on the phone index; null when
 * the store turned the check off.
 */
export async function findDuplicate(
  tx: TenantTx,
  phone: string,
  variantIds: readonly string[],
  settings: FraudSettings,
  excludeOrderId?: string | null,
): Promise<PossibleDuplicate | null> {
  const minutes = settings.fraud.duplicateMinutes;
  const variants = [...new Set(variantIds)];
  if (minutes === 0 || variants.length === 0) return null;
  const { rows } = await tx.db.execute<{ id: string; number: string; placed_at: string }>(sql`
    select o.id, o.number, o.placed_at from store.orders o
     where o.phone = ${phone} and o.status <> 'cancelled'
       and o.placed_at > now() - make_interval(mins => ${minutes})
       and (${excludeOrderId ?? null}::uuid is null or o.id <> ${excludeOrderId ?? null}::uuid)
       and (select array_agg(l.variant_id) from store.order_lines l where l.order_id = o.id)
           <@ ${sql.param(variants)}::uuid[]
       and (select array_agg(l.variant_id) from store.order_lines l where l.order_id = o.id)
           @> ${sql.param(variants)}::uuid[]
     order by o.placed_at desc limit 1`);
  const r = rows[0];
  return r
    ? { id: r.id, number: Number(r.number), placedAt: new Date(r.placed_at).toISOString() }
    : null;
}

/** Whether the phone is risky: what `cod.advance` and `cod.otp` call "flagged". */
export async function phoneFlagged(
  tx: TenantTx,
  phone: string,
  settings: FraudSettings,
): Promise<boolean> {
  return (await phoneRisk(tx, phone, settings)).risky;
}

/**
 * Whether a cash-on-delivery order from this phone needs a code by SMS first
 * (phase-5a-plan §3.14, Q13): every time, for risky phones, or for a phone's
 * first order. Pass the risk when the caller already has it.
 */
export async function otpRequired(
  tx: TenantTx,
  phone: string,
  settings: Pick<TenantSettings, 'fraud' | 'cod'>,
  risk?: PhoneRisk,
): Promise<boolean> {
  switch (settings.cod.otp) {
    case 'always':
      return true;
    case 'flagged':
      return (risk ?? (await phoneRisk(tx, phone, settings))).risky;
    case 'first_order': {
      const { rows } = await tx.db.execute<{ n: number }>(sql`
        select order_count as n from store.customers where phone = ${phone} and deleted_at is null`);
      return (rows[0]?.n ?? 0) === 0;
    }
    default:
      return false;
  }
}
