-- Hand-written (phase-4-plan §3.3, Q6): every store starts with three
-- delivery zones, which it can change: inside Dhaka (the metropolitan
-- thanas) ৳70, Dhaka's suburbs (Savar, Keraniganj, Gazipur Sadar, which
-- includes Tongi, and Narayanganj Sadar) ৳100, and everywhere else ৳130,
-- each with the first kilogram included and ৳20 for every kilogram after.
-- Added only to a store that has no zones yet, so this stays idempotent.
CREATE OR REPLACE FUNCTION app.create_store_defaults() RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  tenant uuid := app.current_tenant_id();
  brand_id uuid;
  zone_id uuid;
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

  IF NOT EXISTS (SELECT 1 FROM store.delivery_zones WHERE tenant_id = tenant) THEN
    INSERT INTO store.delivery_zones (name, fee, free_weight_grams, fee_per_extra_kg, estimate, position)
    VALUES ('{"bn": "ঢাকার ভেতরে", "en": "Inside Dhaka"}', 7000, 1000, 2000,
            '{"bn": "১–২ দিন", "en": "1–2 days"}', 0)
    RETURNING id INTO zone_id;
    INSERT INTO store.delivery_zone_areas (zone_id, area_id)
    SELECT zone_id, a.id FROM ref.areas a
      JOIN ref.districts d ON d.id = a.district_id
     WHERE d.code = 'dhaka' AND a.kind = 'thana' AND a.active;

    INSERT INTO store.delivery_zones (name, fee, free_weight_grams, fee_per_extra_kg, estimate, position)
    VALUES ('{"bn": "ঢাকার আশেপাশে", "en": "Dhaka suburbs"}', 10000, 1000, 2000,
            '{"bn": "২–৩ দিন", "en": "2–3 days"}', 1)
    RETURNING id INTO zone_id;
    INSERT INTO store.delivery_zone_areas (zone_id, area_id)
    SELECT zone_id, a.id FROM ref.areas a
     WHERE a.code IN ('dhaka.savar', 'dhaka.keraniganj', 'gazipur.gazipur-sadar',
                      'narayanganj.narayanganj-sadar');

    INSERT INTO store.delivery_zones (name, fee, free_weight_grams, fee_per_extra_kg, estimate, is_fallback, position)
    VALUES ('{"bn": "ঢাকার বাইরে", "en": "Outside Dhaka"}', 13000, 1000, 2000,
            '{"bn": "৩–৫ দিন", "en": "3–5 days"}', true, 2);
  END IF;
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
