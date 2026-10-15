// Spreadsheet import jobs (phase-2-plan §3.7). Staged rows live in R2 as one
// JSON file per chunk; these tables hold the job's progress, its row errors
// and the image step's work list.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { products, variants } from './catalog';
import { media } from './media';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const IMPORT_KINDS = ['products'] as const;
export const IMPORT_STATUSES = [
  'staging',
  'running',
  'images',
  'done',
  'failed',
  'cancelled',
] as const;
export const IMPORT_IMAGE_STATUSES = ['pending', 'done', 'failed'] as const;

const ts = () => timestamp({ withTimezone: true });
const count = () => integer().notNull().default(0);

export const importJobs = store.table(
  'import_jobs',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    kind: text({ enum: IMPORT_KINDS }).notNull().default('products'),
    status: text({ enum: IMPORT_STATUSES }).notNull().default('staging'),
    fileName: text().notNull(),
    chunkCount: integer().notNull(),
    /** The chunk the queue works on next; chunks are processed one at a time. */
    nextChunk: count(),
    /** Products in the file, and what happened to them. */
    total: count(),
    processed: count(),
    created: count(),
    updated: count(),
    failed: count(),
    /** All row errors, including those past the 1,000 stored in import_errors. */
    errorCount: count(),
    lastError: text(),
    createdBy: uuid(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
    finishedAt: ts(),
  },
  (t) => [
    tenantPolicy(t),
    unique('import_jobs_tenant_id_unique').on(t.tenantId, t.id),
    index('import_jobs_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    check('import_jobs_kind_valid', sql`${t.kind} in ('products')`),
    check(
      'import_jobs_status_valid',
      sql`${t.status} in ('staging', 'running', 'images', 'done', 'failed', 'cancelled')`,
    ),
    check(
      'import_jobs_counts_valid',
      sql`${t.chunkCount} between 1 and 1000 and ${t.nextChunk} between 0 and ${t.chunkCount}
          and ${t.processed} <= ${t.total} and ${t.created} + ${t.updated} + ${t.failed} <= ${t.processed}`,
    ),
    check('import_jobs_file_name_length', sql`char_length(${t.fileName}) between 1 and 255`),
  ],
);

export const importErrors = store.table(
  'import_errors',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    jobId: uuid().notNull(),
    /** The spreadsheet row, 1-based, counting the header. */
    row: integer().notNull(),
    /** The column's ID (shared columnId), or '' for the whole row. */
    field: text().notNull(),
    code: text().notNull(),
    message: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    foreignKey({
      name: 'import_errors_job_fk',
      columns: [t.tenantId, t.jobId],
      foreignColumns: [importJobs.tenantId, importJobs.id],
    }).onDelete('cascade'),
    index('import_errors_job_idx').on(t.tenantId, t.jobId, t.row),
    check('import_errors_message_length', sql`char_length(${t.message}) <= 500`),
  ],
);

/** The image step's work list (§3.7): kept here so it outlives the staged files. */
export const importImages = store.table(
  'import_images',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    jobId: uuid().notNull(),
    row: integer().notNull(),
    productId: uuid().notNull(),
    /** Set for a variant's own image. */
    variantId: uuid(),
    url: text().notNull(),
    position: smallint().notNull(),
    status: text({ enum: IMPORT_IMAGE_STATUSES }).notNull().default('pending'),
    mediaId: uuid(),
    error: text(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    foreignKey({
      name: 'import_images_job_fk',
      columns: [t.tenantId, t.jobId],
      foreignColumns: [importJobs.tenantId, importJobs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_images_product_fk',
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_images_variant_fk',
      columns: [t.tenantId, t.variantId],
      foreignColumns: [variants.tenantId, variants.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_images_media_fk',
      columns: [t.tenantId, t.mediaId],
      foreignColumns: [media.tenantId, media.id],
    }).onDelete('cascade'),
    index('import_images_work_idx').on(t.tenantId, t.jobId, t.status, t.row),
    check('import_images_status_valid', sql`${t.status} in ('pending', 'done', 'failed')`),
    check('import_images_url_length', sql`char_length(${t.url}) between 1 and 2048`),
    check('import_images_position_range', sql`${t.position} between 0 and 9`),
  ],
);
