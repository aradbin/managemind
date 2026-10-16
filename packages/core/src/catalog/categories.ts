// Categories (phase-2-plan §3.3, §3.4): a tree of at most 3 levels for
// navigation, with each category's attribute template.
import { schema } from '@managemind/db';
import { AppError, uuidv7 } from '@managemind/shared';
import {
  CATALOG_LIMITS,
  categoryCreate,
  categoryMove,
  categoryPatch,
} from '@managemind/shared/catalog';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { writeNameTranslations } from './collections';
import {
  catalogWrite,
  invalid,
  parseInput,
  requireDefault,
  storeCatalogContext,
  type Translated,
} from './common';
import { dropRedirects } from './slugs';

const c = schema.categories;
const MAX_DEPTH = CATALOG_LIMITS.categoryDepth - 1;

export type Category = {
  id: string;
  parentId: string | null;
  depth: number;
  position: number;
  translations: Translated<{ name: string; slug: string; description: unknown }>;
  /** The template: attribute IDs in order. */
  attributeIds: string[];
  productCount: number;
};

const categorySql = (where = sql`true`) => sql`
  select k.id, k.parent_id as "parentId", k.depth, k.position,
    coalesce((select json_object_agg(t.locale, json_build_object('name', t.name, 'slug', t.slug,
      'description', t.description)) from store.category_translations t
      where t.category_id = k.id), '{}'::json) as translations,
    coalesce((select json_agg(ca.attribute_id order by ca.position)
      from store.category_attributes ca where ca.category_id = k.id), '[]'::json) as "attributeIds",
    (select count(*)::int from store.product_categories pc where pc.category_id = k.id) as "productCount"
  from store.categories k where ${where}
  order by k.depth, k.parent_id nulls first, k.position, k.id`;

/** The whole tree, parents before children, siblings in order. */
export async function listCategories(tx: TenantTx, actor: Actor): Promise<Category[]> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<Category>(categorySql());
  return rows;
}

export async function getCategory(tx: TenantTx, actor: Actor, id: string): Promise<Category> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<Category>(categorySql(sql`k.id = ${id}`));
  if (!rows[0]) throw new AppError('not_found');
  return rows[0];
}

async function parentDepth(tx: TenantTx, parentId: string | null | undefined): Promise<number> {
  if (!parentId) return -1;
  const [parent] = await tx.db.select({ depth: c.depth }).from(c).where(eq(c.id, parentId));
  if (!parent) throw invalid('parentId', 'unknown category', 'not_found');
  return parent.depth;
}

const changed = (tx: TenantTx, id: string, change: 'created' | 'updated' | 'moved' | 'deleted') =>
  emit(tx, 'catalog.category.changed', {
    aggregateType: 'category',
    aggregateId: id,
    payload: { change },
  });

export async function createCategory(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<Category> {
  authorize(actor, 'catalog.write');
  const data = parseInput(categoryCreate, input);
  const { defaultLocale } = await storeCatalogContext(tx);
  requireDefault(data.translations, defaultLocale);
  const depth = (await parentDepth(tx, data.parentId)) + 1;
  if (depth > MAX_DEPTH)
    throw invalid('parentId', `categories go at most ${CATALOG_LIMITS.categoryDepth} levels deep`);
  const id = uuidv7();
  const parent = data.parentId ?? null;
  const { rows } = await tx.db.execute<{ position: number }>(
    sql`select coalesce(max(position) + 1, 0)::int as position from store.categories
         where parent_id is not distinct from ${parent}`,
  );
  await tx.db.insert(c).values({ id, parentId: parent, depth, position: rows[0]?.position ?? 0 });
  await writeNameTranslations(tx, 'category', id, data.translations, defaultLocale);
  const created = await getCategory(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'category.created',
    entityType: 'category',
    entityId: id,
    after: { parentId: parent, translations: created.translations },
  });
  await changed(tx, id, 'created');
  return created;
}

export async function updateCategory(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Category> {
  authorize(actor, 'catalog.write');
  const patch = parseInput(categoryPatch, input);
  const before = await getCategory(tx, actor, id);
  const { defaultLocale } = await storeCatalogContext(tx);
  if (patch.translations)
    await writeNameTranslations(tx, 'category', id, patch.translations, defaultLocale);
  await tx.db.update(c).set({ updatedAt: sql`now()` }).where(eq(c.id, id));
  const after = await getCategory(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'category.updated',
    entityType: 'category',
    entityId: id,
    before: before.translations,
    after: after.translations,
  });
  await changed(tx, id, 'updated');
  return after;
}

/**
 * Moves a category (with everything under it) to a new parent and position.
 * Refused if it would go under itself or past 3 levels.
 */
export async function moveCategory(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Category> {
  authorize(actor, 'catalog.write');
  const move = parseInput(categoryMove, input);
  const before = await getCategory(tx, actor, id);
  // The subtree: its IDs and how deep it goes below the category.
  const { rows: subtree } = await tx.db.execute<{ id: string; rel: number }>(sql`
    with recursive tree as (
      select id, 0 as rel from store.categories where id = ${id}
      union all select k.id, tree.rel + 1 from store.categories k join tree on k.parent_id = tree.id)
    select id, rel from tree`);
  if (move.parentId && subtree.some((row) => row.id === move.parentId)) {
    throw invalid('parentId', 'a category can’t move under itself');
  }
  const depth = (await parentDepth(tx, move.parentId)) + 1;
  const height = Math.max(...subtree.map((row) => row.rel));
  if (depth + height > MAX_DEPTH) {
    throw invalid('parentId', `categories go at most ${CATALOG_LIMITS.categoryDepth} levels deep`);
  }
  // Siblings at the destination, without this category, then insert it at the position.
  const { rows: siblings } = await tx.db.execute<{ id: string }>(sql`
    select id from store.categories
     where parent_id is not distinct from ${move.parentId} and id <> ${id}
     order by position, id`);
  const order = siblings.map((s) => s.id);
  order.splice(Math.min(move.position ?? order.length, order.length), 0, id);
  await tx.db.execute(sql`
    update store.categories k set
      parent_id = case when k.id = ${id} then ${move.parentId}::uuid else k.parent_id end,
      depth = ${depth} + t.rel,
      updated_at = now()
    from (select * from unnest(${sql.param(subtree.map((r) => r.id))}::uuid[], ${sql.param(subtree.map((r) => r.rel))}::int[]) as t(id, rel)) t
    where k.id = t.id`);
  await tx.db.execute(sql`
    update store.categories k set position = o.n - 1
    from unnest(${sql.param(order)}::uuid[]) with ordinality as o(id, n)
    where k.id = o.id and k.position <> o.n - 1`);
  const after = await getCategory(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'category.moved',
    entityType: 'category',
    entityId: id,
    before: { parentId: before.parentId, position: before.position },
    after: { parentId: after.parentId, position: after.position },
  });
  await changed(tx, id, 'moved');
  return after;
}

/** Deletes an empty category: no categories under it, no products in it. */
export async function deleteCategory(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'catalog.write');
  const before = await getCategory(tx, actor, id);
  if (before.productCount > 0)
    throw new AppError('in_use', { detail: 'The category still has products' });
  await catalogWrite(() => tx.db.delete(c).where(eq(c.id, id)));
  await dropRedirects(tx, 'category', id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'category.deleted',
    entityType: 'category',
    entityId: id,
    before: { parentId: before.parentId, translations: before.translations },
  });
  await changed(tx, id, 'deleted');
}

const template = z.array(z.uuid()).max(CATALOG_LIMITS.attributesPerStore);

/** The category's attribute template, in order (§3.4). */
export async function setCategoryAttributes(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Category> {
  authorize(actor, 'catalog.write');
  const attributeIds = parseInput(template, input);
  if (new Set(attributeIds).size !== attributeIds.length) throw invalid('', 'each attribute once');
  const before = await getCategory(tx, actor, id);
  const ca = schema.categoryAttributes;
  await tx.db.delete(ca).where(eq(ca.categoryId, id));
  if (attributeIds.length) {
    await catalogWrite(() =>
      tx.db
        .insert(ca)
        .values(
          attributeIds.map((attributeId, position) => ({ categoryId: id, attributeId, position })),
        ),
    );
  }
  const after = await getCategory(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'category.template_set',
    entityType: 'category',
    entityId: id,
    before: before.attributeIds,
    after: after.attributeIds,
  });
  await changed(tx, id, 'updated');
  return after;
}

/**
 * The attributes the editor shows first for a product in these categories:
 * the templates of the categories and their parents, nearest first.
 */
export async function templateAttributes(
  tx: TenantTx,
  actor: Actor,
  categoryIds: string[],
): Promise<string[]> {
  authorize(actor, 'catalog.read');
  if (!categoryIds.length) return [];
  const { rows } = await tx.db.execute<{ attribute_id: string }>(sql`
    with recursive up as (
      select id, parent_id, 0 as dist from store.categories where id = any(${sql.param(categoryIds)}::uuid[])
      union all select k.id, k.parent_id, up.dist + 1 from store.categories k join up on k.id = up.parent_id)
    select ca.attribute_id from store.category_attributes ca join up on up.id = ca.category_id
    group by ca.attribute_id order by min(up.dist), min(ca.position)`);
  return rows.map((r) => r.attribute_id);
}
