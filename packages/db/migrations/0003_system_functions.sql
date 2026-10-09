-- Hand-written (ADR 0009, ADR 0010): the few operations that must work across
-- tenants, as SECURITY DEFINER functions owned by mm_system. The app role can
-- call them but cannot become mm_system, and mm_system's policies allow only
-- what these functions do.

-- Ownership transfer needs SET on the new owner (Postgres 16+). On Neon the
-- migration role only gets ADMIN OPTION on roles it creates, so grant SET
-- explicitly; INHERIT FALSE keeps mm_system's privileges out of its sessions.
GRANT mm_system TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA app TO mm_system;
--> statement-breakpoint

GRANT SELECT, UPDATE, DELETE ON store.outbox TO mm_system;
--> statement-breakpoint
GRANT SELECT, DELETE ON store.idempotency_keys TO mm_system;
--> statement-breakpoint
CREATE POLICY system_dispatch ON store.outbox FOR ALL TO mm_system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.idempotency_keys FOR DELETE TO mm_system USING (expires_at < now());
--> statement-breakpoint
-- DELETE ... WHERE needs to read the rows it deletes.
CREATE POLICY system_cleanup_read ON store.idempotency_keys FOR SELECT TO mm_system USING (expires_at < now());
--> statement-breakpoint

-- Outbox events older than `min_age` that were never relayed (the daily sweep).
CREATE FUNCTION app.outbox_claim(batch_size integer DEFAULT 100, min_age interval DEFAULT interval '5 minutes')
  RETURNS SETOF store.outbox
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT * FROM store.outbox
   WHERE dispatched_at IS NULL AND created_at < now() - min_age
   ORDER BY created_at
   LIMIT least(batch_size, 1000)
   FOR UPDATE SKIP LOCKED
$$;
--> statement-breakpoint

-- Marks events as handed to the queue. Returns how many changed.
CREATE FUNCTION app.outbox_mark_dispatched(event_ids uuid[])
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE store.outbox SET dispatched_at = now(), attempts = attempts + 1
     WHERE id = ANY (event_ids) AND dispatched_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM done
$$;
--> statement-breakpoint

-- Records a failed relay attempt, so the sweep and alerts can see it.
CREATE FUNCTION app.outbox_mark_failed(event_id uuid, error text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE store.outbox SET attempts = attempts + 1, last_error = left(error, 1000)
   WHERE id = event_id AND dispatched_at IS NULL
$$;
--> statement-breakpoint

-- Daily cleanup of purely technical rows (PLAN.md retention table).
CREATE FUNCTION app.cleanup_expired()
  RETURNS TABLE (name text, deleted bigint)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM store.idempotency_keys WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'idempotency_keys'; deleted := n; RETURN NEXT;
  DELETE FROM store.outbox WHERE dispatched_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'outbox_dispatched'; deleted := n; RETURN NEXT;
END
$$;
--> statement-breakpoint

ALTER FUNCTION app.outbox_claim(integer, interval) OWNER TO mm_system;
--> statement-breakpoint
ALTER FUNCTION app.outbox_mark_dispatched(uuid[]) OWNER TO mm_system;
--> statement-breakpoint
ALTER FUNCTION app.outbox_mark_failed(uuid, text) OWNER TO mm_system;
--> statement-breakpoint
ALTER FUNCTION app.cleanup_expired() OWNER TO mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.outbox_claim(integer, interval), app.outbox_mark_dispatched(uuid[]),
  app.outbox_mark_failed(uuid, text), app.cleanup_expired() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.outbox_claim(integer, interval), app.outbox_mark_dispatched(uuid[]),
  app.outbox_mark_failed(uuid, text), app.cleanup_expired() TO app_rw;
