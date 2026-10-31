-- Hand-written (ADR 0009, phase-9-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for the Phase 9 tables.

ALTER TABLE store.feeds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.meta_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A feed's row is made the first time the store changes its catalog with the
-- feed on, and updated by each build. Events are logged once per order and
-- name; their status changes as the send is tried.
GRANT SELECT, INSERT, UPDATE, DELETE ON store.feeds TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.meta_events TO app_rw;
--> statement-breakpoint

CREATE TRIGGER feeds_set_updated_at BEFORE UPDATE ON store.feeds
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER meta_events_set_updated_at BEFORE UPDATE ON store.meta_events
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

--> statement-breakpoint

-- Ad attribution is kept 30 days (phase-9-plan §3.1.6), the shopper's IP and
-- browser 90 (Phase 4). The daily cleanup clears all three at 90 days first,
-- then attribution alone from 30, so every update leaves a row the policy allows.
GRANT UPDATE (attribution) ON store.orders TO mm_system;
--> statement-breakpoint
DROP POLICY system_cleanup ON store.orders;
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.orders FOR ALL TO mm_system
  USING (placed_at < now() - interval '30 days')
  WITH CHECK (attribution IS NULL
    AND (placed_at >= now() - interval '90 days' OR (ip IS NULL AND user_agent IS NULL)));
--> statement-breakpoint
SET ROLE mm_system;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cleanup_expired()
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
  DELETE FROM platform.sessions WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'sessions'; deleted := n; RETURN NEXT;
  DELETE FROM platform.verifications WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'verifications'; deleted := n; RETURN NEXT;
  DELETE FROM platform.dev_emails WHERE created_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'dev_emails'; deleted := n; RETURN NEXT;
  UPDATE platform.invitations SET status = 'expired'
   WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'invitations_expired'; deleted := n; RETURN NEXT;
  DELETE FROM store.carts
   WHERE (status = 'active' AND updated_at < now() - interval '30 days')
      OR (status = 'converted' AND updated_at < now() - interval '7 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'carts'; deleted := n; RETURN NEXT;
  DELETE FROM store.shopper_sessions WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'shopper_sessions'; deleted := n; RETURN NEXT;
  DELETE FROM store.shopper_verifications WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'shopper_verifications'; deleted := n; RETURN NEXT;
  UPDATE store.orders SET ip = NULL, user_agent = NULL, attribution = NULL
   WHERE placed_at < now() - interval '90 days' AND (ip IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'order_ips'; deleted := n; RETURN NEXT;
  UPDATE store.orders SET attribution = NULL
   WHERE placed_at < now() - interval '30 days' AND attribution IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'order_attribution'; deleted := n; RETURN NEXT;
  DELETE FROM store.messages WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'messages'; deleted := n; RETURN NEXT;
  DELETE FROM store.incomplete_orders i
   USING platform.tenants t
   WHERE t.id = i.tenant_id
     AND i.updated_at < now() - make_interval(days => least(30, greatest(1,
           CASE WHEN jsonb_typeof(t.settings -> 'recovery' -> 'keepDays') = 'number'
                THEN (t.settings -> 'recovery' ->> 'keepDays')::numeric::int ELSE 30 END)));
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'incomplete_orders'; deleted := n; RETURN NEXT;
END
$$;
--> statement-breakpoint
RESET ROLE;
