// Product images (phase-2-plan §3.6). The admin resizes each photo to fixed
// widths and uploads the files through the API into R2, named by content
// hash; one `media` row describes the image and its files.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const MEDIA_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

export const media = store.table(
  'media',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    /** SHA-256 of the largest file: the image's identity, so a re-upload reuses the row. */
    sha256: text().notNull(),
    mime: text({ enum: MEDIA_TYPES }).notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    /** [{ width, sha256, bytes }], validated by the media service. */
    files: jsonb().notNull(),
    /** Set when no product or variant uses the image; the weekly cleanup removes it after 7 days. */
    unusedSince: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('media_tenant_id_unique').on(t.tenantId, t.id),
    unique('media_sha256_unique').on(t.tenantId, t.sha256),
    index('media_unused_idx').on(t.tenantId, t.unusedSince).where(sql`unused_since is not null`),
    check('media_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('media_mime_valid', sql`${t.mime} in ('image/webp', 'image/jpeg', 'image/png')`),
    check('media_dimensions_positive', sql`${t.width} > 0 and ${t.height} > 0`),
    check('media_files_array', sql`jsonb_typeof(${t.files}) = 'array'`),
  ],
);

export const mediaTranslations = store.table(
  'media_translations',
  {
    ...tenantColumns(),
    mediaId: uuid().notNull(),
    locale: text({ enum: ['bn', 'en'] }).notNull(),
    alt: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.mediaId, t.locale] }),
    foreignKey({
      name: 'media_translations_media_fk',
      columns: [t.tenantId, t.mediaId],
      foreignColumns: [media.tenantId, media.id],
    }).onDelete('cascade'),
    check('media_translations_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check('media_translations_alt_length', sql`char_length(${t.alt}) between 1 and 250`),
  ],
);
