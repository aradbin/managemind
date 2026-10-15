// Collections (phase-2-plan §3.3): manual (a chosen, ordered list) or
// rule-based (up to 5 conditions, all must match). Rules are evaluated in SQL
// when read, never stored as membership, so they can't go stale.
import { schema } from '@managemind/db';
import { AppError, uuidv7 } from '@managemind/shared';
import {
  type CollectionCondition,
  type CollectionRules,
  collectionCreate,
  collectionPatch,
  collectionRules,
} from '@managemind/shared/catalog';
import { eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import {
  catalogWrite,
  invalid,
  type Locale,
  parseInput,
  requireDefault,
  storeCatalogContext,
  type Translated,
} from './common';
import { chooseSlug, dropRedirects, recordSlugChange } from './slugs';

const c = schema.collections;

interface NameTranslation {
  name: string;
  slug: string;
  description: unknown;
}

export interface Collection {
  id: string;
  kind: 'manual' | 'rule';
  rules: CollectionRules | null;
  sort: string;
  published: boolean;
  translations: Translated<NameTranslation>;
  /** Manual collections: chosen products; rule collections: current matches. */
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

/** SQL for one condition, about the product `p`. */
function conditionSql(condition: CollectionCondition): SQL {
  switch (condition.type) {
    case 'category':
      // The category or any category under it.
      return sql`exists (
        with recursive tree as (
          select id from store.categories where id = ${condition.categoryId}
          union all select k.id from store.categories k join tree on k.parent_id = tree.id)
        select 1 from store.product_categories pc
         where pc.product_id = p.id and pc.category_id in (select id from tree))`;
    case 'price':
      return sql`exists (select 1 from store.variants rv
        where rv.product_id = p.id and rv.archived_at is null
          ${condition.min !== null ? sql`and rv.price >= ${condition.min}` : sql``}
          ${condition.max !== null ? sql`and rv.price <= ${condition.max}` : sql``})`;
    case 'title_contains':
      return sql`exists (select 1 from store.product_translations rt
        where rt.product_id = p.id and rt.title ilike ${`%${condition.text.replace(/[\\%_]/g, (x) => `\\${x}`)}%`})`;
    case 'created_within_days':
      return sql`p.created_at > now() - make_interval(days => ${condition.days})`;
    case 'tag':
      return sql`exists (select 1 from store.product_tags rg where rg.product_id = p.id and rg.tag = ${condition.tag})`;
    case 'brand':
      return sql`exists (select 1 from store.product_attributes ra join store.attributes rb on rb.id = ra.attribute_id
        where ra.product_id = p.id and rb.key = 'brand' and ra.value_id = ${condition.valueId})`;
    case 'attribute_value':
      return sql`exists (select 1 from store.product_attributes ra
        where ra.product_id = p.id and ra.attribute_id = ${condition.attributeId} and ra.value_id = ${condition.valueId})`;
    case 'attribute_range':
      return sql`exists (select 1 from store.product_attributes ra
        where ra.product_id = p.id and ra.attribute_id = ${condition.attributeId}
          ${condition.min !== null ? sql`and ra.number_value >= ${condition.min}` : sql``}
          ${condition.max !== null ? sql`and ra.number_value <= ${condition.max}` : sql``})`;
    case 'attribute_boolean':
      return sql`exists (select 1 from store.product_attributes ra
        where ra.product_id = p.id and ra.attribute_id = ${condition.attributeId} and ra.boolean_value = ${condition.value})`;
  }
}

/** Every condition must match (Q7). */
export const rulesSql = (rules: CollectionRules): SQL =>
  sql`(${sql.join(rules.conditions.map(conditionSql), sql` and `)})`;

/** A condition on `p` for "is in this collection". */
export async function collectionMatch(tx: TenantTx, collectionId: string): Promise<SQL> {
  const [row] = await tx.db
    .select({ kind: c.kind, rules: c.rules })
    .from(c)
    .where(eq(c.id, collectionId));
  if (!row) throw new AppError('not_found');
  if (row.kind === 'manual') {
    return sql`exists (select 1 from store.collection_products cp
      where cp.product_id = p.id and cp.collection_id = ${collectionId})`;
  }
  return rulesSql(collectionRules.parse(row.rules));
}

const collectionSql = (where: SQL) => sql`
  select c.id, c.kind, c.rules, c.sort, c.published,
    coalesce((select json_object_agg(t.locale, json_build_object('name', t.name, 'slug', t.slug,
      'description', t.description)) from store.collection_translations t
      where t.collection_id = c.id), '{}'::json) as translations,
    c.created_at as "createdAt", c.updated_at as "updatedAt"
  from store.collections c where ${where}
  order by c.created_at desc`;

async function withCounts(
  tx: TenantTx,
  rows: Omit<Collection, 'productCount'>[],
): Promise<Collection[]> {
  const out: Collection[] = [];
  for (const row of rows) {
    const match =
      row.kind === 'manual'
        ? sql`exists (select 1 from store.collection_products cp where cp.product_id = p.id and cp.collection_id = ${row.id})`
        : rulesSql(collectionRules.parse(row.rules));
    const { rows: n } = await tx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from store.products p where p.status <> 'archived' and ${match}`,
    );
    out.push({
      ...row,
      productCount: n[0]?.n ?? 0,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    });
  }
  return out;
}

export async function listCollections(tx: TenantTx, actor: Actor): Promise<Collection[]> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<Omit<Collection, 'productCount'>>(collectionSql(sql`true`));
  return withCounts(tx, rows);
}

export async function getCollection(tx: TenantTx, actor: Actor, id: string): Promise<Collection> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<Omit<Collection, 'productCount'>>(
    collectionSql(sql`c.id = ${id}`),
  );
  if (!rows[0]) throw new AppError('not_found');
  return (await withCounts(tx, rows))[0] as Collection;
}

/** Writes name translations with slugs; shared with categories. */
export async function writeNameTranslations(
  tx: TenantTx,
  kind: 'category' | 'collection',
  entityId: string,
  input: Translated<{ name: string; slug?: string | undefined; description?: unknown } | null>,
  locale: Locale,
): Promise<void> {
  const table = kind === 'category' ? schema.categoryTranslations : schema.collectionTranslations;
  const idColumn =
    kind === 'category'
      ? schema.categoryTranslations.categoryId
      : schema.collectionTranslations.collectionId;
  const existing = await tx.db
    .select({ locale: table.locale, slug: table.slug, name: table.name })
    .from(table)
    .where(eq(idColumn, entityId));
  const current = new Map(existing.map((t) => [t.locale, t]));
  for (const lang of ['bn', 'en'] as const) {
    const t = input[lang];
    if (t === undefined) continue;
    if (t === null) {
      if (lang === locale)
        throw invalid(
          `translations.${lang}`,
          'the store’s default language is required',
          'required',
        );
      await tx.db.execute(
        sql`delete from ${table} where ${idColumn} = ${entityId} and locale = ${lang}`,
      );
      continue;
    }
    const other = lang === 'bn' ? 'en' : 'bn';
    const slug = await chooseSlug(tx, kind, {
      locale: lang,
      entityId,
      requested: t.slug,
      current: current.get(lang)?.slug,
      title: t.name,
      fallbackTitle: input[other]?.name ?? current.get(other)?.name,
    });
    const column = sql.raw(kind === 'category' ? 'category_id' : 'collection_id');
    // Left out of the input, the description stays as it is.
    const keep = t.description === undefined;
    const description = keep
      ? sql.raw(`${kind === 'category' ? 'category' : 'collection'}_translations.description`)
      : sql`excluded.description`;
    await catalogWrite(() =>
      tx.db.execute(sql`
        insert into ${table} (${column}, locale, name, slug, description)
        values (${entityId}, ${lang}, ${t.name}, ${slug}, ${keep ? null : JSON.stringify(t.description)}::jsonb)
        on conflict (tenant_id, ${column}, locale)
        do update set name = excluded.name, slug = excluded.slug, description = ${description},
          updated_at = now()`),
    );
    await recordSlugChange(tx, kind, {
      locale: lang,
      entityId,
      from: current.get(lang)?.slug,
      to: slug,
    });
  }
}

export async function createCollection(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<Collection> {
  authorize(actor, 'catalog.write');
  const data = parseInput(collectionCreate, input);
  const { defaultLocale } = await storeCatalogContext(tx);
  requireDefault(data.translations, defaultLocale);
  const id = uuidv7();
  await tx.db.insert(c).values({
    id,
    kind: data.kind,
    rules: data.kind === 'rule' ? data.rules : null,
    sort: data.sort,
    published: data.published,
  });
  await writeNameTranslations(tx, 'collection', id, data.translations, defaultLocale);
  const created = await getCollection(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'collection.created',
    entityType: 'collection',
    entityId: id,
    after: { kind: data.kind, rules: created.rules, translations: created.translations },
  });
  await emit(tx, 'catalog.collection.changed', {
    aggregateType: 'collection',
    aggregateId: id,
    payload: { change: 'created' },
  });
  return created;
}

export async function updateCollection(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Collection> {
  authorize(actor, 'catalog.write');
  const patch = parseInput(collectionPatch, input);
  const before = await getCollection(tx, actor, id);
  const { defaultLocale } = await storeCatalogContext(tx);
  if (patch.rules && before.kind !== 'rule')
    throw invalid('rules', 'only rule-based collections have rules');
  if (patch.sort === 'manual' && before.kind === 'rule')
    throw invalid('sort', 'rule-based collections can’t be sorted by hand');
  if (patch.translations)
    await writeNameTranslations(tx, 'collection', id, patch.translations, defaultLocale);
  await tx.db
    .update(c)
    .set({
      ...(patch.rules ? { rules: patch.rules } : {}),
      ...(patch.sort ? { sort: patch.sort } : {}),
      ...(patch.published !== undefined ? { published: patch.published } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(c.id, id));
  const after = await getCollection(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'collection.updated',
    entityType: 'collection',
    entityId: id,
    before,
    after,
  });
  await emit(tx, 'catalog.collection.changed', {
    aggregateType: 'collection',
    aggregateId: id,
    payload: { change: 'updated' },
  });
  return after;
}

export async function deleteCollection(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'catalog.write');
  const before = await getCollection(tx, actor, id);
  await tx.db.delete(c).where(eq(c.id, id));
  await dropRedirects(tx, 'collection', id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'collection.deleted',
    entityType: 'collection',
    entityId: id,
    before: { kind: before.kind, translations: before.translations },
  });
  await emit(tx, 'catalog.collection.changed', {
    aggregateType: 'collection',
    aggregateId: id,
    payload: { change: 'deleted' },
  });
}

const productOrder = z.array(z.uuid()).max(1_000);

/** A manual collection's products, in order: the full list (§3.3). */
export async function setCollectionProducts(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Collection> {
  authorize(actor, 'catalog.write');
  const productIds = parseInput(productOrder, input);
  if (new Set(productIds).size !== productIds.length) throw invalid('', 'each product once');
  const before = await getCollection(tx, actor, id);
  if (before.kind !== 'manual')
    throw invalid('', 'rule-based collections choose their products themselves');
  await tx.db
    .delete(schema.collectionProducts)
    .where(eq(schema.collectionProducts.collectionId, id));
  if (productIds.length) {
    await catalogWrite(() =>
      tx.db
        .insert(schema.collectionProducts)
        .values(
          productIds.map((productId, position) => ({ collectionId: id, productId, position })),
        ),
    );
  }
  await tx.db.update(c).set({ updatedAt: sql`now()` }).where(eq(c.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'collection.products_set',
    entityType: 'collection',
    entityId: id,
    after: { products: productIds.length },
  });
  await emit(tx, 'catalog.collection.changed', {
    aggregateType: 'collection',
    aggregateId: id,
    payload: { change: 'updated' },
  });
  return getCollection(tx, actor, id);
}

export type CollectionProduct = {
  id: string;
  status: string;
  titles: Translated<string>;
  minPrice: number | null;
};

/**
 * A collection's products in its order: for rules, what they match right now
 * (the editor's live preview, and Phase 3's listing). Rules can be passed in
 * to preview them before saving.
 */
export async function collectionProducts(
  tx: TenantTx,
  actor: Actor,
  id: string,
  options: { rules?: unknown; limit?: number; offset?: number; activeOnly?: boolean } = {},
): Promise<{ items: CollectionProduct[]; total: number }> {
  authorize(actor, 'catalog.read');
  const collection = await getCollection(tx, actor, id);
  const rules = options.rules !== undefined ? parseInput(collectionRules, options.rules) : null;
  const match = rules ? rulesSql(rules) : await collectionMatch(tx, id);
  const sort = rules ? 'newest' : collection.sort;
  const order =
    {
      manual: sql`(select cp.position from store.collection_products cp where cp.product_id = p.id and cp.collection_id = ${id})`,
      newest: sql`p.created_at desc`,
      price_asc: sql`"minPrice" asc nulls last`,
      price_desc: sql`"minPrice" desc nulls last`,
      title_asc: sql`(select min(t.title) from store.product_translations t where t.product_id = p.id)`,
    }[sort] ?? sql`p.created_at desc`;
  const status = options.activeOnly ? sql`p.status = 'active'` : sql`p.status <> 'archived'`;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const { rows } = await tx.db.execute<CollectionProduct & { total: number }>(sql`
    select p.id, p.status,
      coalesce((select json_object_agg(t.locale, t.title) from store.product_translations t
                 where t.product_id = p.id), '{}'::json) as titles,
      (select min(price) from store.variants v where v.product_id = p.id and v.archived_at is null) as "minPrice",
      count(*) over ()::int as total
    from store.products p
    where ${status} and ${match}
    order by ${order}, p.id
    limit ${limit} offset ${Math.max(options.offset ?? 0, 0)}`);
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map(({ total: _total, ...row }) => ({
      ...row,
      minPrice: row.minPrice === null ? null : Number(row.minPrice),
    })),
  };
}
