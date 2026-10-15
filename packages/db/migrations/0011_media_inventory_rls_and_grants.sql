-- Hand-written (ADR 0009, phase-2-plan §3.6–§3.8): FORCE ROW LEVEL SECURITY,
-- grants and triggers for media, inventory and import tables, and the
-- default stock location in every store's defaults.

ALTER TABLE store.media FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.media_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.product_media FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.stock_locations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.inventory_levels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.stock_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.import_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.import_errors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.import_images FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.media, store.media_translations, store.product_media, store.stock_locations, store.inventory_levels, store.import_jobs, store.import_errors, store.import_images TO app_rw;
--> statement-breakpoint
-- The stock ledger is append-only for the app, like the audit log (§3.8).
GRANT SELECT, INSERT ON store.stock_movements TO app_rw;
--> statement-breakpoint
CREATE TRIGGER stock_locations_set_updated_at BEFORE UPDATE ON store.stock_locations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER inventory_levels_set_updated_at BEFORE UPDATE ON store.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER import_jobs_set_updated_at BEFORE UPDATE ON store.import_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER import_images_set_updated_at BEFORE UPDATE ON store.import_images
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
-- Every store's defaults, now with one default stock location named in the
-- store's language. Idempotent, like before.
CREATE OR REPLACE FUNCTION app.create_store_defaults() RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  tenant uuid := app.current_tenant_id();
  brand_id uuid;
BEGIN
  IF tenant IS NULL THEN
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
  INSERT INTO store.stock_locations (name, is_default)
  SELECT CASE WHEN t.default_locale = 'bn' THEN 'প্রধান স্টক' ELSE 'Main stock' END, true
    FROM platform.tenants t WHERE t.id = tenant
  ON CONFLICT (tenant_id) WHERE is_default DO NOTHING;
END
$$;
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
