// Storefront content (phase-3-plan §4): static pages and the images a theme
// uses. Every reference between store tables is a composite foreign key on
// (tenant_id, id), like the catalog's.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { media } from './media';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const PAGE_KINDS = [
  'about',
  'contact',
  'privacy',
  'returns',
  'delivery',
  'terms',
  'custom',
] as const;

const ts = () => timestamp({ withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** About, contact, the policies and custom pages, written by the store (Q12). */
export const pages = store.table(
  'pages',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    kind: text({ enum: PAGE_KINDS }).notNull(),
    published: boolean().notNull().default(false),
    /** Order in the footer. */
    position: integer().notNull().default(0),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('pages_tenant_id_unique').on(t.tenantId, t.id),
    // One page of each kind, except custom pages.
    uniqueIndex('pages_one_per_kind').on(t.tenantId, t.kind).where(sql`kind <> 'custom'`),
    index('pages_tenant_position_idx').on(t.tenantId, t.position),
    check('pages_kind_valid', sql`${t.kind} in (${inList(PAGE_KINDS)})`),
  ],
);

export const pageTranslations = store.table(
  'page_translations',
  {
    ...tenantColumns(),
    pageId: uuid().notNull(),
    locale: text({ enum: ['bn', 'en'] }).notNull(),
    title: text().notNull(),
    slug: text().notNull(),
    /** ProseMirror JSON, validated against the description whitelist (Phase 2). */
    body: jsonb(),
    seoTitle: text(),
    seoDescription: text(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.pageId, t.locale] }),
    foreignKey({
      name: 'page_translations_page_fk',
      columns: [t.tenantId, t.pageId],
      foreignColumns: [pages.tenantId, pages.id],
    }).onDelete('cascade'),
    unique('page_translations_slug_unique').on(t.tenantId, t.locale, t.slug),
    check('page_translations_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check('page_translations_title_length', sql`char_length(${t.title}) between 1 and 120`),
    check(
      'page_translations_slug_format',
      sql`${t.slug} = lower(${t.slug}) and char_length(${t.slug}) between 1 and 120 and ${t.slug} !~ '(^-|-$|--|[[:space:]/?#%&])'`,
    ),
  ],
);

/**
 * The images a store's theme uses (logo, favicon, banners), in the draft or
 * the published theme. Rewritten whenever either changes, so the weekly
 * image cleanup never deletes an image a theme still shows.
 */
export const themeMedia = store.table(
  'theme_media',
  {
    ...tenantColumns(),
    mediaId: uuid().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.mediaId] }),
    foreignKey({
      name: 'theme_media_media_fk',
      columns: [t.tenantId, t.mediaId],
      foreignColumns: [media.tenantId, media.id],
    }).onDelete('restrict'),
  ],
);
