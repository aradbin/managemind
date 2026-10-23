// Spreadsheet imports (phase-2-plan §3.7). The browser parses the file, dry-
// runs it and stages chunks of whole products in R2; the queue consumer
// processes one chunk per message, one chunk per job at a time, each in one
// transaction. Every product is written inside a savepoint, so a product
// that fails (a SKU of another product, a taken slug, a bad value) becomes a
// row error and the rest of the chunk still lands. Stock goes through the
// inventory service's setOnHand with an idempotency key per row.
import { schema } from '@managemind/db';
import { AppError, toLatinDigits, uuidv7 } from '@managemind/shared';
import {
  BRAND_ATTRIBUTE_KEY,
  CATALOG_LIMITS,
  isCatalogSlug,
  normalizeKey,
  optionsKey,
  type ProductAttributeInput,
} from '@managemind/shared/catalog';
import {
  type ImportProduct,
  type ImportVariant,
  importProduct,
  parseBooleanCell,
} from '@managemind/shared/catalog/import';
import { type ImportCustomer, importCustomer } from '@managemind/shared/orders/customer-import';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize, systemActor } from '../access';
import { recordAudit } from '../audit';
import { storeEntitlements } from '../billing/entitlements';
import {
  ensureAttributeValue,
  replaceProductAttributes,
  replaceProductTags,
} from '../catalog/attributes';
import { writeNameTranslations } from '../catalog/collections';
import { type Locale, parseInput, pgError, storeCatalogContext } from '../catalog/common';
import { refreshPriceRange } from '../catalog/prices';
import { countProducts } from '../catalog/products';
import { chooseSlug, recordSlugChange } from '../catalog/slugs';
import { type OnHandTarget, setOnHand } from '../inventory/service';
import { emit } from '../outbox';
import { type DbClient, type TenantTx, type WithTenantOptions, withTenant } from '../tenant';

const j = schema.importJobs;
const MAX_STORED_ERRORS = 1_000;

/** One queue message: process this chunk of this job. */
export interface ImportMessage {
  tenantId: string;
  jobId: string;
  chunk: number;
}

export type ImportJob = {
  id: string;
  /** Products (Phase 2) or customers (phase-4-plan §3.10). */
  kind: 'products' | 'customers';
  status: 'staging' | 'running' | 'images' | 'done' | 'failed' | 'cancelled';
  fileName: string;
  chunkCount: number;
  nextChunk: number;
  total: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  errorCount: number;
  withStock: boolean;
  withCost: boolean;
  lastError: string | null;
  images: { pending: number; done: number; failed: number };
  createdAt: string;
  finishedAt: string | null;
};

const jobSql = (where: ReturnType<typeof sql>) => sql`
  select j.id, j.kind, j.status, j.file_name as "fileName", j.chunk_count as "chunkCount",
    j.next_chunk as "nextChunk", j.total, j.processed, j.created, j.updated, j.failed,
    j.error_count as "errorCount", j.with_stock as "withStock", j.with_cost as "withCost",
    j.last_error as "lastError", j.created_at as "createdAt", j.finished_at as "finishedAt",
    json_build_object(
      'pending', (select count(*)::int from store.import_images i where i.job_id = j.id and i.status = 'pending'),
      'done', (select count(*)::int from store.import_images i where i.job_id = j.id and i.status = 'done'),
      'failed', (select count(*)::int from store.import_images i where i.job_id = j.id and i.status = 'failed')
    ) as images
  from store.import_jobs j where ${where}
  order by j.created_at desc`;

const toJob = (row: ImportJob): ImportJob => ({
  ...row,
  createdAt: new Date(row.createdAt).toISOString(),
  finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
});

/** What reading and writing each kind of import needs. */
const KIND_PERMISSIONS = {
  products: { read: 'catalog.read', write: 'catalog.write' },
  customers: { read: 'customers.read', write: 'customers.write' },
} as const;

export async function getImportJob(tx: TenantTx, actor: Actor, id: string): Promise<ImportJob> {
  const { rows } = await tx.db.execute<ImportJob>(jobSql(sql`j.id = ${id}`));
  const job = rows[0];
  if (!job) throw new AppError('not_found');
  authorize(actor, KIND_PERMISSIONS[job.kind].read);
  return toJob(job);
}

/** The store's latest imports of one kind. */
export async function listImportJobs(
  tx: TenantTx,
  actor: Actor,
  kind: ImportJob['kind'] = 'products',
): Promise<ImportJob[]> {
  authorize(actor, KIND_PERMISSIONS[kind].read);
  const { rows } = await tx.db.execute<ImportJob>(sql`${jobSql(sql`j.kind = ${kind}`)} limit 20`);
  return rows.map(toJob);
}

const createInput = z.object({
  kind: z.enum(['products', 'customers']).default('products'),
  fileName: z.string().trim().min(1).max(255),
  chunkCount: z.int().min(1).max(1_000),
  total: z.int().min(1).max(100_000),
  /** The file has a stock column: needs inventory.write. */
  stock: z.boolean().default(false),
});

/** Creates a job in `staging`; the browser then uploads its chunks and starts it. */
export async function createImportJob(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ImportJob> {
  const data = parseInput(createInput, input);
  authorize(actor, KIND_PERMISSIONS[data.kind].write);
  if (data.stock) authorize(actor, 'inventory.write');
  const [row] = await tx.db
    .insert(j)
    .values({
      kind: data.kind,
      fileName: data.fileName,
      chunkCount: data.chunkCount,
      total: data.total,
      withStock: data.stock,
      withCost: actor.permissions.has('catalog.cost'),
      createdBy: actor.userId,
    })
    .returning({ id: j.id });
  if (!row) throw new AppError('internal', { detail: 'import job insert returned no row' });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'import.created',
    entityType: 'import_job',
    entityId: row.id,
    after: data,
  });
  return getImportJob(tx, actor, row.id);
}

async function lockJob(tx: TenantTx, id: string) {
  const [row] = await tx.db.select().from(j).where(eq(j.id, id)).for('update');
  if (!row) throw new AppError('not_found');
  return row;
}

/** Puts a job back to `staging` when its first chunk couldn't be queued, so it can be started again. */
export async function unstartImport(tx: TenantTx, id: string): Promise<void> {
  await tx.db
    .update(j)
    .set({ status: 'staging', updatedAt: sql`now()` })
    .where(and(eq(j.id, id), eq(j.status, 'running'), eq(j.nextChunk, 0)));
}

/** Starts a staged job: the caller queues its first chunk after commit. */
export async function startImport(tx: TenantTx, actor: Actor, id: string): Promise<ImportJob> {
  const job = await lockJob(tx, id);
  authorize(actor, KIND_PERMISSIONS[job.kind].write);
  if (job.status !== 'staging')
    throw new AppError('illegal_transition', { detail: `the import is ${job.status}` });
  await tx.db.update(j).set({ status: 'running', updatedAt: sql`now()` }).where(eq(j.id, id));
  return getImportJob(tx, actor, id);
}

/** Stops a job: chunks not yet processed are skipped, pending images dropped. */
export async function cancelImport(tx: TenantTx, actor: Actor, id: string): Promise<ImportJob> {
  const job = await lockJob(tx, id);
  authorize(actor, KIND_PERMISSIONS[job.kind].write);
  if (['done', 'failed', 'cancelled'].includes(job.status)) {
    throw new AppError('illegal_transition', { detail: `the import is ${job.status}` });
  }
  await tx.db
    .update(j)
    .set({ status: 'cancelled', finishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(j.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'import.cancelled',
    entityType: 'import_job',
    entityId: id,
    before: { status: job.status, nextChunk: job.nextChunk },
  });
  return getImportJob(tx, actor, id);
}

/** Marks a job failed (the dead-letter consumer: a chunk kept failing). */
export async function failImport(tx: TenantTx, id: string, error: string): Promise<void> {
  await tx.db
    .update(j)
    .set({
      status: 'failed',
      lastError: error.slice(0, 1000),
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(j.id, id), sql`${j.status} in ('staging', 'running', 'images')`));
}

export type ImportError = { row: number; field: string; code: string; message: string };

export async function listImportErrors(
  tx: TenantTx,
  actor: Actor,
  id: string,
  page: { afterRow?: number | undefined; limit?: number | undefined } = {},
): Promise<{ items: ImportError[]; total: number }> {
  const job = await getImportJob(tx, actor, id);
  const limit = Math.min(Math.max(page.limit ?? 200, 1), 1_000);
  const { rows } = await tx.db.execute<ImportError>(sql`
    select row, field, code, message from store.import_errors
     where job_id = ${id} ${page.afterRow !== undefined ? sql`and row > ${page.afterRow}` : sql``}
     order by row, id limit ${limit}`);
  return { items: rows, total: job.errorCount };
}

export type ImportImage = {
  id: string;
  row: number;
  productId: string;
  variantId: string | null;
  url: string;
  position: number;
  status: 'pending' | 'done' | 'failed';
};

/** The image step's work list: pending images first, in row order. */
export async function listImportImages(
  tx: TenantTx,
  actor: Actor,
  id: string,
  page: { status?: 'pending' | 'done' | 'failed' | undefined; limit?: number | undefined } = {},
): Promise<ImportImage[]> {
  await getImportJob(tx, actor, id);
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const { rows } = await tx.db.execute<ImportImage>(sql`
    select id, row, product_id as "productId", variant_id as "variantId", url, position, status
      from store.import_images
     where job_id = ${id} and status = ${page.status ?? 'pending'}
     order by row, position, id limit ${limit}`);
  return rows;
}

const imageResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('done'), mediaId: z.uuid() }),
  z.object({ status: z.literal('failed'), error: z.string().trim().min(1).max(500) }),
]);

/**
 * Records the browser's result for one image: attached to its product (and
 * variant), or a row error. The job is done once no image is pending.
 */
export async function completeImportImage(
  tx: TenantTx,
  actor: Actor,
  jobId: string,
  imageId: string,
  input: unknown,
): Promise<ImportJob> {
  authorize(actor, 'catalog.write');
  const result = parseInput(imageResult, input);
  const job = await lockJob(tx, jobId);
  const ii = schema.importImages;
  const [image] = await tx.db
    .select()
    .from(ii)
    .where(and(eq(ii.id, imageId), eq(ii.jobId, jobId)))
    .for('update');
  if (!image) throw new AppError('not_found');
  if (image.status !== 'pending' || job.status === 'cancelled')
    return getImportJob(tx, actor, jobId);

  if (result.status === 'done') {
    const [media] = await tx.db
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(eq(schema.media.id, result.mediaId));
    if (!media)
      throw new AppError('validation_failed', {
        fields: [{ path: 'mediaId', code: 'not_found', message: 'unknown image' }],
      });
    // Appended after the product's images, unless it has 10 already or this one.
    await tx.db.execute(sql`
      insert into store.product_media (product_id, media_id, position)
      select ${image.productId}, ${result.mediaId},
             coalesce((select max(position) + 1 from store.product_media where product_id = ${image.productId}), 0)
       where (select count(*) from store.product_media where product_id = ${image.productId}) < ${CATALOG_LIMITS.imagesPerProduct}
      on conflict do nothing`);
    if (image.variantId) {
      await tx.db.execute(sql`
        update store.variants set image_media_id = ${result.mediaId}
         where id = ${image.variantId}
           and exists (select 1 from store.product_media where product_id = ${image.productId} and media_id = ${result.mediaId})`);
    }
    await tx.db.execute(sql`
      update store.media set unused_since = null
       where id = ${result.mediaId}
         and exists (select 1 from store.product_media where media_id = ${result.mediaId})`);
    await tx.db
      .update(ii)
      .set({ status: 'done', mediaId: result.mediaId, updatedAt: sql`now()` })
      .where(eq(ii.id, imageId));
  } else {
    await tx.db
      .update(ii)
      .set({ status: 'failed', error: result.error, updatedAt: sql`now()` })
      .where(eq(ii.id, imageId));
    await recordErrors(tx, jobId, [
      {
        row: image.row,
        field: image.variantId ? 'variantImage' : 'images',
        code: 'image_failed',
        message: `${image.url}: ${result.error}`,
      },
    ]);
  }
  if (job.status === 'images') {
    const [pending] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(ii)
      .where(and(eq(ii.jobId, jobId), eq(ii.status, 'pending')));
    if (!pending?.n) {
      await tx.db
        .update(j)
        .set({ status: 'done', finishedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(j.id, jobId));
    }
  }
  await emit(tx, 'catalog.product.updated', {
    aggregateType: 'product',
    aggregateId: image.productId,
    payload: { fields: ['media'] },
  });
  return getImportJob(tx, actor, jobId);
}

/** Stores row errors, keeping at most 1,000 per job; error_count counts them all. */
async function recordErrors(tx: TenantTx, jobId: string, errors: ImportError[]): Promise<void> {
  if (!errors.length) return;
  const { rows } = await tx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from store.import_errors where job_id = ${jobId}`,
  );
  const room = Math.max(MAX_STORED_ERRORS - (rows[0]?.n ?? 0), 0);
  const kept = errors.slice(0, room);
  if (kept.length) {
    await tx.db.insert(schema.importErrors).values(
      kept.map((e) => ({
        jobId,
        row: e.row,
        field: e.field.slice(0, 100),
        code: e.code,
        message: e.message.slice(0, 500),
      })),
    );
  }
  await tx.db
    .update(j)
    .set({ errorCount: sql`${j.errorCount} + ${errors.length}` })
    .where(eq(j.id, jobId));
}

// ---- Processing a chunk -------------------------------------------------------------

/** How many more products the store's plan allows, read once per chunk. */
async function productsLeft(tx: TenantTx): Promise<number | null> {
  const max = (await storeEntitlements(tx)).limits.products;
  if (max === null) return null;
  return Math.max(0, max - (await countProducts(tx)));
}

interface ChunkContext {
  jobId: string;
  locale: Locale;
  vatCategories: string[];
  withCost: boolean;
  withStock: boolean;
  /** Live variants by lowercased SKU. */
  skus: Map<string, { variantId: string; productId: string }>;
  /** Products by their default-language slug: an exported handle finds its product again. */
  handles: Map<string, string>;
  attributes: Map<string, { id: string; type: string }>;
  categories: Map<string, string>;
  stock: OnHandTarget[];
  /** New products the plan still allows (phase-5b-plan §3.5); null is unlimited. */
  productsLeft: number | null;
}

/** An error in one product, reported on its row. */
class RowError extends Error {
  constructor(
    readonly row: number,
    readonly field: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Processes one chunk: validates every product again (the browser's dry run
 * is not a trust boundary), writes the valid ones, records row errors and
 * progress, and returns the next chunk's message, if any. A message for a
 * chunk already processed, or for a cancelled job, is skipped, so queue
 * redeliveries are harmless.
 */
export async function processImportChunk(
  client: DbClient,
  message: ImportMessage,
  products: unknown,
  options: WithTenantOptions = {},
): Promise<ImportMessage | null> {
  return withTenant(
    client,
    message.tenantId,
    async (tx) => {
      const job = await lockJob(tx, message.jobId);
      if (job.status !== 'running') return null;
      if (job.nextChunk !== message.chunk) {
        // A redelivery of the chunk just processed: its next message may have
        // been lost, so send it again (a duplicate is skipped the same way).
        const resend = job.nextChunk === message.chunk + 1 && job.nextChunk < job.chunkCount;
        return resend ? { ...message, chunk: job.nextChunk } : null;
      }
      const list = Array.isArray(products) ? products : [];
      if (job.kind === 'customers') return processCustomerChunk(tx, job, message, list);
      const store = await storeCatalogContext(tx);
      const errors: ImportError[] = [];
      const valid: ImportProduct[] = [];
      for (const [i, raw] of list.entries()) {
        const parsed = importProduct.safeParse(raw);
        if (parsed.success) valid.push(parsed.data);
        else {
          const row = (raw as { row?: unknown })?.row;
          const issue = parsed.error.issues[0];
          errors.push({
            row: typeof row === 'number' ? row : i + 1,
            field: issue?.path.join('.') ?? '',
            code: 'invalid',
            message: issue?.message ?? 'invalid product',
          });
        }
      }
      const ctx = await chunkContext(tx, job, valid, store);
      let created = 0;
      let updated = 0;
      let failed = list.length - valid.length;
      const productIds: string[] = [];
      for (const product of valid) {
        await tx.db.execute(sql`savepoint import_product`);
        const stockBefore = ctx.stock.length;
        try {
          const result = await writeProduct(tx, ctx, product);
          await tx.db.execute(sql`release savepoint import_product`);
          if (result.created) created += 1;
          else updated += 1;
          productIds.push(result.productId);
        } catch (e) {
          await tx.db.execute(sql`rollback to savepoint import_product`);
          ctx.stock.length = stockBefore;
          failed += 1;
          errors.push(toRowError(e, product));
        }
      }
      if (ctx.stock.length) await setOnHand(tx, systemActor, ctx.stock);
      await recordErrors(tx, job.id, errors);

      const next = message.chunk + 1;
      const last = next >= job.chunkCount;
      let status: ImportJob['status'] = 'running';
      if (last) {
        const [pending] = await tx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.importImages)
          .where(
            and(eq(schema.importImages.jobId, job.id), eq(schema.importImages.status, 'pending')),
          );
        status = pending?.n ? 'images' : 'done';
      }
      await tx.db
        .update(j)
        .set({
          nextChunk: next,
          processed: sql`least(${j.processed} + ${list.length}, ${j.total})`,
          created: sql`${j.created} + ${created}`,
          updated: sql`${j.updated} + ${updated}`,
          failed: sql`${j.failed} + ${failed}`,
          status,
          ...(status === 'done' ? { finishedAt: sql`now()` } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(j.id, job.id));
      await recordAudit(tx, {
        actorType: 'system',
        action: 'import.chunk_processed',
        entityType: 'import_job',
        entityId: job.id,
        after: { chunk: message.chunk, created, updated, failed, products: productIds },
      });
      return last ? null : { ...message, chunk: next };
    },
    options,
  );
}

function toRowError(e: unknown, product: ImportProduct): ImportError {
  if (e instanceof RowError)
    return { row: e.row, field: e.field, code: e.code, message: e.message };
  if (e instanceof AppError) {
    const field = e.fields?.[0];
    return {
      row: product.row,
      field: field?.path ?? '',
      code: e.code,
      message: field?.message ?? e.detail ?? e.message,
    };
  }
  const { code, constraint } = pgError(e);
  if (code === '23505' && constraint === 'variants_sku_unique') {
    return {
      row: product.row,
      field: 'sku',
      code: 'sku_taken',
      message: 'another product uses this SKU',
    };
  }
  if (code?.startsWith('23')) {
    return {
      row: product.row,
      field: '',
      code: 'invalid',
      message: `refused by the database (${constraint ?? code})`,
    };
  }
  throw e;
}

async function chunkContext(
  tx: TenantTx,
  job: typeof j.$inferSelect,
  products: ImportProduct[],
  store: { defaultLocale: Locale; vatCategories: string[] },
): Promise<ChunkContext> {
  const skus = products.flatMap((p) =>
    p.variants.map((v) => v.sku?.toLowerCase()).filter((s): s is string => Boolean(s)),
  );
  const handles = products.map((p) => p.handle).filter((h) => isCatalogSlug(h));
  const [skuRows, handleRows, attributeRows] = await Promise.all([
    skus.length
      ? tx.db.execute<{ variant_id: string; product_id: string; sku: string }>(sql`
          select id as variant_id, product_id, lower(sku) as sku from store.variants
           where archived_at is null and lower(sku) = any(${sql.param(skus)}::text[])`)
      : Promise.resolve({ rows: [] }),
    handles.length
      ? tx.db.execute<{ product_id: string; slug: string }>(sql`
          select product_id, slug from store.product_translations
           where locale = ${store.defaultLocale} and slug = any(${sql.param(handles)}::text[])`)
      : Promise.resolve({ rows: [] }),
    tx.db
      .select({
        id: schema.attributes.id,
        key: schema.attributes.key,
        type: schema.attributes.type,
      })
      .from(schema.attributes),
  ]);
  return {
    jobId: job.id,
    locale: store.defaultLocale,
    vatCategories: store.vatCategories,
    withCost: job.withCost,
    withStock: job.withStock,
    skus: new Map(
      skuRows.rows.map((r) => [r.sku, { variantId: r.variant_id, productId: r.product_id }]),
    ),
    handles: new Map(handleRows.rows.map((r) => [r.slug, r.product_id])),
    attributes: new Map(attributeRows.map((a) => [a.key, { id: a.id, type: a.type }])),
    categories: new Map(),
    productsLeft: await productsLeft(tx),
    stock: [],
  };
}

/** The variant columns an import sets; cost prices only for importers with catalog.cost. */
function variantValues(ctx: ChunkContext, v: ImportVariant) {
  return {
    sku: v.sku,
    barcode: v.barcode,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    ...(ctx.withCost ? { costPrice: v.costPrice } : {}),
    weightGrams: v.weightGrams,
    ...(v.trackInventory !== null ? { trackInventory: v.trackInventory } : {}),
    ...(v.allowBackorder !== null ? { allowBackorder: v.allowBackorder } : {}),
    lowStockThreshold: v.lowStockThreshold,
  };
}

async function writeProduct(
  tx: TenantTx,
  ctx: ChunkContext,
  product: ImportProduct,
): Promise<{ productId: string; created: boolean }> {
  // Which product: one its SKUs already belong to, or the one with its handle as slug.
  const owners = new Set<string>();
  for (const v of product.variants) {
    const known = v.sku ? ctx.skus.get(v.sku.toLowerCase()) : undefined;
    if (known) owners.add(known.productId);
  }
  if (owners.size > 1) {
    const v = product.variants.find(
      (x) => x.sku && ctx.skus.get(x.sku.toLowerCase())?.productId !== [...owners][0],
    );
    throw new RowError(
      v?.row ?? product.row,
      'sku',
      'conflict',
      'these SKUs belong to different products',
    );
  }
  if (product.vatCategory && !ctx.vatCategories.includes(product.vatCategory)) {
    throw new RowError(
      product.row,
      'vatCategory',
      'invalid',
      'not one of the store’s VAT categories',
    );
  }
  if (!product.translations[ctx.locale]) {
    throw new RowError(
      product.row,
      `title:${ctx.locale}`,
      'required',
      'a title in the store’s language is needed',
    );
  }
  const existing = [...owners][0] ?? ctx.handles.get(product.handle);
  const productId = existing ?? uuidv7();
  const p = schema.products;
  if (existing) {
    const [row] = await tx.db.select({ id: p.id }).from(p).where(eq(p.id, existing)).for('update');
    if (!row) throw new RowError(product.row, 'handle', 'not_found', 'the product was deleted');
    await tx.db
      .update(p)
      .set({
        status: product.status,
        ...(product.vatCategory ? { vatCategory: product.vatCategory } : {}),
      })
      .where(eq(p.id, existing));
  } else {
    if (ctx.productsLeft !== null) {
      if (ctx.productsLeft <= 0) {
        throw new RowError(product.row, 'handle', 'plan_limit', 'the plan allows no more products');
      }
      ctx.productsLeft -= 1;
    }
    await tx.db
      .insert(p)
      .values({ id: productId, status: product.status, vatCategory: product.vatCategory });
  }
  await writeTranslations(tx, ctx, productId, product, !existing);
  const variantIds = await writeVariants(tx, ctx, productId, product, !existing);
  if (product.categories.length) await linkCategories(tx, ctx, productId, product);
  if (product.tags.length) await replaceProductTags(tx, productId, product.tags);
  await writeAttributes(tx, ctx, productId, product);

  // The image step's work list.
  const ii = schema.importImages;
  const images = [
    ...product.images.map((url, position) => ({
      url,
      position,
      variantId: null as string | null,
      row: product.row,
    })),
    ...product.variants.flatMap((v, i) =>
      v.image ? [{ url: v.image, position: 0, variantId: variantIds[i] ?? null, row: v.row }] : [],
    ),
  ];
  if (images.length) {
    await tx.db.insert(ii).values(images.map((img) => ({ jobId: ctx.jobId, productId, ...img })));
  }
  if (ctx.withStock) {
    product.variants.forEach((v, i) => {
      const variantId = variantIds[i];
      if (v.stock === null || !variantId) return;
      ctx.stock.push({
        variantId,
        onHand: v.stock,
        reason: 'import',
        referenceType: 'import',
        referenceId: ctx.jobId,
        idempotencyKey: `import:${ctx.jobId}:${v.row}`,
      });
    });
  }
  // A product seen again later in the same file (by SKU) is this one.
  for (const [i, v] of product.variants.entries()) {
    if (v.sku && variantIds[i])
      ctx.skus.set(v.sku.toLowerCase(), { variantId: variantIds[i] as string, productId });
  }
  if (existing) {
    await emit(tx, 'catalog.product.updated', {
      aggregateType: 'product',
      aggregateId: productId,
      payload: { fields: ['import'] },
    });
  } else {
    await emit(tx, 'catalog.product.created', {
      aggregateType: 'product',
      aggregateId: productId,
      payload: {},
    });
  }
  return { productId, created: !existing };
}

async function writeTranslations(
  tx: TenantTx,
  ctx: ChunkContext,
  productId: string,
  product: ImportProduct,
  isNew: boolean,
): Promise<void> {
  const pt = schema.productTranslations;
  const current = isNew
    ? new Map<string, string>()
    : new Map(
        (
          await tx.db
            .select({ locale: pt.locale, slug: pt.slug })
            .from(pt)
            .where(eq(pt.productId, productId))
        ).map((r) => [r.locale, r.slug]),
      );
  for (const lang of ['bn', 'en'] as const) {
    const t = product.translations[lang];
    if (!t) continue;
    // A new product takes its handle as the default language's slug when it can.
    const wanted =
      t.slug ??
      (isNew &&
      lang === ctx.locale &&
      isCatalogSlug(product.handle) &&
      !product.handle.startsWith('row-')
        ? product.handle
        : undefined);
    const other = lang === 'bn' ? 'en' : 'bn';
    const base = {
      locale: lang,
      entityId: productId,
      current: current.get(lang),
      title: t.title,
      fallbackTitle: product.translations[other]?.title,
    };
    let slug: string;
    try {
      slug = await chooseSlug(tx, 'product', { ...base, requested: wanted });
    } catch (e) {
      if (!(e instanceof AppError && e.code === 'catalog_slug_taken') || t.slug) {
        throw new RowError(
          product.row,
          `slug:${lang}`,
          'catalog_slug_taken',
          'another product uses this URL',
        );
      }
      slug = await chooseSlug(tx, 'product', base);
    }
    const values = {
      productId,
      locale: lang,
      title: t.title,
      slug,
      ...(t.description ? { description: t.description } : {}),
      ...(t.seoTitle ? { seoTitle: t.seoTitle } : {}),
      ...(t.seoDescription ? { seoDescription: t.seoDescription } : {}),
    };
    await tx.db
      .insert(pt)
      .values(values)
      .onConflictDoUpdate({
        target: [pt.tenantId, pt.productId, pt.locale],
        set: { ...values, updatedAt: sql`now()` },
      });
    await recordSlugChange(tx, 'product', {
      locale: lang,
      entityId: productId,
      from: current.get(lang),
      to: slug,
    });
  }
}

/**
 * Options and variants from the rows. A new product gets the options and the
 * variants the rows list (only those: a file may leave combinations out). An
 * existing product must have the same option names; new values are added,
 * variants are matched by SKU, then by combination, and the rest are added.
 * Returns each row's variant ID, in row order.
 */
async function writeVariants(
  tx: TenantTx,
  ctx: ChunkContext,
  productId: string,
  product: ImportProduct,
  isNew: boolean,
): Promise<string[]> {
  const po = schema.productOptions;
  const pov = schema.productOptionValues;
  const v = schema.variants;
  const lang = ctx.locale;
  const nameKey = (name: Partial<Record<Locale, string>>) => normalizeKey(name[lang] ?? '');

  // Existing options and values, by normalized default-language name and label.
  const options: { id: string; key: string; values: Map<string, string>; nextPosition: number }[] =
    [];
  if (!isNew) {
    const { rows } = await tx.db.execute<{
      option_id: string;
      name_key: string;
      value_id: string | null;
      label_key: string | null;
      position: number | null;
    }>(sql`
      select o.id as option_id, ot.name_key, ov.id as value_id, vt.label_key, ov.position
        from store.product_options o
        join store.product_option_translations ot on ot.option_id = o.id and ot.locale = ${lang}
        left join store.product_option_values ov on ov.option_id = o.id
        left join store.product_option_value_translations vt on vt.value_id = ov.id and vt.locale = ${lang}
       where o.product_id = ${productId}
       order by o.position, ov.position`);
    for (const r of rows) {
      let option = options.find((o) => o.id === r.option_id);
      if (!option) {
        option = { id: r.option_id, key: r.name_key, values: new Map(), nextPosition: 0 };
        options.push(option);
      }
      if (r.value_id && r.label_key) option.values.set(r.label_key, r.value_id);
      option.nextPosition = Math.max(option.nextPosition, (r.position ?? -1) + 1);
    }
    const same =
      options.length === product.options.length &&
      options.every((o, i) => o.key === nameKey(product.options[i]?.name ?? {}));
    if (!same)
      throw new RowError(
        product.row,
        'option1Name',
        'conflict',
        'the options differ from the existing product’s',
      );
  } else {
    for (const [i, option] of product.options.entries()) {
      const id = uuidv7();
      await tx.db.insert(po).values({ id, productId, position: i });
      await tx.db.insert(schema.productOptionTranslations).values(
        Object.entries(option.name).map(([locale, name]) => ({
          optionId: id,
          locale: locale as Locale,
          name: name as string,
          nameKey: normalizeKey(name as string),
        })),
      );
      options.push({ id, key: nameKey(option.name), values: new Map(), nextPosition: 0 });
    }
  }

  // Values the rows use that the product doesn't have yet.
  const valueIdsByRow: string[][] = [];
  const newLabels: (typeof schema.productOptionValueTranslations.$inferInsert)[] = [];
  for (const variant of product.variants) {
    const ids: string[] = [];
    for (const [i, label] of variant.values.entries()) {
      const option = options[i];
      if (!option)
        throw new RowError(
          variant.row,
          `option${i + 1}Value`,
          'invalid',
          'a value without its option',
        );
      const key = normalizeKey(label[lang] ?? '');
      let id = option.values.get(key);
      if (!id) {
        if (option.values.size >= CATALOG_LIMITS.valuesPerOption) {
          throw new RowError(
            variant.row,
            `option${i + 1}Value`,
            'too_many',
            'too many values for this option',
          );
        }
        id = uuidv7();
        await tx.db
          .insert(pov)
          .values({ id, optionId: option.id, position: option.nextPosition++ });
        for (const [locale, text] of Object.entries(label)) {
          newLabels.push({
            valueId: id,
            locale: locale as Locale,
            label: text as string,
            labelKey: normalizeKey(text as string),
          });
        }
        option.values.set(key, id);
      }
      ids.push(id);
    }
    valueIdsByRow.push(ids);
  }
  if (newLabels.length) await tx.db.insert(schema.productOptionValueTranslations).values(newLabels);

  // Variants: by SKU, then by combination, else new.
  const live = isNew
    ? []
    : await tx.db
        .select({ id: v.id, optionsKey: v.optionsKey, position: v.position })
        .from(v)
        .where(and(eq(v.productId, productId), sql`${v.archivedAt} is null`));
  const byKey = new Map(live.map((x) => [x.optionsKey, x.id]));
  let position = Math.max(-1, ...live.map((x) => x.position)) + 1;
  const result: string[] = [];
  const links: { variantId: string; valueId: string }[] = [];
  for (const [i, row] of product.variants.entries()) {
    const ids = valueIdsByRow[i] ?? [];
    const key = optionsKey(ids);
    const bySku = row.sku ? ctx.skus.get(row.sku.toLowerCase()) : undefined;
    let id = bySku?.productId === productId ? bySku.variantId : byKey.get(key);
    const values = variantValues(ctx, row);
    if (id) {
      if (bySku && !isNew) {
        // Matched by SKU: the row may move it to another combination.
        const holder = byKey.get(key);
        if (holder && holder !== id) {
          throw new RowError(row.row, 'sku', 'conflict', 'another variant has this combination');
        }
      }
      await tx.db
        .update(v)
        .set({ ...values, optionsKey: key, updatedAt: sql`now()` })
        .where(eq(v.id, id));
      await tx.db
        .delete(schema.variantOptionValues)
        .where(eq(schema.variantOptionValues.variantId, id));
    } else {
      id = uuidv7();
      await tx.db
        .insert(v)
        .values({ id, productId, optionsKey: key, position: position++, ...values });
    }
    byKey.set(key, id);
    for (const valueId of ids) links.push({ variantId: id, valueId });
    result.push(id);
  }
  if (links.length)
    await tx.db.insert(schema.variantOptionValues).values(links).onConflictDoNothing();
  await refreshPriceRange(tx, [productId]);
  return result;
}

/** Category paths by name, created when missing (at most 3 levels). */
async function linkCategories(
  tx: TenantTx,
  ctx: ChunkContext,
  productId: string,
  product: ImportProduct,
): Promise<void> {
  const ids: string[] = [];
  for (const path of product.categories) {
    let parent: string | null = null;
    for (const [depth, name] of path.entries()) {
      const cacheKey = `${parent ?? ''}/${normalizeKey(name)}`;
      let id = ctx.categories.get(cacheKey);
      if (!id) {
        const { rows }: { rows: { id: string }[] } = await tx.db.execute<{ id: string }>(sql`
          select k.id from store.categories k
          join store.category_translations t on t.category_id = k.id and t.locale = ${ctx.locale}
          where k.parent_id is not distinct from ${parent}::uuid and lower(t.name) = ${normalizeKey(name)}
          order by k.position limit 1`);
        id = rows[0]?.id;
        if (!id) {
          id = uuidv7();
          const { rows: pos } = await tx.db.execute<{ position: number }>(
            sql`select coalesce(max(position) + 1, 0)::int as position from store.categories where parent_id is not distinct from ${parent}::uuid`,
          );
          await tx.db
            .insert(schema.categories)
            .values({ id, parentId: parent, depth, position: pos[0]?.position ?? 0 });
          await writeNameTranslations(tx, 'category', id, { [ctx.locale]: { name } }, ctx.locale);
          await emit(tx, 'catalog.category.changed', {
            aggregateType: 'category',
            aggregateId: id,
            payload: { change: 'created' },
          });
        }
        ctx.categories.set(cacheKey, id);
      }
      parent = id;
    }
    if (parent) ids.push(parent);
  }
  await tx.db.execute(sql`
    insert into store.product_categories (product_id, category_id, position)
    select ${productId}, c.id,
           coalesce((select max(position) + 1 from store.product_categories x where x.category_id = c.id), 0)
      from unnest(${sql.param([...new Set(ids)])}::uuid[]) as c(id)
    on conflict do nothing`);
}

/** Brand and "Attribute: <key>" columns, typed by each attribute (§3.7). */
async function writeAttributes(
  tx: TenantTx,
  ctx: ChunkContext,
  productId: string,
  product: ImportProduct,
): Promise<void> {
  const inputs = new Map<string, ProductAttributeInput>();
  if (product.brand) {
    const brand = ctx.attributes.get(BRAND_ATTRIBUTE_KEY);
    if (!brand) throw new AppError('internal', { detail: 'no brand attribute' });
    const valueId = await ensureAttributeValue(tx, brand.id, ctx.locale, product.brand);
    inputs.set(brand.id, { type: 'choice', attributeId: brand.id, valueIds: [valueId] });
  }
  for (const column of product.attributes) {
    const attribute = ctx.attributes.get(column.key);
    const field = `attribute:${column.key}${column.locale ? `:${column.locale}` : ''}`;
    if (!attribute)
      throw new RowError(
        product.row,
        field,
        'not_found',
        `no attribute with the key ${column.key}`,
      );
    const locale = column.locale ?? ctx.locale;
    const type = attribute.type;
    if (type === 'choice' || type === 'multi_choice') {
      if (type === 'choice' && column.values.length > 1) {
        throw new RowError(product.row, field, 'invalid', 'one value only');
      }
      const valueIds: string[] = [];
      for (const label of column.values)
        valueIds.push(await ensureAttributeValue(tx, attribute.id, locale, label));
      const before = inputs.get(attribute.id);
      const merged =
        before && 'valueIds' in before ? [...new Set([...before.valueIds, ...valueIds])] : valueIds;
      inputs.set(attribute.id, { type, attributeId: attribute.id, valueIds: merged });
    } else if (type === 'number') {
      const text = toLatinDigits(column.values[0] ?? '').replace(/,/g, '');
      const value = Number(text);
      if (column.values.length !== 1 || !text || !Number.isFinite(value)) {
        throw new RowError(product.row, field, 'invalid', 'not a number');
      }
      inputs.set(attribute.id, { type: 'number', attributeId: attribute.id, number: value });
    } else if (type === 'boolean') {
      const value = parseBooleanCell(column.values[0] ?? '');
      if (value === undefined || column.values.length !== 1) {
        throw new RowError(product.row, field, 'invalid', 'yes or no');
      }
      inputs.set(attribute.id, { type: 'boolean', attributeId: attribute.id, value });
    } else {
      const before = inputs.get(attribute.id);
      const text = before?.type === 'text' ? before.text : {};
      inputs.set(attribute.id, {
        type: 'text',
        attributeId: attribute.id,
        text: { ...text, [locale]: column.values.join(', ') },
      });
    }
  }
  if (inputs.size) await replaceProductAttributes(tx, productId, [...inputs.values()], ctx.locale);
}

// ---- Customers (phase-4-plan §3.10) --------------------------------------------------

/**
 * One chunk of customers, matched by phone, written with batched statements
 * from the start (the lesson of Phase 2's product imports, phase-2-report §3):
 * one upsert for the customers and one insert for their new addresses. An
 * existing customer keeps an email it has unless the file brings one, and
 * gains the file's tags.
 */
async function processCustomerChunk(
  tx: TenantTx,
  job: { id: string; chunkCount: number },
  message: ImportMessage,
  list: unknown[],
): Promise<ImportMessage | null> {
  const errors: ImportError[] = [];
  const byPhone = new Map<string, ImportCustomer>();
  for (const [i, raw] of list.entries()) {
    const parsed = importCustomer.safeParse(raw);
    if (!parsed.success) {
      const row = (raw as { row?: unknown })?.row;
      const issue = parsed.error.issues[0];
      errors.push({
        row: typeof row === 'number' ? row : i + 1,
        field: issue?.path.join('.') ?? '',
        code: 'invalid',
        message: issue?.message ?? 'invalid customer',
      });
      continue;
    }
    const earlier = byPhone.get(parsed.data.phone);
    if (earlier) {
      errors.push({
        row: earlier.row,
        field: 'phone',
        code: 'duplicate',
        message: `the same phone is on row ${parsed.data.row}, which was used`,
      });
    }
    byPhone.set(parsed.data.phone, parsed.data);
  }
  const rows = [...byPhone.values()];
  let created = 0;
  let updated = 0;
  if (rows.length) {
    const { rows: written } = await tx.db.execute<{ inserted: boolean }>(sql`
      insert into store.customers (phone, name, email, tags, note)
      select x.phone, x.name, x.email, coalesce(x.tags, '{}'), x.note
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          as x(phone text, name text, email text, tags text[], note text)
      on conflict (tenant_id, phone) where deleted_at is null do update set
        name = excluded.name,
        email = coalesce(excluded.email, store.customers.email),
        tags = array(select distinct t from unnest(store.customers.tags || excluded.tags) t limit 20),
        note = coalesce(excluded.note, store.customers.note)
      returning (xmax = 0) as inserted`);
    created = written.filter((w) => w.inserted).length;
    updated = written.length - created;
    const addresses = rows
      .filter((r) => r.address)
      .map((r) => ({ phone: r.phone, name: r.name, ...r.address }));
    if (addresses.length) {
      await tx.db.execute(sql`
        insert into store.customer_addresses (customer_id, name, phone, division_id, district_id, area_id, line, is_default)
        select c.id, x.name, x.phone, x."divisionId", x."districtId", x."areaId", x.line,
               not exists (select 1 from store.customer_addresses a where a.customer_id = c.id)
          from jsonb_to_recordset(${JSON.stringify(addresses)}::jsonb)
            as x(phone text, name text, "divisionId" smallint, "districtId" smallint, "areaId" int, line text)
          join store.customers c on c.phone = x.phone and c.deleted_at is null
         where not exists (select 1 from store.customer_addresses a
                            where a.customer_id = c.id and a.area_id = x."areaId" and a.line = x.line)
           and (select count(*) from store.customer_addresses a where a.customer_id = c.id) < 10`);
    }
  }
  await recordErrors(tx, job.id, errors);
  const next = message.chunk + 1;
  const last = next >= job.chunkCount;
  await tx.db
    .update(j)
    .set({
      nextChunk: next,
      processed: sql`least(${j.processed} + ${list.length}, ${j.total})`,
      created: sql`${j.created} + ${created}`,
      updated: sql`${j.updated} + ${updated}`,
      failed: sql`${j.failed} + ${list.length - rows.length}`,
      status: last ? 'done' : 'running',
      ...(last ? { finishedAt: sql`now()` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(j.id, job.id));
  await recordAudit(tx, {
    actorType: 'system',
    action: 'import.chunk_processed',
    entityType: 'import_job',
    entityId: job.id,
    after: {
      chunk: message.chunk,
      kind: 'customers',
      created,
      updated,
      failed: list.length - rows.length,
    },
  });
  if (created) {
    await emit(tx, 'customer.created', {
      aggregateType: 'import_job',
      aggregateId: job.id,
      payload: {},
    });
  }
  return last ? null : { ...message, chunk: next };
}
