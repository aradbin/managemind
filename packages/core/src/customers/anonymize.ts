// A shopper's deletion request (phase-5b-plan §3.13): an owner or manager
// (customers.delete) anonymizes the customer after the shopper asked the
// store. Their name, phone, email and street go from the customer and from
// their orders' snapshots; their addresses, shopper account, sign-in
// records, delivery log and return photos go; store credit locked to their
// phone ends. Order totals, lines, payments, refunds and the stock ledger
// stay for the store's sales and tax records, with the district and zone.
// The blocklist keeps a blocked number (fraud prevention, Q14).
import { schema } from '@managemind/db';
import { ANONYMIZED_PHONE } from '@managemind/db/schema';
import { AppError } from '@managemind/shared';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

export const ANONYMIZED_NAME = 'Deleted customer';

/** One Postgres array literal, as one parameter (Drizzle would spread a JS array). */
const pgArray = (values: readonly (string | null)[]) =>
  `{${values
    .filter((v): v is string => v !== null)
    .map((v) => `"${v.replace(/["\\]/g, '\\$&')}"`)
    .join(',')}}`;

export interface Anonymized {
  orders: number;
  /** Return photos to delete from R2 once the transaction has committed. */
  photoKeys: string[];
}

export async function anonymizeCustomer(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<Anonymized> {
  authorize(actor, 'customers.delete');
  const c = schema.customers;
  const [customer] = await tx.db
    .select({ phone: c.phone, email: c.email })
    .from(c)
    .where(eq(c.id, id))
    .for('update');
  if (!customer) throw new AppError('not_found');
  const t = tx.tenantId;
  const run = (query: ReturnType<typeof sql>) => tx.db.execute(query);

  const { rows: orders } = await tx.db.execute<{ id: string; shopper_user_id: string | null }>(
    sql`select id, shopper_user_id from store.orders where tenant_id = ${t} and customer_id = ${id}`,
  );
  const orderIds = orders.map((o) => o.id);
  // Their shopper accounts: the ones that placed their orders, and any signed in with their number or email.
  const { rows: shoppers } = await tx.db.execute<{
    id: string;
    email: string;
    phone: string | null;
  }>(
    sql`select id, email, coalesce(phone_number, phone) as phone from store.shopper_users
         where tenant_id = ${t}
           and (id = any(${pgArray(orders.map((o) => o.shopper_user_id))}::uuid[])
                or phone_number = ${customer.phone} or phone = ${customer.phone}
                or (${customer.email}::text is not null and email = lower(${customer.email})))`,
  );
  const identifiers = [
    customer.phone,
    ...(customer.email ? [customer.email.toLowerCase()] : []),
    ...shoppers.flatMap((s) => [s.email, ...(s.phone ? [s.phone] : [])]),
  ];

  // The orders keep their totals, district and zone; who and where goes.
  await run(sql`
    update store.orders
       set phone = ${ANONYMIZED_PHONE},
           contact = jsonb_build_object('name', ${ANONYMIZED_NAME}::text, 'phone', ${ANONYMIZED_PHONE}::text),
           address = case when address is null then null else address || '{"line": "—"}'::jsonb end,
           ip = null, user_agent = null, attribution = null
     where tenant_id = ${t} and customer_id = ${id}`);
  await run(
    sql`delete from store.customer_addresses where tenant_id = ${t} and customer_id = ${id}`,
  );
  // What the store knew of their WhatsApp (phase-9-plan §3.2.4).
  await run(sql`delete from store.whatsapp_contacts where tenant_id = ${t} and phone = ${customer.phone}`);
  await run(sql`
    delete from store.messages
     where tenant_id = ${t}
       and (order_id = any(${pgArray(orderIds)}::uuid[])
            or (recipient_type = 'shopper' and recipient = any(${pgArray(identifiers)}::text[])))`);
  // Return photos and what the shopper wrote on their returns.
  const { rows: photos } = await tx.db.execute<{ object_key: string }>(sql`
    delete from store.return_photos p using store.returns r
     where p.tenant_id = ${t} and r.tenant_id = ${t} and p.return_id = r.id
       and r.order_id = any(${pgArray(orderIds)}::uuid[])
    returning p.object_key`);
  await run(sql`
    update store.returns set note = null where tenant_id = ${t} and order_id = any(${pgArray(orderIds)}::uuid[])`);
  // The shopper account, its sessions, sign-in methods and addresses (cascade), its carts and codes.
  const shopperIds = shoppers.map((s) => s.id);
  if (shopperIds.length) {
    await run(sql`
      delete from store.carts where tenant_id = ${t} and shopper_user_id = any(${pgArray(shopperIds)}::uuid[])`);
    await run(sql`
      delete from store.shopper_users where tenant_id = ${t} and id = any(${pgArray(shopperIds)}::uuid[])`);
  }
  await run(sql`
    delete from store.shopper_verifications
     where tenant_id = ${t}
       and exists (select 1 from unnest(${pgArray(identifiers)}::text[]) i where identifier like '%' || i)`);
  // Store credit locked to their phone ends; other offers just forget the number.
  await run(sql`
    update store.promotions
       set conditions = jsonb_set(conditions, '{customerPhones}',
             coalesce((select jsonb_agg(p) from jsonb_array_elements_text(conditions->'customerPhones') p
                        where p <> ${customer.phone}), '[]'::jsonb)),
           status = case when store_credit then 'ended' else status end
     where tenant_id = ${t} and conditions->'customerPhones' ? ${customer.phone}`);
  await run(sql`
    delete from store.promotion_customer_usage where tenant_id = ${t} and phone = ${customer.phone}`);
  // Checkouts they left (phase-6-plan §3.2).
  await run(sql`
    delete from store.incomplete_orders where tenant_id = ${t} and phone = ${customer.phone}`);

  await tx.db
    .update(c)
    .set({
      name: ANONYMIZED_NAME,
      phone: ANONYMIZED_PHONE,
      email: null,
      note: null,
      tags: [],
      deletedAt: sql`coalesce(${c.deletedAt}, now())`,
    })
    .where(eq(c.id, id));
  // No old values in the audit: that is the point.
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'customer.anonymized',
    entityType: 'customer',
    entityId: id,
    after: { orders: orderIds.length },
  });
  await emit(tx, 'customer.anonymized', {
    aggregateType: 'customer',
    aggregateId: id,
    payload: {},
  });
  return { orders: orderIds.length, photoKeys: photos.map((p) => p.object_key) };
}
