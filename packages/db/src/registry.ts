// What belongs to one tenant, for export and purge (Phase 5B). The purge job
// reads these lists and nothing else; registry.test.ts fails CI when a table
// is missing or the order would break a foreign key.

/**
 * Every table in the `store` schema, in purge order: each table comes before
 * the tables it references, so deleting in this order never hits a foreign key.
 */
export const STORE_TABLES = [
  // Imports and inventory
  'import_images',
  'import_errors',
  'import_jobs',
  'stock_movements',
  'inventory_levels',
  // Storefront content
  'page_translations',
  'pages',
  'theme_media',
  // Catalog: attributes and tags
  'product_attribute_translations',
  'product_attributes',
  'category_attributes',
  'attribute_value_translations',
  'attribute_values',
  'attribute_translations',
  'attributes',
  'product_tags',
  // Catalog: categories, collections, redirects
  'slug_redirects',
  'collection_products',
  'collection_translations',
  'collections',
  'product_categories',
  'category_translations',
  'categories',
  // Catalog: products, options and variants
  'variant_option_values',
  'variants',
  'product_option_value_translations',
  'product_option_values',
  'product_option_translations',
  'product_options',
  'product_translations',
  'product_media',
  'products',
  'media_translations',
  'media',
  'stock_locations',
  // Platform core
  'outbox',
  'audit_log',
  'idempotency_keys',
] as const;

/**
 * What a purge does with a store's rows in a platform table:
 * - `delete`: the rows are the store's own (memberships, custom domains);
 * - `clear`: the reference is set to null (a session's active store);
 * - `keep`: platform history, kept with the purged tenant record (PLAN.md).
 */
export type PurgeAction = 'delete' | 'clear' | 'keep';

/** Every platform table that references platform.tenants. */
export const PLATFORM_TENANT_ROWS: Record<string, PurgeAction> = {
  tenant_domain_history: 'delete',
  tenant_domains: 'delete',
  memberships: 'delete',
  invitations: 'delete',
  sessions: 'clear',
  support_grants: 'keep',
  audit_log: 'keep',
};
