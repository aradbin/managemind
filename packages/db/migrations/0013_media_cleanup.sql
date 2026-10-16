-- Hand-written (phase-2-plan §3.6): the weekly image cleanup across stores. A
-- SECURITY DEFINER function owned by mm_system, like the outbox sweep: it
-- deletes images that no product or variant has used for 7 days, and returns
-- the files no remaining image of the same store refers to, so the job can
-- delete them from R2. mm_system can read the tables it checks and delete
-- media rows, nothing else.
GRANT SELECT, DELETE ON store.media TO mm_system;
--> statement-breakpoint
-- Only so the function can lock the rows it deletes (FOR UPDATE needs an UPDATE grant).
GRANT UPDATE (unused_since) ON store.media TO mm_system;
--> statement-breakpoint
GRANT SELECT ON store.product_media, store.variants TO mm_system;
--> statement-breakpoint
CREATE POLICY system_media_cleanup ON store.media FOR ALL TO mm_system USING (true);
--> statement-breakpoint
CREATE POLICY system_media_cleanup ON store.product_media FOR SELECT TO mm_system USING (true);
--> statement-breakpoint
CREATE POLICY system_media_cleanup ON store.variants FOR SELECT TO mm_system USING (true);
--> statement-breakpoint
CREATE FUNCTION app.media_cleanup(max_rows integer DEFAULT 500)
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
ALTER FUNCTION app.media_cleanup(integer) OWNER TO mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.media_cleanup(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.media_cleanup(integer) TO app_rw;
