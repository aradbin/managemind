// Product images (phase-2-plan §3.6). The files are in R2, uploaded through
// the API; this registers an image from its files, and sets a product's
// images, their alt text and the variants' images. Images nothing uses get
// `unused_since`, and the weekly cleanup (app.media_cleanup) removes them
// after 7 days. Core never touches R2: the caller passes a file check.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  MEDIA_EXTENSIONS,
  type MediaType,
  mediaCreate,
  productMediaInput,
} from '@managemind/shared/catalog';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { invalid, parseInput, type Translated } from './common';
import { getProduct, type ProductDetail } from './products';

const m = schema.media;
const mt = schema.mediaTranslations;

export interface MediaFile {
  width: number;
  sha256: string;
  bytes: number;
}

export interface Media {
  id: string;
  sha256: string;
  mime: MediaType;
  /** The extension of every file of this image. */
  ext: string;
  width: number;
  height: number;
  files: MediaFile[];
  alt: Translated<string>;
}

/** Looks up an uploaded file; the API answers from R2. */
export type FileCheck = (fileName: string) => Promise<{ bytes: number } | null>;

export const mediaFileName = (sha256: string, mime: MediaType) =>
  `${sha256}.${MEDIA_EXTENSIONS[mime]}`;

async function readMedia(tx: TenantTx, ids: string[]): Promise<Media[]> {
  if (!ids.length) return [];
  const { rows } = await tx.db.execute<Omit<Media, 'ext'>>(sql`
    select m.id, m.sha256, m.mime, m.width, m.height, m.files,
      coalesce((select json_object_agg(t.locale, t.alt) from store.media_translations t
                 where t.media_id = m.id), '{}'::json) as alt
      from store.media m where m.id = any(${sql.param(ids)}::uuid[])`);
  return rows.map((row) => ({ ...row, ext: MEDIA_EXTENSIONS[row.mime] }));
}

/**
 * Registers an image from files already uploaded: every file must exist with
 * the size given. The largest file's hash is the image's identity, so the
 * same upload again returns the same image.
 */
export async function registerMedia(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
  fileCheck: FileCheck,
): Promise<Media> {
  authorize(actor, 'catalog.write');
  const data = parseInput(mediaCreate, input);
  for (const [i, file] of data.files.entries()) {
    const stored = await fileCheck(mediaFileName(file.sha256, data.mime));
    if (!stored) throw invalid(`files.${i}`, 'not uploaded', 'not_found');
    if (stored.bytes !== file.bytes) throw invalid(`files.${i}.bytes`, 'differs from the upload');
  }
  const largest = [...data.files].sort((a, b) => b.width - a.width)[0] as MediaFile;
  const [inserted] = await tx.db
    .insert(m)
    .values({
      sha256: largest.sha256,
      mime: data.mime,
      width: data.width,
      height: data.height,
      files: [...data.files].sort((a, b) => a.width - b.width),
      // Unused until a product takes it.
      unusedSince: sql`now()`,
    })
    .onConflictDoNothing({ target: [m.tenantId, m.sha256] })
    .returning({ id: m.id });
  const id =
    inserted?.id ??
    (await tx.db.select({ id: m.id }).from(m).where(eq(m.sha256, largest.sha256)))[0]?.id;
  if (!id) throw new AppError('internal', { detail: 'media row vanished' });
  if (data.alt) await writeAlt(tx, id, data.alt);
  const [media] = await readMedia(tx, [id]);
  return media as Media;
}

async function writeAlt(
  tx: TenantTx,
  mediaId: string,
  alt: { bn?: string | null | undefined; en?: string | null | undefined },
): Promise<void> {
  for (const lang of ['bn', 'en'] as const) {
    const text = alt[lang];
    if (text === undefined) continue;
    if (text === null || text === '') {
      await tx.db.delete(mt).where(and(eq(mt.mediaId, mediaId), eq(mt.locale, lang)));
    } else {
      await tx.db
        .insert(mt)
        .values({ mediaId, locale: lang, alt: text })
        .onConflictDoUpdate({ target: [mt.tenantId, mt.mediaId, mt.locale], set: { alt: text } });
    }
  }
}

/** Marks images used or unused after a change, by whether anything still points at them. */
async function refreshUsage(tx: TenantTx, mediaIds: string[]): Promise<void> {
  if (!mediaIds.length) return;
  await tx.db.execute(sql`
    update store.media m set unused_since = case
        when exists (select 1 from store.product_media pm where pm.media_id = m.id)
          or exists (select 1 from store.variants v where v.image_media_id = m.id) then null
        else coalesce(m.unused_since, now()) end
     where m.id = any(${sql.param(mediaIds)}::uuid[])`);
}

/**
 * Sets a product's images in order (10 at most), their alt text, and its
 * variants' images. A variant's image must be one of the product's; removing
 * an image from the product clears it from the variants that used it.
 */
export async function setProductMedia(
  tx: TenantTx,
  actor: Actor,
  productId: string,
  input: unknown,
): Promise<ProductDetail> {
  authorize(actor, 'catalog.write');
  const data = parseInput(productMediaInput, input);
  const [product] = await tx.db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .for('update');
  if (!product) throw new AppError('not_found');
  const before = await getProduct(tx, actor, productId);

  const ids = data.images.map((i) => i.mediaId);
  const found = await readMedia(tx, ids);
  if (found.length !== ids.length) throw invalid('images', 'unknown image', 'not_found');

  const pm = schema.productMedia;
  await tx.db.delete(pm).where(eq(pm.productId, productId));
  if (ids.length) {
    await tx.db
      .insert(pm)
      .values(ids.map((mediaId, position) => ({ productId, mediaId, position })));
  }
  for (const image of data.images) if (image.alt) await writeAlt(tx, image.mediaId, image.alt);

  const v = schema.variants;
  // Variants keep only images the product still has.
  await tx.db
    .update(v)
    .set({ imageMediaId: null })
    .where(
      and(
        eq(v.productId, productId),
        ids.length ? sql`${v.imageMediaId} <> all(${sql.param(ids)}::uuid[])` : undefined,
      ),
    );
  for (const [i, entry] of (data.variantImages ?? []).entries()) {
    if (entry.mediaId && !ids.includes(entry.mediaId)) {
      throw invalid(`variantImages.${i}.mediaId`, 'not one of the product’s images');
    }
    const [updated] = await tx.db
      .update(v)
      .set({ imageMediaId: entry.mediaId })
      .where(and(eq(v.id, entry.variantId), eq(v.productId, productId), isNull(v.archivedAt)))
      .returning({ id: v.id });
    if (!updated)
      throw invalid(`variantImages.${i}.variantId`, 'not a variant of this product', 'not_found');
  }
  await tx.db
    .update(schema.products)
    .set({ updatedAt: sql`now()` })
    .where(eq(schema.products.id, productId));
  const touched = [...new Set([...before.media.map((x) => x.mediaId), ...ids])];
  await refreshUsage(tx, touched);

  const after = await getProduct(tx, actor, productId);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'product.media_set',
    entityType: 'product',
    entityId: productId,
    before: before.media.map((x) => x.mediaId),
    after: after.media.map((x) => x.mediaId),
  });
  await emit(tx, 'catalog.product.updated', {
    aggregateType: 'product',
    aggregateId: productId,
    payload: { fields: ['media'] },
  });
  return after;
}

/** Images by ID, with their files and alt text (the editor's thumbnails). */
export async function getMedia(tx: TenantTx, actor: Actor, ids: string[]): Promise<Media[]> {
  authorize(actor, 'catalog.read');
  return readMedia(tx, [...new Set(ids)]);
}

/** Whether `fileName` belongs to an image of this store (for serving it to the admin). */
export async function mediaFileExists(
  tx: TenantTx,
  actor: Actor,
  fileName: string,
): Promise<boolean> {
  authorize(actor, 'catalog.read');
  const sha256 = fileName.split('.')[0] ?? '';
  const { rows } = await tx.db.execute<{ ok: boolean }>(sql`
    select exists (select 1 from store.media
      where files @> ${JSON.stringify([{ sha256 }])}::jsonb) as ok`);
  return rows[0]?.ok ?? false;
}
