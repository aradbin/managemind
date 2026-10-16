// Attributes, brand and tags (phase-2-plan §3.4, ADR 0017). Attributes are
// defined per store; choice values once per attribute; product values are
// typed rows the database checks again. Tags are free staff labels.
import { schema } from '@managemind/db';
import { AppError, uuidv7 } from '@managemind/shared';
import {
  type ATTRIBUTE_TYPES,
  attributeCreate,
  attributePatch,
  attributeValues,
  BRAND_ATTRIBUTE_KEY,
  CATALOG_LIMITS,
  normalizeKey,
  type ProductAttributeInput,
} from '@managemind/shared/catalog';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import {
  catalogWrite,
  invalid,
  type Locale,
  parseInput,
  pgError,
  requireDefault,
  storeCatalogContext,
  type Translated,
} from './common';

const a = schema.attributes;
const at = schema.attributeTranslations;
const av = schema.attributeValues;
const avt = schema.attributeValueTranslations;
const pa = schema.productAttributes;

export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export type Attribute = {
  id: string;
  key: string;
  type: AttributeType;
  filterable: boolean;
  visible: boolean;
  isSystem: boolean;
  position: number;
  name: Translated<string>;
  unit: Translated<string>;
  values: { id: string; position: number; label: Translated<string> }[];
  /** Products that have a value for it. */
  productCount: number;
};

const attributeSql = (where = sql`true`) => sql`
  select a.id, a.key, a.type, a.filterable, a.visible, a.is_system as "isSystem", a.position,
    coalesce((select json_object_agg(t.locale, t.name) from store.attribute_translations t
               where t.attribute_id = a.id), '{}'::json) as name,
    coalesce((select json_object_agg(t.locale, t.unit) from store.attribute_translations t
               where t.attribute_id = a.id and t.unit is not null), '{}'::json) as unit,
    coalesce((select json_agg(json_build_object('id', v.id, 'position', v.position,
               'label', coalesce((select json_object_agg(vt.locale, vt.label)
                 from store.attribute_value_translations vt where vt.value_id = v.id), '{}'::json))
               order by v.position, v.id)
               from store.attribute_values v where v.attribute_id = a.id), '[]'::json) as values,
    (select count(distinct pa.product_id)::int from store.product_attributes pa
      where pa.attribute_id = a.id) as "productCount"
  from store.attributes a where ${where}
  order by a.position, a.key`;

/** Every attribute of the store with its values, the brand first. */
export async function listAttributes(tx: TenantTx, actor: Actor): Promise<Attribute[]> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<Attribute>(attributeSql());
  return rows;
}

export async function getAttribute(tx: TenantTx, actor: Actor, id: string): Promise<Attribute> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<Attribute>(attributeSql(sql`a.id = ${id}`));
  if (!rows[0]) throw new AppError('not_found');
  return rows[0];
}

async function writeAttributeTranslations(
  tx: TenantTx,
  attributeId: string,
  translations: Translated<{ name: string; unit?: string | null | undefined } | null>,
  locale: Locale,
): Promise<void> {
  for (const [lang, t] of Object.entries(translations) as [
    Locale,
    (typeof translations)[Locale],
  ][]) {
    if (t === undefined) continue;
    if (t === null) {
      if (lang === locale)
        throw invalid(
          `translations.${lang}`,
          'the store’s default language is required',
          'required',
        );
      await tx.db.delete(at).where(and(eq(at.attributeId, attributeId), eq(at.locale, lang)));
      continue;
    }
    const values = { attributeId, locale: lang, name: t.name, unit: t.unit ?? null };
    await tx.db
      .insert(at)
      .values(values)
      .onConflictDoUpdate({ target: [at.tenantId, at.attributeId, at.locale], set: values });
  }
}

export async function createAttribute(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<Attribute> {
  authorize(actor, 'catalog.write');
  const data = parseInput(attributeCreate, input);
  const { defaultLocale } = await storeCatalogContext(tx);
  requireDefault(data.translations, defaultLocale);
  const { rows } = await tx.db.execute<{ n: number; position: number }>(
    sql`select count(*)::int as n, coalesce(max(position) + 1, 0)::int as position from store.attributes`,
  );
  if ((rows[0]?.n ?? 0) >= CATALOG_LIMITS.attributesPerStore) {
    throw new AppError('limit_exceeded', {
      detail: `At most ${CATALOG_LIMITS.attributesPerStore} attributes`,
    });
  }
  const id = uuidv7();
  try {
    await tx.db.insert(a).values({
      id,
      key: data.key,
      type: data.type,
      filterable: data.filterable,
      visible: data.visible,
      position: rows[0]?.position ?? 0,
    });
  } catch (e) {
    if (pgError(e).constraint === 'attributes_key_unique') {
      throw new AppError('conflict', {
        fields: [{ path: 'key', code: 'taken', message: 'another attribute has this key' }],
      });
    }
    throw e;
  }
  await writeAttributeTranslations(tx, id, data.translations, defaultLocale);
  const created = await getAttribute(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'attribute.created',
    entityType: 'attribute',
    entityId: id,
    after: { key: data.key, type: data.type, name: created.name },
  });
  await emit(tx, 'catalog.attribute.changed', {
    aggregateType: 'attribute',
    aggregateId: id,
    payload: { change: 'created' },
  });
  return created;
}

/** Renames, re-flags or moves an attribute. Key and type never change. */
export async function updateAttribute(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Attribute> {
  authorize(actor, 'catalog.write');
  const patch = parseInput(attributePatch, input);
  const before = await getAttribute(tx, actor, id);
  const { defaultLocale } = await storeCatalogContext(tx);
  if (patch.filterable && before.type === 'text') {
    throw invalid('filterable', 'text attributes cannot be filters');
  }
  if (patch.translations)
    await writeAttributeTranslations(tx, id, patch.translations, defaultLocale);
  const columns = {
    ...(patch.filterable !== undefined ? { filterable: patch.filterable } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
  };
  await tx.db
    .update(a)
    .set({ ...columns, updatedAt: sql`now()` })
    .where(eq(a.id, id));
  const after = await getAttribute(tx, actor, id);
  const { values: _bv, productCount: _bc, ...b } = before;
  const { values: _av, productCount: _ac, ...c } = after;
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'attribute.updated',
    entityType: 'attribute',
    entityId: id,
    before: b,
    after: c,
  });
  await emit(tx, 'catalog.attribute.changed', {
    aggregateType: 'attribute',
    aggregateId: id,
    payload: { change: 'updated' },
  });
  return after;
}

/**
 * Deletes an attribute and its values from every product. The admin first
 * shows `productCount` and asks; the brand can never be deleted.
 */
export async function deleteAttribute(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<{ removedFrom: number }> {
  authorize(actor, 'catalog.write');
  const before = await getAttribute(tx, actor, id);
  if (before.isSystem)
    throw new AppError('in_use', { detail: 'The brand attribute can be hidden, not deleted' });
  await tx.db.delete(pa).where(eq(pa.attributeId, id));
  await tx.db.delete(a).where(eq(a.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'attribute.deleted',
    entityType: 'attribute',
    entityId: id,
    before: {
      key: before.key,
      type: before.type,
      name: before.name,
      products: before.productCount,
    },
  });
  await emit(tx, 'catalog.attribute.changed', {
    aggregateType: 'attribute',
    aggregateId: id,
    payload: { change: 'deleted' },
  });
  return { removedFrom: before.productCount };
}

/**
 * Replaces a choice attribute's values: new ones are added, existing ones
 * renamed and reordered. A value still used by a product can't be removed.
 */
export async function setAttributeValues(
  tx: TenantTx,
  actor: Actor,
  attributeId: string,
  input: unknown,
): Promise<Attribute> {
  authorize(actor, 'catalog.write');
  const list = parseInput(attributeValues, input);
  const before = await getAttribute(tx, actor, attributeId);
  if (before.type !== 'choice' && before.type !== 'multi_choice') {
    throw invalid('', 'only choice attributes have values');
  }
  const { defaultLocale } = await storeCatalogContext(tx);
  for (const [i, value] of list.entries()) requireDefault(value.label, defaultLocale, `${i}.label`);
  const existing = new Set(before.values.map((x) => x.id));
  for (const [i, value] of list.entries()) {
    if (value.id && !existing.has(value.id))
      throw invalid(`${i}.id`, 'not a value of this attribute');
  }
  const ids = list.map((value) => value.id ?? uuidv7());
  const removed = [...existing].filter((id) => !ids.includes(id));
  if (removed.length) {
    const used = await tx.db
      .select({ id: pa.valueId })
      .from(pa)
      .where(inArray(pa.valueId, removed))
      .limit(1);
    if (used.length)
      throw new AppError('in_use', { detail: 'A value used by products can’t be removed' });
    await tx.db.delete(av).where(inArray(av.id, removed));
  }
  // Labels are unique per attribute, so clear them before writing the new set.
  if (ids.length) await tx.db.delete(avt).where(inArray(avt.valueId, ids));
  for (const [i, id] of ids.entries()) {
    if (existing.has(id)) await tx.db.update(av).set({ position: i }).where(eq(av.id, id));
    else await tx.db.insert(av).values({ id, attributeId, position: i });
  }
  const labels = list.flatMap((value, i) =>
    Object.entries(value.label).map(([locale, label]) => ({
      valueId: ids[i] as string,
      attributeId,
      locale: locale as Locale,
      label: label as string,
      labelKey: normalizeKey(label as string),
    })),
  );
  if (labels.length) await catalogWrite(() => tx.db.insert(avt).values(labels));
  const after = await getAttribute(tx, actor, attributeId);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'attribute.values_changed',
    entityType: 'attribute',
    entityId: attributeId,
    before: before.values,
    after: after.values,
  });
  await emit(tx, 'catalog.attribute.changed', {
    aggregateType: 'attribute',
    aggregateId: attributeId,
    payload: { change: 'updated' },
  });
  return after;
}

/**
 * Finds or creates a choice value by its label in `locale` (the import's
 * "an unknown choice value is created with the row's label").
 */
export async function ensureAttributeValue(
  tx: TenantTx,
  attributeId: string,
  locale: Locale,
  label: string,
): Promise<string> {
  const key = normalizeKey(label);
  const { rows } = await tx.db.execute<{ value_id: string }>(
    sql`select value_id from store.attribute_value_translations
         where attribute_id = ${attributeId} and label_key = ${key} order by locale = ${locale} desc limit 1`,
  );
  if (rows[0]) return rows[0].value_id;
  const { rows: count } = await tx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from store.attribute_values where attribute_id = ${attributeId}`,
  );
  if ((count[0]?.n ?? 0) >= CATALOG_LIMITS.valuesPerAttribute) {
    throw new AppError('limit_exceeded', {
      detail: `At most ${CATALOG_LIMITS.valuesPerAttribute} values`,
    });
  }
  const id = uuidv7();
  await tx.db.insert(av).values({ id, attributeId, position: count[0]?.n ?? 0 });
  await tx.db.insert(avt).values({ valueId: id, attributeId, locale, label, labelKey: key });
  return id;
}

// ---- Product values and tags -----------------------------------------------------

/**
 * Replaces the listed attributes' values on a product. An input with no value
 * (no choices, a null number, empty texts) removes the attribute from it.
 */
export async function replaceProductAttributes(
  tx: TenantTx,
  productId: string,
  inputs: ProductAttributeInput[],
  locale: Locale,
): Promise<void> {
  const ids = [...new Set(inputs.map((i) => i.attributeId))];
  if (ids.length !== inputs.length) throw invalid('attributes', 'each attribute once');
  if (!ids.length) return;
  const types = new Map(
    (await tx.db.select({ id: a.id, type: a.type }).from(a).where(inArray(a.id, ids))).map((r) => [
      r.id,
      r.type,
    ]),
  );
  inputs.forEach((input, i) => {
    const type = types.get(input.attributeId);
    if (!type) throw invalid(`attributes.${i}.attributeId`, 'unknown attribute', 'not_found');
    if (type !== input.type) throw invalid(`attributes.${i}.type`, `this attribute is ${type}`);
  });
  await tx.db.delete(pa).where(and(eq(pa.productId, productId), inArray(pa.attributeId, ids)));

  const rows: (typeof pa.$inferInsert)[] = [];
  const texts: { id: string; text: Translated<string | null | undefined> }[] = [];
  for (const input of inputs) {
    const base = { productId, attributeId: input.attributeId, attributeType: input.type };
    switch (input.type) {
      case 'choice':
      case 'multi_choice':
        for (const valueId of new Set(input.valueIds)) rows.push({ ...base, valueId });
        break;
      case 'number':
        if (input.number !== null) rows.push({ ...base, numberValue: input.number });
        break;
      case 'boolean':
        if (input.value !== null) rows.push({ ...base, booleanValue: input.value });
        break;
      case 'text': {
        const present = Object.values(input.text).some(Boolean);
        if (!present) break;
        if (!input.text[locale]) {
          throw invalid('attributes', 'text values need the store’s default language', 'required');
        }
        const id = uuidv7();
        rows.push({ ...base, id });
        texts.push({ id, text: input.text });
        break;
      }
    }
  }
  if (rows.length) await catalogWrite(() => tx.db.insert(pa).values(rows));
  const translations = texts.flatMap(({ id, text }) =>
    Object.entries(text)
      .filter(([, value]) => value)
      .map(([lang, value]) => ({
        productAttributeId: id,
        locale: lang as Locale,
        text: value as string,
      })),
  );
  if (translations.length)
    await tx.db.insert(schema.productAttributeTranslations).values(translations);
}

/** Replaces a product's tags (already normalized by the shared schema). */
export async function replaceProductTags(
  tx: TenantTx,
  productId: string,
  tags: string[],
): Promise<void> {
  const tg = schema.productTags;
  await tx.db.delete(tg).where(eq(tg.productId, productId));
  const unique = [...new Set(tags)].slice(0, CATALOG_LIMITS.tagsPerProduct);
  if (unique.length) await tx.db.insert(tg).values(unique.map((tag) => ({ productId, tag })));
}

/** The store's tags starting with `prefix`, most used first: the editor's suggestions. */
export async function suggestTags(
  tx: TenantTx,
  actor: Actor,
  prefix: string,
  limit = 20,
): Promise<{ tag: string; count: number }[]> {
  authorize(actor, 'catalog.read');
  const key = normalizeKey(prefix).replace(/[\\%_]/g, (c) => `\\${c}`);
  const { rows } = await tx.db.execute<{ tag: string; count: number }>(sql`
    select tag, count(*)::int as count from store.product_tags
     where tag like ${`${key}%`}
     group by tag order by count(*) desc, tag limit ${Math.min(Math.max(limit, 1), 50)}`);
  return rows;
}

/**
 * The store's option names and values starting with `prefix`, in one
 * language, most used first, so labels stay consistent across products.
 */
export async function suggestOptions(
  tx: TenantTx,
  actor: Actor,
  query: {
    locale: Locale;
    prefix?: string | undefined;
    name?: string | undefined;
    limit?: number | undefined;
  },
): Promise<{
  names: { name: string; count: number }[];
  values: { label: string; count: number }[];
}> {
  authorize(actor, 'catalog.read');
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
  const like = `${normalizeKey(query.prefix ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const names = await tx.db.execute<{ name: string; count: number }>(sql`
    select min(name) as name, count(*)::int as count from store.product_option_translations
     where locale = ${query.locale} and name_key like ${like}
     group by name_key order by count(*) desc, name_key limit ${limit}`);
  const values = query.name
    ? await tx.db.execute<{ label: string; count: number }>(sql`
        select min(vt.label) as label, count(*)::int as count
          from store.product_option_value_translations vt
          join store.product_option_values ov on ov.id = vt.value_id
          join store.product_option_translations ot on ot.option_id = ov.option_id and ot.locale = vt.locale
         where vt.locale = ${query.locale} and ot.name_key = ${normalizeKey(query.name)} and vt.label_key like ${like}
         group by vt.label_key order by count(*) desc, vt.label_key limit ${limit}`)
    : { rows: [] };
  return { names: names.rows, values: values.rows };
}

/** The built-in brand attribute's ID. */
export async function brandAttributeId(tx: TenantTx): Promise<string> {
  const [row] = await tx.db.select({ id: a.id }).from(a).where(eq(a.key, BRAND_ATTRIBUTE_KEY));
  if (!row) throw new AppError('internal', { detail: 'the store has no brand attribute' });
  return row.id;
}
