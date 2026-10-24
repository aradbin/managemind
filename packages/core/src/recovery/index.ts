// Incomplete orders (phase-6-plan §3.2): a checkout the shopper left after
// typing a valid phone, saved with a copy of the cart's lines, for staff to
// call and turn into an order. One record per cart, replaced by each save;
// nothing is ever sent to the shopper because of it. A shopper who says
// "Don't save" deletes it and stops further saves from that cart. Records
// are deleted keepDays after their last change by the daily cleanup.
import { schema } from '@managemind/db';
import { AppError, formatPhone } from '@managemind/shared';
import {
  checkoutDraftInput,
  type IncompleteListQuery,
  type IncompleteOrderStatus,
  incompleteListQuery,
  incompleteNoteInput,
  RECOVERY_LIMITS,
} from '@managemind/shared/orders';
import { eq, type SQL, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { cartByToken, cartView } from '../cart/service';
import { parseInput } from '../catalog/common';
import { type PhoneRisk, phoneRisks } from '../fraud/index';
import { effectivePriceSql, type Localized } from '../orders/variants';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';

const iso = (d: unknown) =>
  d === null || d === undefined ? null : new Date(d as string).toISOString();

export interface IncompleteLine {
  variantId: string;
  quantity: number;
  title: Localized;
  optionLabels: Localized[];
  /** The price the checkout showed. */
  price: number;
}

/**
 * Saves the cart's checkout as typed so far. A no-op (false) when the
 * store doesn't save incomplete checkouts or the cart is empty; refused
 * for a cart whose shopper chose "Don't save".
 */
export async function saveCheckoutDraft(
  tx: TenantTx,
  cartToken: string | null | undefined,
  input: unknown,
): Promise<boolean> {
  const v = parseInput(checkoutDraftInput, input);
  const { settings } = await orderSettings(tx);
  if (!settings.recovery.incomplete) return false;
  const cart = await cartByToken(tx, cartToken, { forUpdate: true });
  if (!cart) throw new AppError('not_found', { detail: 'No cart' });
  const [flags] = await tx.db
    .select({ optOut: schema.carts.recoveryOptOut })
    .from(schema.carts)
    .where(eq(schema.carts.id, cart.id));
  if (flags?.optOut) {
    throw new AppError('conflict', {
      detail: 'The shopper chose not to save this checkout',
      extensions: { reason: 'opted_out' },
    });
  }
  const view = await cartView(tx, cart);
  const lines: IncompleteLine[] = view.quote.lines
    .slice(0, RECOVERY_LIMITS.incompleteLines)
    .map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      title: l.title,
      optionLabels: l.optionLabels,
      price: l.unitPrice,
    }));
  if (!lines.length) return false;
  await tx.db.execute(sql`
    insert into store.incomplete_orders (cart_id, phone, name, email, address, lines, subtotal, locale)
    values (${cart.id}, ${v.phone}, ${v.name || null}, ${v.email || null}, ${JSON.stringify(v.address)}::jsonb,
            ${JSON.stringify(lines)}::jsonb, ${view.quote.totals.subtotal}, ${view.locale})
    on conflict (tenant_id, cart_id) where cart_id is not null do update
      set phone = excluded.phone, name = excluded.name, email = excluded.email,
          address = excluded.address, lines = excluded.lines, subtotal = excluded.subtotal,
          locale = excluded.locale`);
  return true;
}

/** Whether this cart's checkout may be saved: its shopper didn't choose "Don't save". */
export async function draftAllowed(tx: TenantTx, cartId: string): Promise<boolean> {
  const [row] = await tx.db
    .select({ optOut: schema.carts.recoveryOptOut })
    .from(schema.carts)
    .where(eq(schema.carts.id, cartId));
  return row ? !row.optOut : false;
}

/** "Don't save": the record goes, and the cart saves nothing more. */
export async function optOutCheckoutDraft(
  tx: TenantTx,
  cartToken: string | null | undefined,
): Promise<void> {
  const cart = await cartByToken(tx, cartToken, { forUpdate: true });
  if (!cart) return;
  await tx.db.execute(sql`delete from store.incomplete_orders where cart_id = ${cart.id}`);
  await tx.db
    .update(schema.carts)
    .set({ recoveryOptOut: true })
    .where(eq(schema.carts.id, cart.id));
}

/**
 * Closes the records an order answers (placeOrder calls it): the one it was
 * made from becomes converted; the cart's own and any open one from the
 * same phone become recovered.
 */
export async function closeIncompleteOrders(
  tx: TenantTx,
  order: { id: string; phone: string; cartId: string | null; fromIncomplete?: string | null },
): Promise<void> {
  if (order.fromIncomplete) {
    const { rows } = await tx.db.execute(sql`
      update store.incomplete_orders set status = 'converted', order_id = ${order.id}
       where id = ${order.fromIncomplete} and status in ('open', 'contacted') returning id`);
    if (!rows.length) {
      throw new AppError('conflict', {
        detail: 'This incomplete order was already closed',
        extensions: { reason: 'incomplete_closed' },
      });
    }
  }
  await tx.db.execute(sql`
    update store.incomplete_orders set status = 'recovered', order_id = ${order.id}
     where status in ('open', 'contacted')
       and (cart_id = ${order.cartId}::uuid or phone = ${order.phone})`);
}

export interface IncompleteSummary {
  id: string;
  status: IncompleteOrderStatus;
  name: string | null;
  phone: string;
  area: { divisionId?: number; districtId?: number; areaId?: number } | null;
  itemCount: number;
  subtotal: number;
  /** The first lines' titles, for the list. */
  items: { title: Localized; quantity: number }[];
  risk: PhoneRisk;
  note: string | null;
  contactedAt: string | null;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
}

const TAB_WHERE: Record<IncompleteListQuery['tab'], SQL> = {
  open: sql`i.status in ('open', 'contacted')`,
  converted: sql`i.status = 'converted'`,
  recovered: sql`i.status = 'recovered'`,
  dismissed: sql`i.status = 'dismissed'`,
};

function summary(r: Record<string, unknown>, risks: Map<string, PhoneRisk>): IncompleteSummary {
  const lines = r.lines as IncompleteLine[];
  const address = (r.address ?? {}) as Record<string, unknown>;
  return {
    id: r.id as string,
    status: r.status as IncompleteOrderStatus,
    name: (r.name as string) ?? null,
    phone: r.phone as string,
    area: Object.keys(address).length ? (address as IncompleteSummary['area']) : null,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: Number(r.subtotal),
    items: lines.slice(0, 3).map((l) => ({ title: l.title, quantity: l.quantity })),
    risk: risks.get(r.phone as string) as PhoneRisk,
    note: (r.note as string) ?? null,
    contactedAt: iso(r.contacted_at),
    orderId: (r.order_id as string) ?? null,
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
  };
}

const readAccess = (actor: Actor) => {
  authorize(actor, 'orders.read');
  authorize(actor, 'customers.read');
};

/**
 * The list, newest change first. Open records show only once the shopper
 * has stopped typing for the store's showAfterMinutes, so nobody calls a
 * shopper still at checkout.
 */
export async function listIncompleteOrders(
  tx: TenantTx,
  actor: Actor,
  query: unknown = {},
): Promise<{ items: IncompleteSummary[]; nextCursor: string | null }> {
  readAccess(actor);
  const q = parseInput(incompleteListQuery, query);
  const { settings } = await orderSettings(tx);
  const limit = q.limit ?? 50;
  const where: SQL[] = [TAB_WHERE[q.tab]];
  if (q.tab === 'open') {
    where.push(
      sql`i.updated_at <= now() - make_interval(mins => ${settings.recovery.showAfterMinutes})`,
    );
  }
  if (q.after) {
    const [at, id] = atob(q.after).split('|');
    if (at && id) where.push(sql`(i.updated_at, i.id) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select i.* from store.incomplete_orders i where ${sql.join(where, sql` and `)}
     order by i.updated_at desc, i.id desc limit ${limit + 1}`);
  const page = rows.slice(0, limit);
  const risks = await phoneRisks(
    tx,
    page.map((r) => r.phone as string),
    settings,
  );
  const items = page.map((r) => summary(r, risks));
  const last = rows.length > limit ? items[items.length - 1] : undefined;
  return { items, nextCursor: last ? btoa(`${last.updatedAt}|${last.id}`) : null };
}

/** How many open records staff can see now, and today's recovered ones, for the dashboard. */
export async function incompleteCounts(
  tx: TenantTx,
  settings: { recovery: { incomplete: boolean; showAfterMinutes: number } },
): Promise<{ open: number; today: number; recoveredToday: number } | null> {
  if (!settings.recovery.incomplete) return null;
  const { rows } = await tx.db.execute<{ open: number; today: number; recovered: number }>(sql`
    select count(*) filter (where status in ('open', 'contacted')
             and updated_at <= now() - make_interval(mins => ${settings.recovery.showAfterMinutes}))::int as open,
           count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Dhaka')
                                                at time zone 'Asia/Dhaka')::int as today,
           count(*) filter (where status in ('recovered', 'converted')
             and created_at >= date_trunc('day', now() at time zone 'Asia/Dhaka')
                              at time zone 'Asia/Dhaka')::int as recovered
      from store.incomplete_orders`);
  const r = rows[0];
  return { open: r?.open ?? 0, today: r?.today ?? 0, recoveredToday: r?.recovered ?? 0 };
}

export interface IncompleteDetail extends IncompleteSummary {
  email: string | null;
  address: { divisionId?: number; districtId?: number; areaId?: number; line?: string };
  /** Each line with today's price and what can be ordered now. */
  lines: (IncompleteLine & {
    priceNow: number | null;
    available: number | null;
    orderable: boolean;
  })[];
  cartCode: string | null;
  locale: 'bn' | 'en';
}

export async function getIncompleteOrder(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<IncompleteDetail> {
  readAccess(actor);
  const { settings } = await orderSettings(tx);
  const { rows } = await tx.db.execute<Record<string, unknown>>(sql`
    select i.*, c.code as cart_code from store.incomplete_orders i
      left join store.carts c on c.id = i.cart_id where i.id = ${id}`);
  const r = rows[0];
  if (!r) throw new AppError('not_found');
  const lines = r.lines as IncompleteLine[];
  const { rows: now } = await tx.db.execute<{
    id: string;
    price: string;
    live: boolean;
    free: boolean;
    available: number;
  }>(sql`
    select v.id, ${effectivePriceSql('v')} as price, p.status = 'active' and v.archived_at is null as live,
           not v.track_inventory or v.allow_backorder as free,
           coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l
                      where l.variant_id = v.id), 0)::int as available
      from store.variants v join store.products p on p.id = v.product_id
     where v.id = any(${sql.param(lines.map((l) => l.variantId))}::uuid[])`);
  const byId = new Map(now.map((n) => [n.id, n]));
  const risks = await phoneRisks(tx, [r.phone as string], settings);
  return {
    ...summary(r, risks),
    email: (r.email as string) ?? null,
    address: (r.address ?? {}) as IncompleteDetail['address'],
    lines: lines.map((l) => {
      const n = byId.get(l.variantId);
      return {
        ...l,
        priceNow: n ? Number(n.price) : null,
        available: n && !n.free ? n.available : null,
        orderable: Boolean(n?.live && (n.free || n.available >= l.quantity)),
      };
    }),
    cartCode: (r.cart_code as string) ?? null,
    locale: r.locale as 'bn' | 'en',
  };
}

async function setStatus(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
  to: 'contacted' | 'dismissed',
): Promise<IncompleteDetail> {
  readAccess(actor);
  authorize(actor, 'orders.write');
  const { note } = parseInput(incompleteNoteInput, input);
  const { rows } = await tx.db.execute(sql`
    update store.incomplete_orders
       set status = ${to}, note = coalesce(${note ?? null}, note),
           contacted_by = case when ${to} = 'contacted' then ${actor.userId}::uuid else contacted_by end,
           contacted_at = case when ${to} = 'contacted' then now() else contacted_at end
     where id = ${id} and status in ('open', 'contacted') returning id`);
  if (!rows.length) {
    const { rows: exists } = await tx.db.execute(
      sql`select 1 from store.incomplete_orders where id = ${id}`,
    );
    if (!exists.length) throw new AppError('not_found');
    throw new AppError('illegal_transition', { detail: 'This incomplete order is closed' });
  }
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: `incomplete_order.${to}`,
    entityType: 'incomplete_order',
    entityId: id,
  });
  return getIncompleteOrder(tx, actor, id);
}

export const markIncompleteContacted = (tx: TenantTx, actor: Actor, id: string, input: unknown) =>
  setStatus(tx, actor, id, input, 'contacted');
export const dismissIncompleteOrder = (tx: TenantTx, actor: Actor, id: string, input: unknown) =>
  setStatus(tx, actor, id, input, 'dismissed');

/** What the manual order screen starts from: the customer, the lines still orderable, the area. */
export interface IncompletePrefill {
  incompleteOrderId: string;
  contact: { name: string; phone: string; email: string | null };
  address: { divisionId: number; districtId: number; areaId: number; line: string } | null;
  lines: { variantId: string; quantity: number }[];
  code: string | null;
  locale: 'bn' | 'en';
}

export async function incompletePrefill(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<IncompletePrefill> {
  authorize(actor, 'orders.write');
  const d = await getIncompleteOrder(tx, actor, id);
  if (d.status !== 'open' && d.status !== 'contacted') {
    throw new AppError('illegal_transition', { detail: 'This incomplete order is closed' });
  }
  const a = d.address;
  return {
    incompleteOrderId: d.id,
    contact: { name: d.name ?? '', phone: formatPhone(d.phone), email: d.email },
    address:
      a.divisionId && a.districtId && a.areaId && a.line
        ? { divisionId: a.divisionId, districtId: a.districtId, areaId: a.areaId, line: a.line }
        : null,
    lines: d.lines
      .filter((l) => l.orderable)
      .map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    code: d.cartCode,
    locale: d.locale,
  };
}
