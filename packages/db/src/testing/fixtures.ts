// One valid row per store table, used by the isolation suite. `tenant` is
// either 'default' (taken from the transaction's tenant) or a quoted UUID.
// The catalog test fails if a store table has no fixture, so every new table
// joins the isolation suite. Fixtures run in this order, parents first; a
// child finds its parent in the transaction's own store, so inserting it for
// another tenant fails on the policy, not on a missing parent.

/** The first row of a table in the transaction's store. */
const first = (table: string, where = 'true') =>
  `(select id from store.${table} where tenant_id = app.current_tenant_id() and ${where} order by id limit 1)`; /** The attribute of that first attribute value. */
const valueAttribute = `(select attribute_id from store.attribute_values where id = ${first('attribute_values')})`;

export const FIXTURES: Record<string, (tenant: string) => string> = {
  outbox: (tenant) =>
    `insert into store.outbox (tenant_id, event_type, aggregate_type, payload)
     values (${tenant}, 'test.fixture', 'test', '{}')`,
  audit_log: (tenant) =>
    `insert into store.audit_log (tenant_id, actor_type, action)
     values (${tenant}, 'system', 'test.fixture')`,
  idempotency_keys: (tenant) =>
    `insert into store.idempotency_keys (tenant_id, scope, key, request_hash, locked_until)
     values (${tenant}, 'test.fixture', 'fixture-' || gen_random_uuid(), 'hash', now())`,
  products: (tenant) =>
    `insert into store.products (tenant_id, status) values (${tenant}, 'draft')`,
  product_translations: (tenant) =>
    `insert into store.product_translations (tenant_id, product_id, locale, title, slug)
     values (${tenant}, ${first('products')}, 'en', 'Fixture', 'fixture-' || gen_random_uuid())`,
  product_options: (tenant) =>
    `insert into store.product_options (tenant_id, product_id, position)
     values (${tenant}, ${first('products')}, 0)`,
  product_option_translations: (tenant) =>
    `insert into store.product_option_translations (tenant_id, option_id, locale, name, name_key)
     values (${tenant}, ${first('product_options')}, 'en', 'Size', 'size')`,
  product_option_values: (tenant) =>
    `insert into store.product_option_values (tenant_id, option_id, position)
     values (${tenant}, ${first('product_options')}, 0)`,
  product_option_value_translations: (tenant) =>
    `insert into store.product_option_value_translations (tenant_id, value_id, locale, label, label_key)
     values (${tenant}, ${first('product_option_values')}, 'en', 'M', 'm')`,
  variants: (tenant) =>
    `insert into store.variants (tenant_id, product_id, options_key, price)
     values (${tenant}, ${first('products')}, gen_random_uuid()::text, 100000)`,
  variant_option_values: (tenant) =>
    `insert into store.variant_option_values (tenant_id, variant_id, value_id)
     values (${tenant}, ${first('variants')}, ${first('product_option_values')})`,
  categories: (tenant) => `insert into store.categories (tenant_id) values (${tenant})`,
  category_translations: (tenant) =>
    `insert into store.category_translations (tenant_id, category_id, locale, name, slug)
     values (${tenant}, ${first('categories')}, 'en', 'Fixture', 'fixture-' || gen_random_uuid())`,
  product_categories: (tenant) =>
    `insert into store.product_categories (tenant_id, product_id, category_id)
     values (${tenant}, ${first('products')}, ${first('categories')})`,
  collections: (tenant) =>
    `insert into store.collections (tenant_id, kind) values (${tenant}, 'manual')`,
  collection_translations: (tenant) =>
    `insert into store.collection_translations (tenant_id, collection_id, locale, name, slug)
     values (${tenant}, ${first('collections')}, 'en', 'Fixture', 'fixture-' || gen_random_uuid())`,
  collection_products: (tenant) =>
    `insert into store.collection_products (tenant_id, collection_id, product_id)
     values (${tenant}, ${first('collections')}, ${first('products')})`,
  slug_redirects: (tenant) =>
    `insert into store.slug_redirects (tenant_id, entity_type, locale, from_slug, entity_id)
     values (${tenant}, 'product', 'en', 'old-' || gen_random_uuid(), ${first('products')})`,
  attributes: (tenant) =>
    `insert into store.attributes (tenant_id, key, type)
     values (${tenant}, 'fixture_' || substr(md5(random()::text), 1, 8), 'multi_choice')`,
  attribute_translations: (tenant) =>
    `insert into store.attribute_translations (tenant_id, attribute_id, locale, name)
     values (${tenant}, ${first('attributes', "key like 'fixture_%'")}, 'en', 'Fixture')`,
  attribute_values: (tenant) =>
    `insert into store.attribute_values (tenant_id, attribute_id)
     values (${tenant}, ${first('attributes', "key like 'fixture_%'")})`,
  attribute_value_translations: (tenant) =>
    `insert into store.attribute_value_translations (tenant_id, value_id, attribute_id, locale, label, label_key)
     values (${tenant}, ${first('attribute_values')}, ${valueAttribute}, 'en', 'Cotton', 'cotton-' || gen_random_uuid())`,
  category_attributes: (tenant) =>
    `insert into store.category_attributes (tenant_id, category_id, attribute_id)
     values (${tenant}, ${first('categories')}, ${first('attributes', "key like 'fixture_%'")})`,
  product_attributes: (tenant) =>
    `insert into store.product_attributes (tenant_id, product_id, attribute_id, attribute_type, value_id)
     values (${tenant}, ${first('products')}, ${valueAttribute}, 'multi_choice', ${first('attribute_values')})`,
  product_attribute_translations: (tenant) =>
    `insert into store.product_attribute_translations (tenant_id, product_attribute_id, locale, text)
     values (${tenant}, ${first('product_attributes')}, 'en', 'Fixture')`,
  product_tags: (tenant) =>
    `insert into store.product_tags (tenant_id, product_id, tag)
     values (${tenant}, ${first('products')}, 'fixture-' || gen_random_uuid())`,
};
