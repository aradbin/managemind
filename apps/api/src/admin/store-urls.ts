// The store's own addresses, for the admin's "View store" link and the theme
// editor's live preview (phase-3-plan §3.4, §7). In production that is the
// primary host: the primary custom domain, or {slug}.<STORE_DOMAIN>. On
// previews and locally there are no store hosts, so STOREFRONT_ORIGIN and
// the dev store selector (?store=<slug>) stand in.
import type { TenantTx } from '@managemind/core';
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiConfig } from '../env';
import type { StaffEnv } from './context';

export interface StoreUrls {
  /** {slug}.<STORE_DOMAIN>, derived from the slug (ADR 0015). */
  defaultHost: string;
  primaryHost: string;
  /** The storefront's home page. */
  store: string;
  /** The theme preview with a token. */
  preview: (token: string) => string;
  /** A shopper page by path, such as `track` (phase-5a-plan §3.6's message links). */
  page: (path: string) => string;
  /** Any store path, absolute, with query parameters (phase-9-plan §3.1.4's feed links). */
  link: (path: string, params?: Record<string, string>) => string;
}

const withParams = (base: string, path: string, params: Record<string, string>) => {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
};

export const storeUrls = (c: Context<StaffEnv>, tx: TenantTx): Promise<StoreUrls> =>
  storeUrlsFor(c.var.config, tx);

/** The same without a request: for queue consumers and jobs. */
export async function storeUrlsFor(
  config: Pick<ApiConfig, 'STORE_DOMAIN' | 'STOREFRONT_ORIGIN'>,
  tx: TenantTx,
): Promise<StoreUrls> {
  const t = schema.tenants;
  const d = schema.tenantDomains;
  const [row] = await tx.db.select({ slug: t.slug }).from(t).where(eq(t.id, tx.tenantId));
  if (!row) throw new AppError('store_not_found');
  const [primary] = await tx.db
    .select({ hostname: d.hostname })
    .from(d)
    .where(and(eq(d.tenantId, tx.tenantId), eq(d.isPrimary, true), eq(d.status, 'active')));
  const defaultHost = `${row.slug}.${config.STORE_DOMAIN}`;
  const primaryHost = primary?.hostname ?? defaultHost;
  const origin = config.STOREFRONT_ORIGIN;
  const token = (value: string) => encodeURIComponent(value);
  if (origin) {
    return {
      defaultHost,
      primaryHost,
      store: `${origin}/?store=${row.slug}`,
      preview: (value) => `${origin}/__preview?store=${row.slug}&token=${token(value)}`,
      page: (path) => `${origin}/${path}?store=${row.slug}`,
      link: (path, params = {}) => withParams(origin, path, { ...params, store: row.slug }),
    };
  }
  return {
    defaultHost,
    primaryHost,
    store: `https://${primaryHost}/`,
    preview: (value) => `https://${primaryHost}/__preview?token=${token(value)}`,
    page: (path) => `https://${primaryHost}/${path}`,
    link: (path, params = {}) => withParams(`https://${primaryHost}`, path, params),
  };
}
