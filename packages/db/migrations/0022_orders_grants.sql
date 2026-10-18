-- Hand-written (ADR 0009, phase-4-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for the Phase 4 tables; foreign keys that clear
-- one column on delete; settled payments that never change; and the daily
-- cleanup of old carts, shopper sessions and order IP addresses.

ALTER TABLE store.delivery_zones FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.delivery_zone_areas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.carts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.cart_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.customers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.customer_addresses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.shopper_users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.shopper_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.shopper_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.shopper_verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.blocked_phones FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.order_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.order_adjustments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.order_line_adjustments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.order_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.order_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.shipments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.shipment_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.promotions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.promotion_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.promotion_customer_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON store.delivery_zones, store.delivery_zone_areas,
  store.carts, store.cart_lines, store.customer_addresses, store.shopper_users,
  store.shopper_sessions, store.shopper_accounts, store.shopper_verifications,
  store.blocked_phones, store.order_lines, store.shipments TO app_rw;
--> statement-breakpoint
-- Customers are soft-deleted; orders, payments and promotions are never deleted.
GRANT SELECT, INSERT, UPDATE ON store.customers, store.counters, store.orders, store.payments,
  store.promotions, store.promotion_codes, store.promotion_customer_usage TO app_rw;
--> statement-breakpoint
-- An edit replaces adjustments and their allocations; a pending shipment can be deleted.
GRANT SELECT, INSERT, DELETE ON store.order_adjustments, store.order_line_adjustments,
  store.shipment_lines TO app_rw;
--> statement-breakpoint
-- Append-only, like audit_log.
GRANT SELECT, INSERT ON store.order_history, store.order_notes TO app_rw;
--> statement-breakpoint

CREATE TRIGGER delivery_zones_set_updated_at BEFORE UPDATE ON store.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON store.carts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON store.customers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER customer_addresses_set_updated_at BEFORE UPDATE ON store.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON store.orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON store.shipments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON store.payments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER promotions_set_updated_at BEFORE UPDATE ON store.promotions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- A composite key's ON DELETE SET NULL would also null tenant_id; clear only
-- the reference (Postgres 15+). drizzle-kit can't express the column list.
ALTER TABLE store.carts DROP CONSTRAINT carts_shopper_fk,
  ADD CONSTRAINT carts_shopper_fk FOREIGN KEY (tenant_id, shopper_user_id)
    REFERENCES store.shopper_users (tenant_id, id) ON DELETE SET NULL (shopper_user_id);
--> statement-breakpoint
ALTER TABLE store.orders DROP CONSTRAINT orders_shopper_fk,
  ADD CONSTRAINT orders_shopper_fk FOREIGN KEY (tenant_id, shopper_user_id)
    REFERENCES store.shopper_users (tenant_id, id) ON DELETE SET NULL (shopper_user_id);
--> statement-breakpoint
ALTER TABLE store.orders DROP CONSTRAINT orders_zone_fk,
  ADD CONSTRAINT orders_zone_fk FOREIGN KEY (tenant_id, zone_id)
    REFERENCES store.delivery_zones (tenant_id, id) ON DELETE SET NULL (zone_id);
--> statement-breakpoint

-- Payments never change once settled, voided or failed (§3.8): Phase 5A's
-- refunds are new rows pointing back at them.
CREATE FUNCTION app.payments_settled_immutable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a % payment cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payments_settled_immutable BEFORE UPDATE ON store.payments
  FOR EACH ROW EXECUTE FUNCTION app.payments_settled_immutable();
--> statement-breakpoint

-- The daily cleanup (PLAN.md's cleanup table): carts untouched for 30 days,
-- converted carts after 7, expired shopper sessions and codes, and order IP
-- addresses and user agents after 90 days.
GRANT SELECT, DELETE ON store.carts, store.shopper_sessions, store.shopper_verifications TO mm_system;
--> statement-breakpoint
GRANT SELECT, UPDATE (ip, user_agent) ON store.orders TO mm_system;
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.carts FOR ALL TO mm_system USING (true);
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.shopper_sessions FOR ALL TO mm_system USING (expires_at < now());
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.shopper_verifications FOR ALL TO mm_system USING (expires_at < now());
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.orders FOR ALL TO mm_system
  USING (placed_at < now() - interval '90 days') WITH CHECK (ip IS NULL AND user_agent IS NULL);
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
END
$$;
--> statement-breakpoint
RESET ROLE;
