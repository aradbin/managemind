// The platform dashboard (phase-5b-plan §3.3): a few queries on platform
// tables, whatever the number of stores. Demo and test stores are left out
// of sales and money; they still count as stores.
import { addDays } from '@managemind/shared/billing';
import { sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import type { PlatformTx } from '../platform';

export interface PlatformDashboard {
  stores: { active: number; suspended: number; closed: number; inSetup: number };
  sales: {
    yesterday: { orders: number; total: number };
    month: { orders: number; total: number };
    days: { day: string; orders: number; total: number }[];
  };
  perStore: {
    tenantId: string;
    slug: string;
    name: string;
    products: number;
    ordersThisMonth: number;
    emailsThisMonth: number;
    storageBytes: number;
    customDomains: number;
  }[];
  money: {
    overdue: { count: number; total: number };
    dueThisWeek: { count: number; total: number };
    paidThisMonth: number;
  };
}

const n = (v: unknown) => Number(v ?? 0);

export async function platformDashboard(
  tx: PlatformTx,
  actor: Actor,
  today: string,
): Promise<PlatformDashboard> {
  requirePlatformRole(actor, 'support');
  const monthStart = `${today.slice(0, 8)}01`;
  const yesterday = addDays(today, -1);
  const from = addDays(today, -30);

  const { rows: stores } = await tx.db.execute<Record<string, unknown>>(sql`
    select
      count(*) filter (where t.status = 'active') as active,
      count(*) filter (where t.status = 'suspended') as suspended,
      count(*) filter (where t.status = 'closed') as closed,
      count(*) filter (where t.status in ('active', 'suspended')
        and coalesce((h.checklist->>'complete')::boolean, false) = false) as in_setup
    from platform.tenants t left join platform.store_health h on h.tenant_id = t.id`);
  const { rows: days } = await tx.db.execute<{ day: string; orders: unknown; total: unknown }>(sql`
    select u.day::text as day,
           coalesce(sum(u.value) filter (where u.metric = 'orders'), 0) as orders,
           coalesce(sum(u.value) filter (where u.metric = 'order_total'), 0) as total
      from platform.usage_daily u join platform.tenants t on t.id = u.tenant_id
     where t.kind = 'client' and u.day >= ${from}::date and u.metric in ('orders', 'order_total')
     group by u.day order by u.day`);
  const { rows: perStore } = await tx.db.execute<Record<string, unknown>>(sql`
    with latest as (
      select distinct on (u.tenant_id, u.metric) u.tenant_id, u.metric, u.value
        from platform.usage_daily u
       where u.metric in ('products', 'storage_bytes', 'custom_domains') and u.day >= ${from}::date
       order by u.tenant_id, u.metric, u.day desc
    ), month as (
      select u.tenant_id, sum(u.value) filter (where u.metric = 'orders') as orders,
             sum(u.value) filter (where u.metric = 'emails') as emails
        from platform.usage_daily u where u.day >= ${monthStart}::date group by u.tenant_id
    )
    select t.id as tenant_id, t.slug, t.name,
           coalesce((select value from latest l where l.tenant_id = t.id and l.metric = 'products'), 0) as products,
           coalesce(m.orders, 0) as orders, coalesce(m.emails, 0) as emails,
           coalesce((select value from latest l where l.tenant_id = t.id and l.metric = 'storage_bytes'), 0) as storage,
           coalesce((select value from latest l where l.tenant_id = t.id and l.metric = 'custom_domains'), 0) as domains
      from platform.tenants t left join month m on m.tenant_id = t.id
     where t.status in ('active', 'suspended')
     order by coalesce(m.orders, 0) desc, t.slug limit 100`);
  const weekEnd = addDays(today, 7);
  const { rows: money } = await tx.db.execute<Record<string, unknown>>(sql`
    select
      count(*) filter (where i.status = 'issued' and i.due_on < ${today}::date) as overdue_count,
      coalesce(sum(i.total - i.amount_paid) filter (where i.status = 'issued' and i.due_on < ${today}::date), 0) as overdue_total,
      count(*) filter (where i.status = 'issued' and i.due_on between ${today}::date and ${weekEnd}::date) as due_count,
      coalesce(sum(i.total - i.amount_paid) filter (where i.status = 'issued' and i.due_on between ${today}::date and ${weekEnd}::date), 0) as due_total,
      (select coalesce(sum(p.amount), 0) from platform.billing_payments p where p.paid_on >= ${monthStart}::date) as paid
    from platform.invoices i`);
  const s = stores[0] ?? {};
  const series = days.map((d) => ({ day: d.day, orders: n(d.orders), total: n(d.total) }));
  const sum = (list: typeof series) =>
    list.reduce((a, d) => ({ orders: a.orders + d.orders, total: a.total + d.total }), {
      orders: 0,
      total: 0,
    });
  const m = money[0] ?? {};
  return {
    stores: {
      active: n(s.active),
      suspended: n(s.suspended),
      closed: n(s.closed),
      inSetup: n(s.in_setup),
    },
    sales: {
      yesterday: sum(series.filter((d) => d.day === yesterday)),
      month: sum(series.filter((d) => d.day >= monthStart)),
      days: series,
    },
    perStore: perStore.map((r) => ({
      tenantId: String(r.tenant_id),
      slug: String(r.slug),
      name: String(r.name),
      products: n(r.products),
      ordersThisMonth: n(r.orders),
      emailsThisMonth: n(r.emails),
      storageBytes: n(r.storage),
      customDomains: n(r.domains),
    })),
    money: {
      overdue: { count: n(m.overdue_count), total: n(m.overdue_total) },
      dueThisWeek: { count: n(m.due_count), total: n(m.due_total) },
      paidThisMonth: n(m.paid),
    },
  };
}
