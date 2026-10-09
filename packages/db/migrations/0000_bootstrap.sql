-- Bootstrap (hand-written, ADR 0009): helper schema, group roles and the
-- functions that tables and policies depend on. Runs as the migration role.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- app_rw: every privilege the application has; no BYPASSRLS. The login role
-- (mm_app) is created outside migrations, with SQL, by the provisioning step,
-- so that on Neon it is never a member of neon_superuser.
-- mm_system: owns the few SECURITY DEFINER functions that work across tenants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mm_system') THEN
    CREATE ROLE mm_system NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- The tenant of the current transaction, or NULL. The tenant only counts if
-- it was set in this transaction: withTenant stamps app.tenant_at with now()
-- (the transaction start time), so a value left on a pooled connection by an
-- earlier transaction never matches and policies return no rows (ADR 0002).
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN current_setting('app.tenant_at', true) = now()::text
              THEN nullif(current_setting('app.tenant_id', true), '')::uuid
         END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_rw, mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_tenant_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_rw, mm_system;
