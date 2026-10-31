// The Meta product feed (phase-9-plan §3.1.4): marked stale by catalog and
// stock changes, rebuilt by the delayed-work queue one chunk of variants at a
// time, and served by the storefront from R2. This module reads the
// database; the API writes the files.

import { schema } from '@managemind/db';
import {
  FEED_CHUNK,
  type FeedSkipReason,
  type MetaFeedItem,
  optionField,
} from '@managemind/shared/channels';
import type { Locale } from '@managemind/shared/money';
import { type RichTextDoc, richTextToPlainText } from '@managemind/shared/rich-text';
import { tenantSettings } from '@managemind/shared/settings';
import { storePath } from '@managemind/shared/storefront/urls';
import { eq, sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import type { StoreImage } from '../catalog/published';
import type { EventType } from '../events';
import { canOrder, type Localized, loadVariants } from '../orders/variants';
import type { TenantTx } from '../tenant';

/** Events that can change what the feed says (§3.1.4). */
export const FEED_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'catalog.product.created',
  'catalog.product.updated',
  'catalog.product.archived',
  'catalog.product.deleted',
  'catalog.attribute.changed',
  'inventory.availability.changed',
  'tenant.updated',
]);

/** A build follows the first change by this long, so a busy hour builds once. */
export const FEED_DELAY_SECONDS = 900;

/**
 * Marks the feed stale when it is on. True when it was current until now, so
 * the caller queues one build; later changes ride along with that build.
 */
export async function markFeedDirty(tx: TenantTx): Promise<boolean> {
  const { rows } = await tx.db.execute<{ newly: boolean }>(sql`
    with t as (
      select coalesce((settings -> 'meta' -> 'feed' ->> 'enabled')::boolean, false) as enabled
        from platform.tenants where id = ${tx.tenantId}
    ), old as (
      select dirty_since from store.feeds where kind = 'meta'
    ), up as (
      insert into store.feeds (kind, dirty_since)
      select 'meta', now() from t where t.enabled
      on conflict (tenant_id, kind) do update set dirty_since = coalesce(store.feeds.dirty_since, now())
      returning 1
    )
    select exists (select 1 from up) and (select dirty_since from old) is null as newly`);
  return rows[0]?.newly ?? false;
}

export interface FeedStart {
  enabled: boolean;
  key: string | null;
  defaultLocale: Locale;
  locales: Locale[];
  /** When the build began: changes after it leave the feed stale for the next build. */
  startedAt: string;
}

/** What a build needs to know before its first chunk. */
export async function startFeedBuild(tx: TenantTx): Promise<FeedStart> {
  const t = schema.tenants;
  const [row] = await tx.db
    .select({ settings: t.settings, defaultLocale: t.defaultLocale, now: sql<string>`now()` })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  const settings = tenantSettings.parse(row?.settings ?? {});
  const defaultLocale = (row?.defaultLocale ?? 'bn') as Locale;
  return {
    enabled: settings.meta.feed.enabled,
    key: settings.meta.feed.key ?? null,
    defaultLocale,
    locales: [defaultLocale, defaultLocale === 'bn' ? 'en' : 'bn'],
    startedAt: new Date(row?.now ?? Date.now()).toISOString(),
  };
}

export interface FeedChunk {
  items: MetaFeedItem[];
  skipped: Partial<Record<FeedSkipReason, number>>;
  /** The last variant read, for the next chunk; null when this was the last chunk. */
  after: string | null;
}

/** Builds a store link from a path and its query (StoreUrls.link in the API). */
export type FeedLink = (path: string, params?: Record<string, string>) => string;

const pick = (t: Localized | null | undefined, locale: Locale) =>
  t?.[locale] ?? t?.[locale === 'bn' ? 'en' : 'bn'] ?? '';

/** The largest file at least 600 pixels wide, or the largest there is: Meta asks for 500. */
const imageFile = (image: StoreImage | null) =>
  image?.files.find((f) => f.width >= 600)?.file ?? image?.files.at(-1)?.file ?? null;

/**
 * One chunk of the feed in one language: published variants of active
 * products, in ID order after `after`. Variants without a picture or a price
 * are left out and counted.
 */
export async function feedChunk(
  tx: TenantTx,
  options: { locale: Locale; defaultLocale: Locale; after: string | null; link: FeedLink },
): Promise<FeedChunk> {
  const { locale, defaultLocale, link } = options;
  const { rows: page } = await tx.db.execute<{ id: string }>(sql`
    select v.id from store.variants v join store.products p on p.id = v.product_id
     where p.status = 'active' and v.archived_at is null
       and (${options.after}::uuid is null or v.id > ${options.after}::uuid)
     order by v.id limit ${FEED_CHUNK}`);
  const ids = page.map((r) => r.id);
  const variants = await loadVariants(tx, ids);
  const productIds = [...new Set([...variants.values()].map((v) => v.productId))];
  const { rows: products } = productIds.length
    ? await tx.db.execute<{
        id: string;
        description: { bn?: RichTextDoc; en?: RichTextDoc } | null;
        brand: Localized | null;
        options: Localized[];
        images: StoreImage[];
      }>(sql`
        select p.id,
               (select json_object_agg(t.locale, t.description) from store.product_translations t
                 where t.product_id = p.id and t.description is not null) as description,
               (select json_object_agg(vt.locale, vt.label)
                  from store.product_attributes pa
                  join store.attributes a on a.id = pa.attribute_id and a.key = 'brand'
                  join store.attribute_value_translations vt on vt.value_id = pa.value_id
                 where pa.product_id = p.id) as brand,
               coalesce((select json_agg((select json_object_agg(ot.locale, ot.name)
                                            from store.product_option_translations ot
                                           where ot.option_id = o.id) order by o.position)
                           from store.product_options o where o.product_id = p.id), '[]'::json) as options,
               coalesce((select json_agg(json_build_object('width', m.width, 'height', m.height,
                                                           'files', m.files, 'alt', null)
                                         order by pm.position)
                           from store.product_media pm join store.media m on m.id = pm.media_id
                          where pm.product_id = p.id), '[]'::json) as images
          from store.products p where p.id = any(${sql.param(productIds)}::uuid[])`)
    : { rows: [] };
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const { rows: store } = await tx.db.execute<{ name: string }>(
    sql`select name from platform.tenants where id = ${tx.tenantId}`,
  );
  const storeName = store[0]?.name ?? '';

  const items: MetaFeedItem[] = [];
  const skipped: Partial<Record<FeedSkipReason, number>> = {};
  const skip = (reason: FeedSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  for (const id of ids) {
    const v = variants.get(id);
    if (!v) continue;
    const product = byProduct.get(v.productId);
    const image = imageFile(v.image);
    if (!image) {
      skip('no_image');
      continue;
    }
    if (v.price <= 0) {
      skip('no_price');
      continue;
    }
    // A sale is the scheduled sale price inside its window, never the
    // compare-at price staff may show beside a regular price.
    const onSale = v.onSale && v.compareAtPrice !== null;
    const fields: Record<'color' | 'size' | 'material', string | null> = {
      color: null,
      size: null,
      material: null,
    };
    (product?.options ?? []).forEach((name, i) => {
      const field = optionField(pick(name, 'en')) ?? optionField(pick(name, 'bn'));
      const value = pick(v.optionLabels[i], locale);
      if (field && value) fields[field] = value;
    });
    const options = v.optionLabels.map((o) => pick(o, locale)).filter(Boolean);
    const description = product?.description?.[locale] ?? product?.description?.[defaultLocale];
    const slug = pick(v.slugs, locale);
    const path = storePath({ kind: 'product', slug }, locale, defaultLocale);
    const extra = (product?.images ?? [])
      .map((m) => imageFile(m))
      .filter((f): f is string => Boolean(f) && f !== image)
      .map((f) => link(`/media/${f}`));
    items.push({
      id: v.id,
      itemGroupId: v.productId,
      title: [pick(v.title, locale), ...options].join(' - '),
      description: description ? richTextToPlainText(description) : '',
      availability: v.live && canOrder(v, 1) ? 'in stock' : 'out of stock',
      price: onSale ? (v.compareAtPrice as number) : v.price,
      salePrice: onSale ? v.price : null,
      link: link(path, { v: v.id }),
      imageLink: link(`/media/${image}`),
      additionalImageLinks: extra,
      brand: pick(product?.brand, locale) || storeName,
      ...fields,
      quantity: v.trackInventory && !v.allowBackorder ? v.available : null,
    });
  }
  return { items, skipped, after: ids.length === FEED_CHUNK ? (ids.at(-1) ?? null) : null };
}

/**
 * Records a finished build. The feed stays stale when something changed
 * after the build began; true then, for the caller to queue the next build.
 */
export async function finishFeedBuild(
  tx: TenantTx,
  result: {
    startedAt: string;
    chunks: Partial<Record<Locale, number>>;
    rows: number;
    skipped: Partial<Record<FeedSkipReason, number>>;
    etag: string;
  },
): Promise<boolean> {
  const { rows } = await tx.db.execute<{ dirty: boolean }>(sql`
    insert into store.feeds (kind, built_at, chunks, rows, skipped, etag)
    values ('meta', now(), ${JSON.stringify(result.chunks)}::jsonb, ${result.rows},
            ${JSON.stringify(result.skipped)}::jsonb, ${result.etag})
    on conflict (tenant_id, kind) do update
       set built_at = now(), chunks = excluded.chunks, rows = excluded.rows,
           skipped = excluded.skipped, etag = excluded.etag, last_error = null,
           dirty_since = case when store.feeds.dirty_since <= ${result.startedAt}::timestamptz
                              then null else store.feeds.dirty_since end
    returning dirty_since is not null as dirty`);
  return rows[0]?.dirty ?? false;
}

/** Records why a build failed, for the settings page. */
export async function failFeedBuild(tx: TenantTx, error: string): Promise<void> {
  await tx.db.execute(sql`
    update store.feeds set last_error = ${error.slice(0, 300)} where kind = 'meta'`);
}

export interface FeedState {
  builtAt: string | null;
  dirtySince: string | null;
  rows: number;
  skipped: Partial<Record<FeedSkipReason, number>>;
  lastError: string | null;
}

/** The feed's last build, for the settings page. */
export async function feedState(tx: TenantTx): Promise<FeedState> {
  const { rows } = await tx.db.execute<{
    built_at: string | null;
    dirty_since: string | null;
    rows: number;
    skipped: FeedState['skipped'];
    last_error: string | null;
  }>(
    sql`select built_at, dirty_since, rows, skipped, last_error from store.feeds where kind = 'meta'`,
  );
  const r = rows[0];
  const iso = (d: string | null) => (d ? new Date(d).toISOString() : null);
  return {
    builtAt: iso(r?.built_at ?? null),
    dirtySince: iso(r?.dirty_since ?? null),
    rows: r?.rows ?? 0,
    skipped: r?.skipped ?? {},
    lastError: r?.last_error ?? null,
  };
}

export interface MetaChannel {
  feed: FeedState & { enabled: boolean; key: string | null };
  purchaseAt: 'placed' | 'confirmed';
  deliveredEvent: boolean;
}

/** The store's Meta settings and its feed's last build, for the settings page (§3.1). */
export async function metaChannel(tx: TenantTx, actor: Actor): Promise<MetaChannel> {
  authorize(actor, 'settings.read');
  const [row] = await tx.db
    .select({ settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  const { meta } = tenantSettings.parse(row?.settings ?? {});
  return {
    feed: { ...(await feedState(tx)), enabled: meta.feed.enabled, key: meta.feed.key ?? null },
    purchaseAt: meta.purchaseAt,
    deliveredEvent: meta.deliveredEvent,
  };
}

/** Asks for a build now: Rebuild in settings (settings.write). */
export function requestFeedBuild(actor: Actor): void {
  authorize(actor, 'settings.write');
}
