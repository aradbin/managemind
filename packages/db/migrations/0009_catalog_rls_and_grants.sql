-- Hand-written (ADR 0009, phase-2-plan §4): FORCE ROW LEVEL SECURITY,
-- grants and updated_at triggers for the catalog tables, the attribute
-- guard, and the per-store defaults (the built-in brand attribute).

ALTER TABLE store.attribute_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.attribute_value_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.attribute_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.attributes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.category_attributes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.category_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.collection_products FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.collection_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.collections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_attribute_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_attributes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_option_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_option_value_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_option_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_options FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.products FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.slug_redirects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.variant_option_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.variants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.attribute_translations, store.attribute_value_translations, store.attribute_values, store.attributes, store.categories, store.category_attributes, store.category_translations, store.collection_products, store.collection_translations, store.collections, store.product_attribute_translations, store.product_attributes, store.product_categories, store.product_option_translations, store.product_option_value_translations, store.product_option_values, store.product_options, store.product_tags, store.product_translations, store.products, store.slug_redirects, store.variant_option_values, store.variants TO app_rw;
--> statement-breakpoint
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON store.products
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_translations_set_updated_at BEFORE UPDATE ON store.product_translations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER variants_set_updated_at BEFORE UPDATE ON store.variants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON store.categories
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER category_translations_set_updated_at BEFORE UPDATE ON store.category_translations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER collections_set_updated_at BEFORE UPDATE ON store.collections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER collection_translations_set_updated_at BEFORE UPDATE ON store.collection_translations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attributes_set_updated_at BEFORE UPDATE ON store.attributes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
-- An attribute's key and type never change: import columns, feeds and every
-- product value depend on them. The built-in brand can't be deleted (§3.4),
-- except when the whole store is removed (a closed store's purge, Phase 5B).
CREATE FUNCTION app.attributes_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system AND NOT EXISTS (
      SELECT 1 FROM platform.tenants WHERE id = OLD.tenant_id AND status IN ('closed', 'purged')
    ) THEN
      RAISE EXCEPTION 'system attribute % cannot be deleted', OLD.key
        USING ERRCODE = 'check_violation', CONSTRAINT = 'attributes_system_kept';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.key <> OLD.key OR NEW.type <> OLD.type OR NEW.is_system <> OLD.is_system THEN
    RAISE EXCEPTION 'attribute key, type and system flag cannot change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'attributes_immutable';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER attributes_guard BEFORE UPDATE OR DELETE ON store.attributes
  FOR EACH ROW EXECUTE FUNCTION app.attributes_guard();
--> statement-breakpoint
-- What every store starts with. Runs with the caller's rights in the current
-- tenant transaction: createTenant calls it, the seed calls it, and the
-- backfill below calls it for stores that already exist. Idempotent.
CREATE FUNCTION app.create_store_defaults() RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  brand_id uuid;
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'create_store_defaults needs a tenant';
  END IF;
  INSERT INTO store.attributes (key, type, filterable, visible, is_system)
  VALUES ('brand', 'choice', true, true, true)
  ON CONFLICT (tenant_id, key) DO NOTHING
  RETURNING id INTO brand_id;
  IF brand_id IS NOT NULL THEN
    INSERT INTO store.attribute_translations (attribute_id, locale, name)
    VALUES (brand_id, 'bn', 'ব্র্যান্ড'), (brand_id, 'en', 'Brand');
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.create_store_defaults() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_store_defaults() TO app_rw;
--> statement-breakpoint
-- Stores created before this migration.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM platform.tenants WHERE status <> 'purged' LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true),
            set_config('app.tenant_at', now()::text, true);
    PERFORM app.create_store_defaults();
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true), set_config('app.tenant_at', '', true);
END
$$;
