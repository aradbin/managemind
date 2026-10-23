// Store health (phase-5b-plan §3.3): what the platform screens show per
// store, written into platform.store_health so they never read the store
// schema. The daily job and a Refresh on one store write it.
import { schema } from '@managemind/db';
import { sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import { type Checklist, setupChecklist } from '../tenancy/checklist';
import { type DbClient, type TenantTx, withTenant } from '../tenant';

export interface StoreHealth {
  checkedAt: Date;
  checklist: Checklist | Record<string, never>;
  payments: Record<string, unknown>;
  email: Record<string, unknown>;
  sms: Record<string, unknown>;
  domains: Record<string, unknown>;
  activity: Record<string, unknown>;
}

/** What a store's payments, email, SMS, domains and activity look like now (§3.3). */
async function healthParts(tx: TenantTx) {
  const { rows } = await tx.db.execute<{
    sslcommerz: { mode: string; checkedAt: string | null; error: string | null } | null;
    pending_payments: number;
    email_key: { provider: string; checkedAt: string | null; error: string | null } | null;
    emails_sent: number;
    emails_failed: number;
    sms_gateway: { provider: string; checkedAt: string | null; error: string | null } | null;
    sms_failed: number;
    domains: { hostname: string; status: string; sslStatus: string | null }[];
    last_order_at: string | null;
    last_staff_sign_in_at: string | null;
  }>(sql`
    select
      (select jsonb_build_object('mode', c.mode, 'checkedAt', c.checked_at, 'error', c.check_error)
         from store.provider_credentials c where c.kind = 'sslcommerz') as sslcommerz,
      (select count(*)::int from store.payments p
        where p.status = 'pending' and p.method <> 'cod' and p.created_at < now() - interval '1 hour')
        as pending_payments,
      (select jsonb_build_object('provider', c.provider, 'checkedAt', c.checked_at, 'error', c.check_error)
         from store.provider_credentials c where c.kind = 'email') as email_key,
      (select count(*)::int from store.messages m where m.channel = 'email' and m.status = 'sent'
        and m.sent_at > now() - interval '24 hours') as emails_sent,
      (select count(*)::int from store.messages m where m.channel = 'email' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours') as emails_failed,
      (select jsonb_build_object('provider', c.provider, 'checkedAt', c.checked_at, 'error', c.check_error)
         from store.provider_credentials c where c.kind = 'sms') as sms_gateway,
      (select count(*)::int from store.messages m where m.channel = 'sms' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours') as sms_failed,
      coalesce((select jsonb_agg(jsonb_build_object('hostname', d.hostname, 'status', d.status,
          'sslStatus', d.ssl_status) order by d.hostname)
         from platform.tenant_domains d where d.tenant_id = ${tx.tenantId} and d.status <> 'removed'),
        '[]'::jsonb) as domains,
      (select max(o.placed_at) from store.orders o) as last_order_at,
      (select max(s.created_at) from platform.sessions s
         join platform.memberships m on m.user_id = s.user_id and m.tenant_id = ${tx.tenantId})
        as last_staff_sign_in_at
  `);
  const r = rows[0];
  return {
    payments: {
      cod: true,
      sslcommerz: r?.sslcommerz ?? null,
      pendingTooLong: r?.pending_payments ?? 0,
    },
    email: {
      sender: r?.email_key ? 'own' : 'platform',
      key: r?.email_key ?? null,
      sent24h: r?.emails_sent ?? 0,
      failed24h: r?.emails_failed ?? 0,
    },
    sms: { gateway: r?.sms_gateway ?? null, failed24h: r?.sms_failed ?? 0 },
    domains: { items: r?.domains ?? [] },
    activity: {
      lastOrderAt: r?.last_order_at ?? null,
      lastStaffSignInAt: r?.last_staff_sign_in_at ?? null,
    },
  };
}

/** Computes and writes the store's health row, in the caller's tenant transaction. */
export async function writeStoreHealth(tx: TenantTx): Promise<{ checklist: Checklist }> {
  const checklist = await setupChecklist(tx);
  const parts = await healthParts(tx);
  const h = schema.storeHealth;
  const values = { checklist, ...parts, checkedAt: sql`now()` };
  await tx.db
    .insert(h)
    .values({ tenantId: tx.tenantId, ...values })
    .onConflictDoUpdate({ target: h.tenantId, set: values });
  return { checklist };
}

/** Refresh on one store (support): the same checks as the daily job, for that store only. */
export async function refreshStoreHealth(
  client: DbClient,
  actor: Actor,
  tenantId: string,
): Promise<StoreHealth> {
  requirePlatformRole(actor, 'support');
  return withTenant(client, tenantId, async (tx) => {
    await writeStoreHealth(tx);
    return (await readStoreHealth(tx, tenantId)) as StoreHealth;
  });
}

/** The last health row of a store, or null before its first check. */
export async function readStoreHealth(
  tx: { db: TenantTx['db'] },
  tenantId: string,
): Promise<StoreHealth | null> {
  const h = schema.storeHealth;
  const [row] = await tx.db
    .select({
      checkedAt: h.checkedAt,
      checklist: h.checklist,
      payments: h.payments,
      email: h.email,
      sms: h.sms,
      domains: h.domains,
      activity: h.activity,
    })
    .from(h)
    .where(sql`${h.tenantId} = ${tenantId}`);
  return (row as StoreHealth | undefined) ?? null;
}
