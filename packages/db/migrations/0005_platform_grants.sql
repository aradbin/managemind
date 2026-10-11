-- Hand-written (ADR 0009, phase-1-plan §4.1): grants, triggers and the
-- cleanup additions for the Phase 1 platform tables, which drizzle-kit does
-- not generate. Platform tables have no RLS, so these grants are the access
-- control; the grant test pins them.

-- A store's slug is part of its default address; changing it is a domain
-- change (Phase 3), never an UPDATE.
CREATE FUNCTION app.tenants_slug_immutable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'tenants.slug cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenants_slug_immutable BEFORE UPDATE OF slug ON platform.tenants
  FOR EACH ROW EXECUTE FUNCTION app.tenants_slug_immutable();
--> statement-breakpoint

-- Tenants: the platform API creates stores and changes their profile and
-- status; never their id or slug.
GRANT INSERT ON platform.tenants TO app_rw;
--> statement-breakpoint
GRANT UPDATE (name, default_locale, settings, status, plan) ON platform.tenants TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.tenant_domains TO app_rw;
--> statement-breakpoint
GRANT UPDATE (status, is_primary, verified_at, provider_ref) ON platform.tenant_domains TO app_rw;
--> statement-breakpoint

-- Staff identity, written by Better Auth. Users are never deleted by the app
-- (a purge removes accounts that belonged only to a purged store), and
-- their id and email never change.
GRANT SELECT, INSERT ON platform.users TO app_rw;
--> statement-breakpoint
GRANT UPDATE (name, email_verified, image, two_factor_enabled, platform_role, locale, updated_at)
  ON platform.users TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sessions, platform.accounts,
  platform.verifications, platform.two_factors TO app_rw;
--> statement-breakpoint

-- Memberships, invitations and support access (packages/core/identity).
GRANT SELECT, INSERT, DELETE ON platform.memberships TO app_rw;
--> statement-breakpoint
GRANT UPDATE (role, updated_at) ON platform.memberships TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.invitations TO app_rw;
--> statement-breakpoint
GRANT UPDATE (status, token_hash, expires_at, accepted_by, accepted_at, updated_at)
  ON platform.invitations TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.support_grants TO app_rw;
--> statement-breakpoint
GRANT UPDATE (revoked_at, updated_at) ON platform.support_grants TO app_rw;
--> statement-breakpoint

-- Append-only, like store.audit_log.
GRANT SELECT, INSERT ON platform.audit_log TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.dev_emails TO app_rw;
--> statement-breakpoint

CREATE TRIGGER tenant_domains_set_updated_at BEFORE UPDATE ON platform.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON platform.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON platform.sessions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON platform.accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER verifications_set_updated_at BEFORE UPDATE ON platform.verifications
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER two_factors_set_updated_at BEFORE UPDATE ON platform.two_factors
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON platform.memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invitations_set_updated_at BEFORE UPDATE ON platform.invitations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER support_grants_set_updated_at BEFORE UPDATE ON platform.support_grants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- The daily cleanup (PLAN.md retention table) gains expired sessions and
-- sign-in codes (1 day), captured dev emails (1 day) and expired invitations.
GRANT SELECT, DELETE ON platform.sessions, platform.verifications, platform.dev_emails TO mm_system;
--> statement-breakpoint
GRANT SELECT, UPDATE (status, updated_at) ON platform.invitations TO mm_system;
--> statement-breakpoint
-- The function belongs to mm_system (migration 0003); only its owner can
-- replace it.
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
END
$$;
--> statement-breakpoint
RESET ROLE;
