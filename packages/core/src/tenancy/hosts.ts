// Which store a hostname belongs to (ADR 0015). A store's default address
// `{slug}.<STORE_DOMAIN>` is derived from its slug; custom domains (Phase 3)
// are rows in platform.tenant_domains. The storefront reads the KV map that
// hostEntries() feeds, and falls back to resolveHost() on a miss.
import { type Db, schema } from '@managemind/db';
import { hostKey, type KvKey, SLUG_PATTERN } from '@managemind/shared';
import { and, eq, inArray } from 'drizzle-orm';

/** What the storefront needs to serve a host; also the KV value. */
export interface HostRecord {
  tenantId: string;
  slug: string;
  name: string;
  defaultLocale: 'bn' | 'en';
  status: 'active' | 'suspended';
  /** The canonical host: the primary custom domain, or the default address. */
  primaryHost: string;
}

/** "Shop.Example.com:443." -> "shop.example.com". */
export const normalizeHost = (host: string): string =>
  host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

/** The slug in a default address, or null if the host isn't one. */
export function slugFromHost(host: string, storeDomain: string): string | null {
  const name = normalizeHost(host);
  const suffix = `.${storeDomain}`;
  if (!name.endsWith(suffix)) return null;
  const slug = name.slice(0, -suffix.length);
  return SLUG_PATTERN.test(slug) ? slug : null;
}

const t = schema.tenants;
const d = schema.tenantDomains;
const columns = {
  tenantId: t.id,
  slug: t.slug,
  name: t.name,
  defaultLocale: t.defaultLocale,
  status: t.status,
};

async function primaryHost(db: Db, tenantId: string, slug: string, storeDomain: string) {
  const [primary] = await db
    .select({ hostname: d.hostname })
    .from(d)
    .where(and(eq(d.tenantId, tenantId), eq(d.isPrimary, true), eq(d.status, 'active')));
  return primary?.hostname ?? `${slug}.${storeDomain}`;
}

type Row = {
  tenantId: string;
  slug: string;
  name: string;
  defaultLocale: 'bn' | 'en';
  status: string;
};

async function toRecord(db: Db, row: Row | undefined, storeDomain: string) {
  // Closed and purged stores have no address at all.
  if (!row || (row.status !== 'active' && row.status !== 'suspended')) return null;
  return {
    ...row,
    status: row.status,
    primaryHost: await primaryHost(db, row.tenantId, row.slug, storeDomain),
  } as HostRecord;
}

/** Active custom domain first, then the default address. Never writes KV. */
export async function resolveHost(
  db: Db,
  host: string,
  storeDomain: string,
): Promise<HostRecord | null> {
  const name = normalizeHost(host);
  const [custom] = await db
    .select(columns)
    .from(d)
    .innerJoin(t, eq(t.id, d.tenantId))
    .where(and(eq(d.hostname, name), eq(d.status, 'active')));
  if (custom) return toRecord(db, custom, storeDomain);
  const slug = slugFromHost(name, storeDomain);
  if (!slug) return null;
  const [row] = await db.select(columns).from(t).where(eq(t.slug, slug));
  return toRecord(db, row, storeDomain);
}

export interface HostEntries {
  put: { key: KvKey; value: HostRecord }[];
  delete: KvKey[];
}

/**
 * The KV entries a store should have now: one per address while it is
 * active or suspended, none otherwise. Recomputed from the rows on every
 * event, so applying it twice changes nothing.
 */
export async function hostEntries(
  db: Db,
  tenantId: string,
  storeDomain: string,
): Promise<HostEntries> {
  const [row] = await db.select(columns).from(t).where(eq(t.id, tenantId));
  const domains = await db
    .select({ hostname: d.hostname, status: d.status })
    .from(d)
    .where(and(eq(d.tenantId, tenantId), inArray(d.status, ['active', 'failed', 'removed'])));
  const record = await toRecord(db, row, storeDomain);
  const live = record ? [`${record.slug}.${storeDomain}`] : [];
  if (record) live.push(...domains.filter((x) => x.status === 'active').map((x) => x.hostname));
  const dead = domains.map((x) => x.hostname).filter((h) => !live.includes(h));
  if (!record && row) dead.push(`${row.slug}.${storeDomain}`);
  return {
    put: record ? live.map((h) => ({ key: hostKey(h), value: record })) : [],
    delete: dead.map(hostKey),
  };
}
