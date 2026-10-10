-- Hand-written (ADR 0009): what drizzle-kit does not generate. Every store
-- table gets FORCE ROW LEVEL SECURITY (so even the owner is filtered) and
-- explicit grants; the catalog test fails CI if a store table is missing
-- either. New store tables add their lines here in a new migration.

ALTER TABLE store.outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON SCHEMA platform, store FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform, store TO app_rw, mm_system;
--> statement-breakpoint

-- The tenant registry: readable by the app (hostname -> store), written only
-- by the migration role and, from Phase 1, platform admin functions.
GRANT SELECT ON platform.tenants TO app_rw;
--> statement-breakpoint

-- Outbox: the app writes events and reads its own; the dispatcher's
-- cross-tenant access goes through mm_system functions (migration 0003).
GRANT SELECT, INSERT ON store.outbox TO app_rw;
--> statement-breakpoint
-- Audit log: append-only for the app.
GRANT SELECT, INSERT ON store.audit_log TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.idempotency_keys TO app_rw;
--> statement-breakpoint

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON platform.tenants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER idempotency_keys_set_updated_at BEFORE UPDATE ON store.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

--> statement-breakpoint
-- TEMPORARY (PR 16 acceptance check): a store table with no RLS, no FORCE and no policy. Must make CI fail; reverted in the next commit.
CREATE TABLE store.broken (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
--> statement-breakpoint
GRANT SELECT, INSERT ON store.broken TO app_rw;
