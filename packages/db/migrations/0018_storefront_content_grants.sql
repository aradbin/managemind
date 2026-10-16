-- Hand-written (ADR 0009, phase-3-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for the content tables; the domain columns the app
-- may change and their history; theme images in the weekly image cleanup;
-- and price_min / price_max for products created before this migration.

ALTER TABLE store.pages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.page_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.theme_media FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.pages, store.page_translations, store.theme_media TO app_rw;
--> statement-breakpoint
CREATE TRIGGER pages_set_updated_at BEFORE UPDATE ON store.pages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER page_translations_set_updated_at BEFORE UPDATE ON store.page_translations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Custom domains (phase-3-plan §3.9): the state machine updates these; rows
-- are never deleted by the app (a removed domain keeps its row and history).
GRANT UPDATE (ssl_status, ownership_record, last_checked_at, check_attempts, failure_reason)
  ON platform.tenant_domains TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.tenant_domain_history TO app_rw;
--> statement-breakpoint

-- The weekly image cleanup keeps images a theme uses.
GRANT SELECT ON store.theme_media TO mm_system;
--> statement-breakpoint
CREATE POLICY system_media_cleanup ON store.theme_media FOR SELECT TO mm_system USING (true);
--> statement-breakpoint
-- The function belongs to mm_system (migration 0013), so it is replaced as mm_system.
SET ROLE mm_system;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.media_cleanup(max_rows integer DEFAULT 500)
  RETURNS TABLE (tenant_id uuid, sha256 text, mime text)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH doomed AS (
    SELECT m.id FROM store.media m
     WHERE m.unused_since < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM store.product_media pm
                        WHERE pm.tenant_id = m.tenant_id AND pm.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM store.variants v
                        WHERE v.tenant_id = m.tenant_id AND v.image_media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM store.theme_media tm
                        WHERE tm.tenant_id = m.tenant_id AND tm.media_id = m.id)
     ORDER BY m.unused_since
     LIMIT least(max_rows, 1000)
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM store.media m USING doomed d WHERE m.id = d.id
    RETURNING m.tenant_id, m.mime, m.files
  )
  SELECT DISTINCT d.tenant_id, f.value ->> 'sha256', d.mime
    FROM deleted d CROSS JOIN LATERAL jsonb_array_elements(d.files) f
   WHERE NOT EXISTS (
     -- Every part of the statement sees the same snapshot, so the rows being
     -- deleted are still visible here: leave them out explicitly.
     SELECT 1 FROM store.media keep
      WHERE keep.tenant_id = d.tenant_id
        AND keep.id NOT IN (SELECT id FROM doomed)
        AND keep.files @> jsonb_build_array(jsonb_build_object('sha256', f.value ->> 'sha256')))
$$;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint

-- Products created before this migration: their live variants' price range.
-- updated_at is left alone (the trigger is off for the backfill).
ALTER TABLE store.products DISABLE TRIGGER products_set_updated_at;
--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM platform.tenants WHERE status <> 'purged' LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true),
            set_config('app.tenant_at', now()::text, true);
    UPDATE store.products p SET price_min = r.lo, price_max = r.hi
      FROM (SELECT product_id, min(price) AS lo, max(price) AS hi FROM store.variants
             WHERE tenant_id = t.id AND archived_at IS NULL GROUP BY product_id) r
     WHERE p.tenant_id = t.id AND r.product_id = p.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true), set_config('app.tenant_at', '', true);
END
$$;
--> statement-breakpoint
ALTER TABLE store.products ENABLE TRIGGER products_set_updated_at;
