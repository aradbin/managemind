// Couriers' COD payouts and the reconciliation report (phase-7-plan §3.7).
// A payout is one payment from a courier to the store, with a line per
// parcel it covers; a parcel is paid once. Payouts come from the courier's
// own "paid" status, a statement staff import, or a record by hand. The
// report is computed when asked, from shipments and payout lines.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  type Courier,
  codReportQuery,
  type PayoutInput,
  payoutInput,
} from '@managemind/shared/orders';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';

export interface PayoutPreview {
  matched: {
    consignmentId: string;
    shipmentId: string;
    collected: number;
    fee: number;
    net: number;
  }[];
  /** Not a parcel of this store with this courier. */
  unknown: string[];
  /** Already in another payout. */
  alreadyPaid: string[];
  /** Not delivered (yet), so nothing was collected. */
  notDelivered: string[];
  totals: { collected: number; fee: number; net: number };
}

async function matchRows(tx: TenantTx, v: PayoutInput): Promise<PayoutPreview> {
  const ids = [...new Set(v.rows.map((r) => r.consignmentId))];
  const { rows } = await tx.db.execute<{
    id: string;
    consignment_id: string;
    status: string;
    cod_amount: string | null;
    cod_collected: string | null;
    courier_fee: string | null;
    paid: boolean;
  }>(sql`
    select s.id, s.consignment_id, s.status, s.cod_amount, s.cod_collected, s.courier_fee,
           exists (select 1 from store.courier_payout_lines l where l.shipment_id = s.id) as paid
      from store.shipments s
     where s.courier = ${v.courier} and s.consignment_id = any(${sql.param(ids)}::text[])`);
  const found = new Map(rows.map((r) => [r.consignment_id, r]));
  const out: PayoutPreview = {
    matched: [],
    unknown: [],
    alreadyPaid: [],
    notDelivered: [],
    totals: { collected: 0, fee: 0, net: 0 },
  };
  const seen = new Set<string>();
  for (const row of v.rows) {
    if (seen.has(row.consignmentId)) continue;
    seen.add(row.consignmentId);
    const s = found.get(row.consignmentId);
    if (!s) out.unknown.push(row.consignmentId);
    else if (s.paid) out.alreadyPaid.push(row.consignmentId);
    else if (s.status !== 'delivered') out.notDelivered.push(row.consignmentId);
    else {
      const collected = row.collected ?? Number(s.cod_collected ?? s.cod_amount ?? 0);
      const fee = row.fee ?? Number(s.courier_fee ?? 0);
      out.matched.push({
        consignmentId: row.consignmentId,
        shipmentId: s.id,
        collected,
        fee,
        net: collected - fee,
      });
      out.totals.collected += collected;
      out.totals.fee += fee;
      out.totals.net += collected - fee;
    }
  }
  return out;
}

/**
 * A payout recorded by hand or from a statement (§3.7). With `preview`, only
 * what would be matched; otherwise the matched parcels are saved as one
 * payout, and the rest are refused as the preview showed them. Audited.
 */
export async function recordPayout(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<PayoutPreview & { payoutId: string | null }> {
  authorize(actor, 'payments.reconcile');
  const v = parseInput(payoutInput, input);
  const preview = await matchRows(tx, v);
  if (v.preview) return { ...preview, payoutId: null };
  if (!preview.matched.length) {
    throw new AppError('validation_failed', {
      detail: 'No delivered parcel of this courier in the payout',
      fields: [{ path: 'rows', code: 'no_match', message: 'nothing to record' }],
    });
  }
  const p = schema.courierPayouts;
  const [payout] = await tx.db
    .insert(p)
    .values({
      courier: v.courier,
      reference: v.reference,
      paidAt: new Date(v.paidAt),
      amount: Math.max(0, preview.totals.net),
      feeTotal: preview.totals.fee,
      source: v.source,
      recordedBy: actor.userId,
      note: v.note ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: p.id });
  if (!payout) {
    throw new AppError('conflict', { detail: 'A payout with this reference is already recorded' });
  }
  await tx.db.insert(schema.courierPayoutLines).values(
    preview.matched.map((m) => ({
      payoutId: payout.id,
      shipmentId: m.shipmentId,
      collected: m.collected,
      fee: m.fee,
      net: m.net,
    })),
  );
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'courier_payout.recorded',
    entityType: 'courier_payout',
    entityId: payout.id,
    after: {
      courier: v.courier,
      reference: v.reference,
      parcels: preview.matched.length,
      net: preview.totals.net,
      source: v.source,
    },
  });
  return { ...preview, payoutId: payout.id };
}

/** A payout recorded by mistake: its lines go with it, so the parcels are unpaid again. Audited. */
export async function deletePayout(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'payments.reconcile');
  const p = schema.courierPayouts;
  const deleted = await tx.db
    .delete(p)
    .where(eq(p.id, id))
    .returning({ courier: p.courier, reference: p.reference, amount: p.amount });
  const row = deleted[0];
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'courier_payout.deleted',
    entityType: 'courier_payout',
    entityId: id,
    before: row,
  });
}

/**
 * The courier's own "paid" status for a parcel (§3.5): the parcel joins
 * that courier's payout for the day, made when first needed. Nothing when
 * the parcel is already paid or wasn't delivered.
 */
export async function recordCourierPaid(
  tx: TenantTx,
  shipmentId: string,
  courier: Courier,
  at: Date,
): Promise<boolean> {
  const { rows } = await tx.db.execute<{
    status: string;
    collected: string | null;
    fee: string | null;
    paid: boolean;
  }>(sql`
    select status, coalesce(cod_collected, cod_amount, 0) as collected, coalesce(courier_fee, 0) as fee,
           exists (select 1 from store.courier_payout_lines l where l.shipment_id = s.id) as paid
      from store.shipments s where s.id = ${shipmentId}`);
  const s = rows[0];
  if (!s || s.paid || s.status !== 'delivered') return false;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(at);
  const reference = `${courier}-${day}`;
  const collected = Number(s.collected ?? 0);
  const fee = Number(s.fee ?? 0);
  const { rows: payout } = await tx.db.execute<{ id: string }>(sql`
    insert into store.courier_payouts (courier, reference, paid_at, amount, fee_total, source)
    values (${courier}, ${reference}, ${at.toISOString()}, 0, 0, 'courier')
    on conflict (tenant_id, courier, reference) do update set updated_at = now()
    returning id`);
  const payoutId = payout[0]?.id as string;
  await tx.db.insert(schema.courierPayoutLines).values({
    payoutId,
    shipmentId,
    collected,
    fee,
    net: collected - fee,
  });
  await tx.db.execute(sql`
    update store.courier_payouts p
       set amount = greatest(0, (select coalesce(sum(net), 0) from store.courier_payout_lines where payout_id = p.id)),
           fee_total = (select coalesce(sum(fee), 0) from store.courier_payout_lines where payout_id = p.id)
     where p.id = ${payoutId}`);
  return true;
}

export interface CodReport {
  from: string;
  to: string;
  couriers: {
    courier: string;
    delivered: number;
    codAsked: number;
    collected: number;
    fees: number;
    net: number;
    paidOut: number;
    outstanding: number;
    outstandingParcels: number;
    returned: number;
    returnCharges: number;
  }[];
  /** Delivered parcels not yet paid out, oldest first. */
  outstanding: {
    shipmentId: string;
    orderId: string;
    displayNumber: string;
    courier: string;
    consignmentId: string | null;
    deliveredAt: string;
    net: number;
    days: number;
  }[];
  /** Parcels where the courier's numbers disagree with ours. */
  differences: {
    shipmentId: string;
    orderId: string;
    displayNumber: string;
    courier: string;
    consignmentId: string | null;
    asked: number;
    collected: number;
    paidNet: number | null;
    expectedNet: number;
    kind: 'collected' | 'paid';
  }[];
  payouts: {
    id: string;
    courier: string;
    reference: string;
    paidAt: string;
    amount: number;
    fees: number;
    parcels: number;
    source: string;
  }[];
}

/** Reports → COD reconciliation (§3.7): computed when asked, by Dhaka delivery date. */
export async function codReconciliation(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<CodReport> {
  authorize(actor, 'reports.read');
  const v = parseInput(codReportQuery, query);
  const courier = v.courier ?? null;
  const range = sql`s.delivered_at >= (${v.from}::date)::timestamp at time zone 'Asia/Dhaka'
    and s.delivered_at < ((${v.to}::date + 1))::timestamp at time zone 'Asia/Dhaka'`;
  const only = sql`s.courier is not null and (${courier}::text is null or s.courier = ${courier})`;
  const { rows: summary } = await tx.db.execute<Record<string, string | number>>(sql`
    select s.courier,
           count(*) filter (where s.status = 'delivered')::int as delivered,
           coalesce(sum(s.cod_amount) filter (where s.status = 'delivered'), 0) as cod_asked,
           coalesce(sum(coalesce(s.cod_collected, s.cod_amount, 0)) filter (where s.status = 'delivered'), 0) as collected,
           coalesce(sum(coalesce(s.courier_fee, 0)) filter (where s.status = 'delivered'), 0) as fees,
           coalesce(sum(l.net), 0) as paid_out,
           count(*) filter (where s.status = 'delivered' and l.shipment_id is null)::int as outstanding_parcels
      from store.shipments s
      left join store.courier_payout_lines l on l.shipment_id = s.id
     where ${only} and ${range}
     group by s.courier order by s.courier`);
  const { rows: returns } = await tx.db.execute<{
    courier: string;
    n: number;
    charges: string;
  }>(sql`
    select s.courier, count(*)::int as n, coalesce(sum(coalesce(s.return_charge, s.return_cost, 0)), 0) as charges
      from store.shipments s
     where ${only} and s.status in ('failed', 'returned')
       and s.failed_at >= (${v.from}::date)::timestamp at time zone 'Asia/Dhaka'
       and s.failed_at < ((${v.to}::date + 1))::timestamp at time zone 'Asia/Dhaka'
     group by s.courier`);
  const returned = new Map(returns.map((r) => [r.courier, r]));
  const { rows: prefix } = await tx.db.execute<{ prefix: string | null }>(sql`
    select settings #>> '{checkout,orderNumberPrefix}' as prefix from platform.tenants
     where id = app.current_tenant_id()`);
  const pre = prefix[0]?.prefix ?? '#';
  const { rows: open } = await tx.db.execute<Record<string, unknown>>(sql`
    select s.id, s.order_id, o.number, s.courier, s.consignment_id, s.delivered_at,
           coalesce(s.cod_collected, s.cod_amount, 0) - coalesce(s.courier_fee, 0) as net
      from store.shipments s join store.orders o on o.id = s.order_id
     where ${only} and ${range} and s.status = 'delivered'
       and not exists (select 1 from store.courier_payout_lines l where l.shipment_id = s.id)
     order by s.delivered_at limit 200`);
  const { rows: diffs } = await tx.db.execute<Record<string, unknown>>(sql`
    select s.id, s.order_id, o.number, s.courier, s.consignment_id,
           coalesce(s.cod_amount, 0) as asked, coalesce(s.cod_collected, s.cod_amount, 0) as collected,
           l.net as paid_net,
           coalesce(s.cod_collected, s.cod_amount, 0) - coalesce(s.courier_fee, 0) as expected_net
      from store.shipments s join store.orders o on o.id = s.order_id
      left join store.courier_payout_lines l on l.shipment_id = s.id
     where ${only} and ${range} and s.status = 'delivered'
       and (s.cod_collected is distinct from s.cod_amount and s.cod_collected is not null
            or (l.net is not null and l.net <> coalesce(s.cod_collected, s.cod_amount, 0) - coalesce(s.courier_fee, 0)))
     order by s.delivered_at limit 200`);
  const { rows: payouts } = await tx.db.execute<Record<string, unknown>>(sql`
    select p.id, p.courier, p.reference, p.paid_at, p.amount, p.fee_total, p.source,
           (select count(*)::int from store.courier_payout_lines l where l.payout_id = p.id) as parcels
      from store.courier_payouts p
     where (${courier}::text is null or p.courier = ${courier})
       and p.paid_at >= (${v.from}::date)::timestamp at time zone 'Asia/Dhaka'
       and p.paid_at < ((${v.to}::date + 1))::timestamp at time zone 'Asia/Dhaka'
     order by p.paid_at desc limit 200`);
  const now = Date.now();
  const n = (x: unknown) => Number(x ?? 0);
  return {
    from: v.from,
    to: v.to,
    couriers: summary.map((r) => {
      const ret = returned.get(String(r.courier));
      const net = n(r.collected) - n(r.fees);
      return {
        courier: String(r.courier),
        delivered: n(r.delivered),
        codAsked: n(r.cod_asked),
        collected: n(r.collected),
        fees: n(r.fees),
        net,
        paidOut: n(r.paid_out),
        outstanding: net - n(r.paid_out),
        outstandingParcels: n(r.outstanding_parcels),
        returned: ret?.n ?? 0,
        returnCharges: n(ret?.charges),
      };
    }),
    outstanding: open.map((r) => ({
      shipmentId: String(r.id),
      orderId: String(r.order_id),
      displayNumber: `${pre}${r.number}`,
      courier: String(r.courier),
      consignmentId: (r.consignment_id as string) ?? null,
      deliveredAt: new Date(r.delivered_at as string).toISOString(),
      net: n(r.net),
      days: Math.floor((now - new Date(r.delivered_at as string).getTime()) / 86_400_000),
    })),
    differences: diffs.map((r) => ({
      shipmentId: String(r.id),
      orderId: String(r.order_id),
      displayNumber: `${pre}${r.number}`,
      courier: String(r.courier),
      consignmentId: (r.consignment_id as string) ?? null,
      asked: n(r.asked),
      collected: n(r.collected),
      paidNet: r.paid_net === null ? null : n(r.paid_net),
      expectedNet: n(r.expected_net),
      kind: r.paid_net !== null && n(r.paid_net) !== n(r.expected_net) ? 'paid' : 'collected',
    })),
    payouts: payouts.map((r) => ({
      id: String(r.id),
      courier: String(r.courier),
      reference: String(r.reference),
      paidAt: new Date(r.paid_at as string).toISOString(),
      amount: n(r.amount),
      fees: n(r.fee_total),
      parcels: n(r.parcels),
      source: String(r.source),
    })),
  };
}
