-- Hand-written (ADR 0009, phase-6-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for the Phase 6 tables, the references drizzle-kit
-- can't express, and the daily cleanup of incomplete orders.

ALTER TABLE store.incomplete_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.order_confirmations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A shopper's "Don't save" and anonymization delete incomplete orders; the
-- daily cleanup deletes the rest. Confirmations live as long as their order.
GRANT SELECT, INSERT, UPDATE, DELETE ON store.incomplete_orders TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON store.order_confirmations TO app_rw;
--> statement-breakpoint

CREATE TRIGGER incomplete_orders_set_updated_at BEFORE UPDATE ON store.incomplete_orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER order_confirmations_set_updated_at BEFORE UPDATE ON store.order_confirmations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- A composite key's ON DELETE SET NULL would also null tenant_id; clear only
-- the reference (Postgres 15+). The cart goes after 30 days; its incomplete
-- order keeps its own copy of the lines. A purge deletes orders in batches,
-- so a duplicate's reference to an earlier order must not block it.
ALTER TABLE store.incomplete_orders DROP CONSTRAINT incomplete_orders_cart_fk,
  ADD CONSTRAINT incomplete_orders_cart_fk FOREIGN KEY (tenant_id, cart_id)
    REFERENCES store.carts (tenant_id, id) ON DELETE SET NULL (cart_id);
--> statement-breakpoint
ALTER TABLE store.orders DROP CONSTRAINT orders_duplicate_of_fk,
  ADD CONSTRAINT orders_duplicate_of_fk FOREIGN KEY (tenant_id, duplicate_of)
    REFERENCES store.orders (tenant_id, id) ON DELETE SET NULL (duplicate_of);
--> statement-breakpoint

-- Incomplete orders are kept the store's recovery.keepDays after their last
-- change, 30 at most (PLAN.md's retention table, phase-6-plan §3.2).
GRANT SELECT (id, settings) ON platform.tenants TO mm_system;
--> statement-breakpoint
GRANT SELECT, DELETE ON store.incomplete_orders TO mm_system;
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.incomplete_orders FOR ALL TO mm_system
  USING (updated_at < now() - interval '1 day');
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
  UPDATE store.orders SET ip = NULL, user_agent = NULL
   WHERE placed_at < now() - interval '90 days' AND (ip IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  name := 'order_ips'; deleted := n; RETURN NEXT;
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
