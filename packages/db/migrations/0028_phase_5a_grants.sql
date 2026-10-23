-- Hand-written (ADR 0009, phase-5a-plan §4): FORCE ROW LEVEL SECURITY,
-- grants and updated_at triggers for the Phase 5A tables; an expired online
-- payment that still settles (a late payment, §3.5); and the delivery log's
-- 90-day cleanup.

ALTER TABLE store.provider_credentials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.message_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.push_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.staff_alert_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.returns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.return_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.return_photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.refunds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.refund_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON store.provider_credentials, store.message_templates,
  store.push_subscriptions, store.staff_alert_preferences TO app_rw;
--> statement-breakpoint
-- Returns, refunds and the delivery log are never deleted by the app; the
-- log is cleaned up after 90 days by app.cleanup_expired.
GRANT SELECT, INSERT, UPDATE ON store.returns, store.return_lines, store.refunds,
  store.messages TO app_rw;
--> statement-breakpoint
-- Staff can remove a photo a shopper attached; refund lines never change.
GRANT SELECT, INSERT, DELETE ON store.return_photos TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON store.refund_lines TO app_rw;
--> statement-breakpoint

CREATE TRIGGER provider_credentials_set_updated_at BEFORE UPDATE ON store.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER messages_set_updated_at BEFORE UPDATE ON store.messages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER message_templates_set_updated_at BEFORE UPDATE ON store.message_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER returns_set_updated_at BEFORE UPDATE ON store.returns
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON store.refunds
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- A payment never changes once settled, voided or failed. An expired online
-- payment may still settle: the gateway reported the money after the order
-- was cancelled (phase-5a-plan §3.5).
CREATE OR REPLACE FUNCTION app.payments_settled_immutable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'expired' AND NEW.status = 'paid' THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a payment that is % cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- The delivery log is kept 90 days (PLAN.md's retention table).
GRANT SELECT, DELETE ON store.messages TO mm_system;
--> statement-breakpoint
CREATE POLICY system_cleanup ON store.messages FOR ALL TO mm_system
  USING (created_at < now() - interval '90 days');
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
END
$$;
--> statement-breakpoint
RESET ROLE;
