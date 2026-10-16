// Slugs and redirects (phase-2-plan §3.2). Slugs are unique per store,
// language and kind. A changed slug leaves a redirect to the entity (never to
// another slug, so renames never chain), and a live slug always wins: taking
// a slug deletes any redirect from it in the same transaction.

import { AppError } from '@managemind/shared';
import { nextSlug, slugify } from '@managemind/shared/catalog';
import { sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';
import { type Locale, mapCatalogError } from './common';

export type SlugKind = 'product' | 'category' | 'collection' | 'page';

const TABLES: Record<SlugKind, { table: string; column: string }> = {
  product: { table: 'store.product_translations', column: 'product_id' },
  category: { table: 'store.category_translations', column: 'category_id' },
  collection: { table: 'store.collection_translations', column: 'collection_id' },
  page: { table: 'store.page_translations', column: 'page_id' },
};

/**
 * The slug a translation gets: the one asked for (refused if another entity
 * has it), the current one when nothing changes, or a free one generated
 * from the title ("shirt", then "shirt-2", …).
 */
export async function chooseSlug(
  tx: TenantTx,
  kind: SlugKind,
  input: {
    locale: Locale;
    entityId: string;
    requested?: string | undefined;
    current?: string | undefined;
    title: string;
    /** Used when the title leaves nothing (only punctuation): e.g. the other language's title. */
    fallbackTitle?: string | undefined;
  },
): Promise<string> {
  const { table, column } = TABLES[kind];
  if (input.requested) {
    const { rows } = await tx.db.execute<{ owner: string }>(
      sql`select ${sql.raw(column)} as owner from ${sql.raw(table)}
           where locale = ${input.locale} and slug = ${input.requested}`,
    );
    if (rows[0] && rows[0].owner !== input.entityId) {
      throw new AppError('catalog_slug_taken', {
        fields: [
          { path: `translations.${input.locale}.slug`, code: 'taken', message: 'already in use' },
        ],
      });
    }
    return input.requested;
  }
  if (input.current) return input.current;

  const base =
    slugify(input.title) ||
    slugify(input.fallbackTitle ?? '') ||
    `${kind}-${input.entityId.slice(-8)}`;
  // Every taken slug of the form base or base-N, in one query.
  const pattern = `^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-[0-9]+)?$`;
  const { rows } = await tx.db.execute<{ slug: string }>(
    sql`select slug from ${sql.raw(table)} where locale = ${input.locale} and slug ~ ${pattern}`,
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = nextSlug(base, n);
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * After a translation's slug changed from `from` to `to`: keep `from` as a
 * redirect to the entity, and drop any redirect from `to` (a live slug wins).
 */
export async function recordSlugChange(
  tx: TenantTx,
  kind: SlugKind,
  change: { locale: Locale; entityId: string; from: string | undefined; to: string },
): Promise<void> {
  try {
    await tx.db.execute(
      sql`delete from store.slug_redirects
           where entity_type = ${kind} and locale = ${change.locale} and from_slug = ${change.to}`,
    );
    if (change.from && change.from !== change.to) {
      await tx.db.execute(
        sql`insert into store.slug_redirects (entity_type, locale, from_slug, entity_id)
            values (${kind}, ${change.locale}, ${change.from}, ${change.entityId})
            on conflict (tenant_id, entity_type, locale, from_slug)
            do update set entity_id = excluded.entity_id, created_at = now()`,
      );
    }
  } catch (e) {
    mapCatalogError(e);
  }
}

/** Removes an entity's redirects (when the entity itself is deleted). */
export async function dropRedirects(tx: TenantTx, kind: SlugKind, entityId: string): Promise<void> {
  await tx.db.execute(
    sql`delete from store.slug_redirects where entity_type = ${kind} and entity_id = ${entityId}`,
  );
}

/** Where an old slug points now, for Phase 3's 301s. */
export async function resolveRedirect(
  tx: TenantTx,
  kind: SlugKind,
  locale: Locale,
  slug: string,
): Promise<string | null> {
  const { rows } = await tx.db.execute<{ entity_id: string }>(
    sql`select entity_id from store.slug_redirects
         where entity_type = ${kind} and locale = ${locale} and from_slug = ${slug}`,
  );
  return rows[0]?.entity_id ?? null;
}
