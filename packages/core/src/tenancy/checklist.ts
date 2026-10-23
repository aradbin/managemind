// The setup checklist (phase-5b-plan §3.2): what a store still needs before
// its first order. Every item is computed from the store's own data, so it is
// never out of date. The owner's dashboard reads it live; the platform reads
// the copy the daily job writes into platform.store_health (§3.3).
import { schema } from '@managemind/db';
import { tenantSettings } from '@managemind/shared/settings';
import { eq, sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';

export const CHECKLIST_ITEMS = [
  'profile',
  'logo',
  'products',
  'delivery',
  'payments',
  'legal',
  'email',
  'sms',
  'domain',
  'terms',
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

/** A store can open with these missing. */
export const OPTIONAL_ITEMS: readonly ChecklistItem[] = ['sms', 'domain'];

export interface Checklist {
  items: { item: ChecklistItem; done: boolean; optional: boolean }[];
  /** Required items done, of all required items. */
  done: number;
  total: number;
  complete: boolean;
}

const LEGAL = ['terms', 'privacy', 'returns', 'delivery'];

/** The store's checklist, in the caller's tenant transaction. */
export async function setupChecklist(tx: TenantTx): Promise<Checklist> {
  const t = schema.tenants;
  const [tenant] = await tx.db
    .select({ settings: t.settings })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  const settings = tenantSettings.parse(tenant?.settings ?? {});
  const p = settings.profile;

  const { rows } = await tx.db.execute<{
    in_stock: boolean;
    zones_priced: boolean;
    zones_edited: boolean;
    sslcommerz_ok: boolean;
    email_key: string | null;
    sms_ok: boolean;
    legal_published: number;
    domain_active: boolean;
    terms_ok: boolean;
  }>(sql`
    select
      exists (
        select 1 from store.products p
          join store.variants v on v.product_id = p.id and v.archived_at is null
          left join store.inventory_levels l on l.variant_id = v.id
         where p.status = 'active'
           and (not v.track_inventory or l.on_hand - l.reserved > 0)
      ) as in_stock,
      not exists (
        select 1 from store.delivery_zones z where z.active and z.fee <= 0
      ) and exists (select 1 from store.delivery_zones z where z.active) as zones_priced,
      exists (
        select 1 from store.delivery_zones z
         where z.updated_at > z.created_at
            or z.created_at > (select t.created_at from platform.tenants t where t.id = ${tx.tenantId})
      ) as zones_edited,
      exists (
        select 1 from store.provider_credentials c
         where c.kind = 'sslcommerz' and c.checked_at is not null and c.check_error is null
      ) as sslcommerz_ok,
      (select case when c.checked_at is not null and c.check_error is null then 'ok' else 'failing' end
         from store.provider_credentials c where c.kind = 'email') as email_key,
      exists (
        select 1 from store.provider_credentials c
         where c.kind = 'sms' and c.checked_at is not null and c.check_error is null
      ) as sms_ok,
      (select count(distinct kind)::int from store.pages
        where published and kind = any(${sql.param(LEGAL)}::text[])) as legal_published,
      exists (
        select 1 from platform.tenant_domains d
         where d.tenant_id = ${tx.tenantId} and d.status = 'active'
      ) as domain_active,
      coalesce((
        select exists (
          select 1 from platform.terms_acceptances a
            join platform.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id
           where a.tenant_id = ${tx.tenantId} and a.version_id = v.id and m.role = 'owner'
        )
          from platform.terms_versions v
         order by v.effective_at desc limit 1
      ), true) as terms_ok
  `);
  const r = rows[0];
  const theme = settings.theme ?? settings.themeDraft;
  const done: Record<ChecklistItem, boolean> = {
    profile: Boolean((p.businessName || p.address?.line1) && p.address?.line1 && p.contactPhone),
    logo: Boolean(theme?.tokens.logoMediaId),
    products: Boolean(r?.in_stock),
    delivery: Boolean(r?.zones_priced && r.zones_edited),
    payments: settings.cod.enabled || Boolean(r?.sslcommerz_ok),
    legal: (r?.legal_published ?? 0) >= LEGAL.length,
    // The platform's sender always works; the store's own key must pass its check.
    email: r?.email_key !== 'failing',
    sms: Boolean(r?.sms_ok),
    domain: Boolean(r?.domain_active) || settings.setup.subdomainFinal,
    terms: Boolean(r?.terms_ok),
  };
  const items = CHECKLIST_ITEMS.map((item) => ({
    item,
    done: done[item],
    optional: OPTIONAL_ITEMS.includes(item),
  }));
  const required = items.filter((i) => !i.optional);
  const count = required.filter((i) => i.done).length;
  return { items, done: count, total: required.length, complete: count === required.length };
}
