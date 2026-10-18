ALTER TABLE "platform"."tenant_domains" ADD COLUMN "turnstile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The widget sync (apps/api/src/turnstile-hosts.ts) records whether each domain is on it.
GRANT UPDATE (turnstile) ON platform.tenant_domains TO app_rw;
