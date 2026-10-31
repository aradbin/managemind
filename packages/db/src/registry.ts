// What belongs to one tenant, for export and purge (Phase 5B). The purge job
// reads these lists and nothing else; registry.test.ts fails CI when a table
// is missing or the order would break a foreign key.

/**
 * Every table in the `store` schema, in purge order: each table comes before
 * the tables it references, so deleting in this order never hits a foreign key.
 */
export const STORE_TABLES = [
  // Messages, credentials, returns and refunds (Phase 5A)
  'messages',
  'message_templates',
  'push_subscriptions',
  'staff_alert_preferences',
  'provider_credentials',
  'refund_lines',
  'refunds',
  'return_photos',
  'return_lines',
  'returns',
  // Sales recovery (Phase 6)
  'incomplete_orders',
  'order_confirmations',
  // Sales channels (Phase 9)
  'whatsapp_templates',
  'whatsapp_contacts',
  'meta_events',
  'feeds',
  // Couriers (Phase 7)
  'courier_payout_lines',
  'courier_payouts',
  'shipment_events',
  // Back office (Phase 8): summaries, counts, expenses, purchasing, costs
  'daily_product_sales',
  'daily_sales',
  'monthly_stock_values',
  'stock_count_lines',
  'stock_counts',
  'expenses',
  'recurring_expenses',
  'expense_categories',
  'supplier_payments',
  'goods_receipt_lines',
  'goods_receipts',
  'purchase_order_lines',
  'purchase_orders',
  'suppliers',
  'cost_changes',
  // Orders, payments and shipments (Phase 4)
  'payments',
  'shipment_lines',
  'shipments',
  'order_notes',
  'order_history',
  'order_line_adjustments',
  'order_adjustments',
  'order_lines',
  'orders',
  'counters',
  // Carts, promotions, customers and delivery zones
  'cart_lines',
  'carts',
  'promotion_customer_usage',
  'promotion_codes',
  'promotions',
  'customer_addresses',
  'customers',
  'blocked_phones',
  'delivery_zone_areas',
  'delivery_zones',
  // Shopper accounts
  'shopper_addresses',
  'shopper_sessions',
  'shopper_accounts',
  'shopper_verifications',
  'shopper_users',
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
  // Phase 5B (phase-5b-plan §3.11): billing history, usage, terms and the
  // purge's own record stay with the purged tenant; its health goes.
  subscriptions: 'keep',
  usage_daily: 'keep',
  store_health: 'delete',
  invoices: 'keep',
  billing_payments: 'keep',
  terms_acceptances: 'keep',
  tenant_jobs: 'keep',
  tenant_purges: 'keep',
};
