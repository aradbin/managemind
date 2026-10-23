-- Hand-written (phase-5a-plan §3.12): shoppers' return photos are kept 90
-- days after their return is resolved or rejected. A SECURITY DEFINER
-- function owned by mm_system, like the media cleanup: it deletes those
-- photo rows and returns the R2 keys no remaining photo uses, for the daily
-- job to delete. mm_system can read returns and delete photo rows, nothing else.
GRANT SELECT, DELETE ON store.return_photos TO mm_system;
--> statement-breakpoint
-- Only so the function can lock the rows it deletes.
GRANT UPDATE (bytes) ON store.return_photos TO mm_system;
--> statement-breakpoint
GRANT SELECT ON store.returns TO mm_system;
--> statement-breakpoint
CREATE POLICY system_photo_cleanup ON store.return_photos FOR ALL TO mm_system USING (true);
--> statement-breakpoint
CREATE POLICY system_photo_cleanup ON store.returns FOR SELECT TO mm_system USING (true);
--> statement-breakpoint
CREATE FUNCTION app.return_photo_cleanup(max_rows integer DEFAULT 500)
  RETURNS TABLE (object_key text)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH doomed AS (
    SELECT p.id FROM store.return_photos p
      JOIN store.returns r ON r.tenant_id = p.tenant_id AND r.id = p.return_id
     WHERE r.status IN ('resolved', 'rejected')
       AND coalesce(r.resolved_at, r.updated_at) < now() - interval '90 days'
     ORDER BY p.created_at
     LIMIT least(max_rows, 1000)
     FOR UPDATE OF p SKIP LOCKED
  ), deleted AS (
    DELETE FROM store.return_photos p USING doomed d WHERE p.id = d.id
    RETURNING p.object_key
  )
  SELECT DISTINCT d.object_key FROM deleted d
   WHERE NOT EXISTS (
     -- The same bytes sent for another return keep their file.
     SELECT 1 FROM store.return_photos keep
      WHERE keep.object_key = d.object_key AND keep.id NOT IN (SELECT id FROM doomed))
$$;
--> statement-breakpoint
ALTER FUNCTION app.return_photo_cleanup(integer) OWNER TO mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.return_photo_cleanup(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.return_photo_cleanup(integer) TO app_rw;
