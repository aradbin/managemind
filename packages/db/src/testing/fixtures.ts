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
  media: (tenant) =>
    `insert into store.media (tenant_id, sha256, mime, width, height, files)
     values (${tenant}, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'image/webp', 1200, 1200,
             '[{"width": 1200, "sha256": "0", "bytes": 1}]')`,
  media_translations: (tenant) =>
    `insert into store.media_translations (tenant_id, media_id, locale, alt)
     values (${tenant}, ${first('media')}, 'en', 'Fixture')`,
  product_media: (tenant) =>
    `insert into store.product_media (tenant_id, product_id, media_id, position)
     values (${tenant}, ${first('products')}, ${first('media')}, 0)`,
  pages: (tenant) => `insert into store.pages (tenant_id, kind) values (${tenant}, 'custom')`,
  page_translations: (tenant) =>
    `insert into store.page_translations (tenant_id, page_id, locale, title, slug)
     values (${tenant}, ${first('pages')}, 'en', 'Fixture', 'fixture-' || gen_random_uuid())`,
  theme_media: (tenant) =>
    `insert into store.theme_media (tenant_id, media_id) values (${tenant}, ${first('media')})`,
  stock_locations: (tenant) =>
    `insert into store.stock_locations (tenant_id, name) values (${tenant}, 'Fixture')`,
  inventory_levels: (tenant) =>
    // On hand 1: the stock_movements fixture below receives 1 here, so the invariant holds.
    `insert into store.inventory_levels (tenant_id, variant_id, location_id, on_hand)
     values (${tenant}, ${first('variants')}, ${first('stock_locations', "name = 'Fixture'")}, 1)`,
  stock_movements: (tenant) =>
    `insert into store.stock_movements (tenant_id, variant_id, location_id, type, quantity, reason, actor_type)
     values (${tenant}, ${first('variants')}, ${first('stock_locations', "name = 'Fixture'")}, 'receive', 1, 'fixture', 'system')`,
  import_jobs: (tenant) =>
    `insert into store.import_jobs (tenant_id, file_name, chunk_count) values (${tenant}, 'fixture.xlsx', 1)`,
  import_errors: (tenant) =>
    `insert into store.import_errors (tenant_id, job_id, row, field, code, message)
     values (${tenant}, ${first('import_jobs')}, 2, 'price', 'invalid', 'not a price')`,
  import_images: (tenant) =>
    `insert into store.import_images (tenant_id, job_id, row, product_id, url, position)
     values (${tenant}, ${first('import_jobs')}, 2, ${first('products')}, 'https://example.test/a.jpg', 0)`,
  // Phase 4: delivery, customers, shoppers, carts, promotions and orders.
  delivery_zones: (tenant) =>
    `insert into store.delivery_zones (tenant_id, name, fee) values (${tenant}, '{"en": "Fixture"}', 7000)`,
  delivery_zone_areas: (tenant) =>
    `insert into store.delivery_zone_areas (tenant_id, zone_id, district_id)
     values (${tenant}, ${first('delivery_zones', "name->>'en' = 'Fixture'")}, 1)`,
  customers: (tenant) =>
    `insert into store.customers (tenant_id, phone, name) values (${tenant}, '+8801700000001', 'Fixture')`,
  customer_addresses: (tenant) =>
    `insert into store.customer_addresses (tenant_id, customer_id, name, phone, division_id, district_id, area_id, line)
     values (${tenant}, ${first('customers')}, 'Fixture', '+8801700000001', 6, 47, (select id from ref.areas where code = 'dhaka.dhanmondi'), 'House 1')`,
  blocked_phones: (tenant) =>
    `insert into store.blocked_phones (tenant_id, phone, reason) values (${tenant}, '+8801700000009', 'fixture')`,
  shopper_users: (tenant) =>
    `insert into store.shopper_users (tenant_id, name, email) values (${tenant}, 'Fixture', 'fixture-' || gen_random_uuid() || '@example.test')`,
  shopper_sessions: (tenant) =>
    `insert into store.shopper_sessions (tenant_id, user_id, token, expires_at)
     values (${tenant}, ${first('shopper_users')}, gen_random_uuid()::text, now() + interval '1 day')`,
  shopper_accounts: (tenant) =>
    `insert into store.shopper_accounts (tenant_id, user_id, account_id, provider_id)
     values (${tenant}, ${first('shopper_users')}, gen_random_uuid()::text, 'email-otp')`,
  shopper_verifications: (tenant) =>
    `insert into store.shopper_verifications (tenant_id, identifier, value, expires_at)
     values (${tenant}, 'fixture', 'fixture', now() + interval '1 day')`,
  carts: (tenant) =>
    `insert into store.carts (tenant_id, token_hash) values (${tenant}, encode(sha256(gen_random_uuid()::text::bytea), 'hex'))`,
  cart_lines: (tenant) =>
    `insert into store.cart_lines (tenant_id, cart_id, variant_id, quantity)
     values (${tenant}, ${first('carts')}, ${first('variants')}, 1)`,
  counters: (tenant) =>
    `insert into store.counters (tenant_id, name, value) values (${tenant}, 'order_number', 1000)`,
  promotions: (tenant) =>
    `insert into store.promotions (tenant_id, title, kind, action)
     values (${tenant}, '{"en": "Fixture"}', 'code', '{"type": "percent_off_order", "percentBp": 1000}')`,
  promotion_codes: (tenant) =>
    `insert into store.promotion_codes (tenant_id, promotion_id, code)
     values (${tenant}, ${first('promotions')}, 'FX' || substr(md5(random()::text), 1, 8))`,
  promotion_customer_usage: (tenant) =>
    `insert into store.promotion_customer_usage (tenant_id, promotion_id, phone, count)
     values (${tenant}, ${first('promotions')}, '+8801700000001', 1)`,
  orders: (tenant) =>
    `insert into store.orders (tenant_id, number, source, customer_id, phone, contact, subtotal, total, locale)
     values (${tenant}, (select coalesce(max(number), 1000) + 1 from store.orders where tenant_id = app.current_tenant_id()),
             'website', ${first('customers')}, '+8801700000001', '{"name": "Fixture", "phone": "+8801700000001"}', 100000, 100000, 'en')`,
  order_lines: (tenant) =>
    `insert into store.order_lines (tenant_id, order_id, variant_id, product_id, title, unit_price, quantity, line_subtotal, line_total)
     values (${tenant}, ${first('orders')}, ${first('variants')}, (select product_id from store.variants where id = ${first('variants')}),
             '{"en": "Fixture"}', 100000, 1, 100000, 100000)`,
  order_adjustments: (tenant) =>
    `insert into store.order_adjustments (tenant_id, order_id, kind, target, title, amount)
     values (${tenant}, ${first('orders')}, 'manual', 'order', '{"en": "Fixture"}', 100)`,
  order_line_adjustments: (tenant) =>
    `insert into store.order_line_adjustments (tenant_id, order_line_id, adjustment_id, amount)
     values (${tenant}, ${first('order_lines')}, ${first('order_adjustments')}, 100)`,
  order_history: (tenant) =>
    `insert into store.order_history (tenant_id, order_id, machine, to_status, event, actor_type)
     values (${tenant}, ${first('orders')}, 'order', 'pending', 'place', 'system')`,
  order_notes: (tenant) =>
    `insert into store.order_notes (tenant_id, order_id, body) values (${tenant}, ${first('orders')}, 'Fixture')`,
  shipments: (tenant) =>
    `insert into store.shipments (tenant_id, order_id) values (${tenant}, ${first('orders')})`,
  shipment_lines: (tenant) =>
    `insert into store.shipment_lines (tenant_id, shipment_id, order_line_id, quantity)
     values (${tenant}, ${first('shipments')}, ${first('order_lines')}, 1)`,
  payments: (tenant) =>
    `insert into store.payments (tenant_id, order_id, provider, method, amount)
     values (${tenant}, ${first('orders')}, 'cod', 'cod', 100000)`,
};
