CREATE SEQUENCE "platform"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "platform"."billing_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"paid_on" date NOT NULL,
	"recorded_by" uuid,
	"gateway_tran_id" text,
	"gateway_val_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_amount_positive" CHECK ("platform"."billing_payments"."amount" > 0),
	CONSTRAINT "billing_payments_method_valid" CHECK ("platform"."billing_payments"."method" in ('bank', 'bkash', 'nagad', 'cash', 'sslcommerz')),
	CONSTRAINT "billing_payments_gateway_val_id" CHECK (("platform"."billing_payments"."method" = 'sslcommerz') = ("platform"."billing_payments"."gateway_val_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "platform"."invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"description" jsonb NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"metric" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_position_unique" UNIQUE("invoice_id","position"),
	CONSTRAINT "invoice_lines_kind_valid" CHECK ("platform"."invoice_lines"."kind" in ('setup', 'plan', 'overage', 'adjustment', 'vat')),
	CONSTRAINT "invoice_lines_quantity_positive" CHECK ("platform"."invoice_lines"."quantity" > 0),
	CONSTRAINT "invoice_lines_amount_sign" CHECK ("platform"."invoice_lines"."kind" = 'adjustment' or ("platform"."invoice_lines"."amount" >= 0 and "platform"."invoice_lines"."unit_price" >= 0))
);
--> statement-breakpoint
CREATE TABLE "platform"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_start" date,
	"period_end" date,
	"issue_after" timestamp with time zone,
	"issued_on" date,
	"due_on" date,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"vat" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"issuer" jsonb,
	"billed_to" jsonb,
	"vat_rate_bp" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_status_valid" CHECK ("platform"."invoices"."status" in ('draft', 'issued', 'paid', 'void')),
	CONSTRAINT "invoices_issued_has_number" CHECK (("platform"."invoices"."status" in ('issued', 'paid')) <= ("platform"."invoices"."number" is not null and "platform"."invoices"."issued_on" is not null and "platform"."invoices"."due_on" is not null)),
	CONSTRAINT "invoices_totals" CHECK ("platform"."invoices"."total" = "platform"."invoices"."subtotal" + "platform"."invoices"."vat" and "platform"."invoices"."total" >= 0),
	CONSTRAINT "invoices_amount_paid" CHECK ("platform"."invoices"."amount_paid" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"monthly_price" integer NOT NULL,
	"setup_fee" integer DEFAULT 0 NOT NULL,
	"overage_prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entitlements" jsonb NOT NULL,
	"offered" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code"),
	CONSTRAINT "plans_code_format" CHECK ("platform"."plans"."code" ~ '^[a-z][a-z0-9-]{1,30}$'),
	CONSTRAINT "plans_prices_nonnegative" CHECK ("platform"."plans"."monthly_price" >= 0 and "platform"."plans"."setup_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"step" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_invoice_step_unique" UNIQUE("invoice_id","step"),
	CONSTRAINT "reminders_step_valid" CHECK ("platform"."reminders"."step" in ('due_soon', 'due_today', 'past_due', 'final_notice', 'suspend'))
);
--> statement-breakpoint
CREATE TABLE "platform"."store_health" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"domains" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"price_override" integer,
	"setup_fee_override" integer,
	"entitlement_override" jsonb,
	"billing_day" integer NOT NULL,
	"trial_ends_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"hold_until" date,
	"hold_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_tenantId_unique" UNIQUE("tenant_id"),
	CONSTRAINT "subscriptions_billing_day" CHECK ("platform"."subscriptions"."billing_day" between 1 and 28),
	CONSTRAINT "subscriptions_status_valid" CHECK ("platform"."subscriptions"."status" in ('trialing', 'active', 'past_due', 'cancelled')),
	CONSTRAINT "subscriptions_overrides_nonnegative" CHECK (coalesce("platform"."subscriptions"."price_override", 0) >= 0 and coalesce("platform"."subscriptions"."setup_fee_override", 0) >= 0),
	CONSTRAINT "subscriptions_hold_reason" CHECK (("platform"."subscriptions"."hold_until" is null) = ("platform"."subscriptions"."hold_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "platform"."tenant_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"file_key" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_jobs_kind_valid" CHECK ("platform"."tenant_jobs"."kind" in ('export', 'purge', 'reset')),
	CONSTRAINT "tenant_jobs_status_valid" CHECK ("platform"."tenant_jobs"."status" in ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "platform"."tenant_purges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"dry_run" jsonb,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"deleted" jsonb,
	"verification" jsonb,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_purges_approval" CHECK (("platform"."tenant_purges"."approved_by" is null) = ("platform"."tenant_purges"."approved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "platform"."terms_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"user_email" text NOT NULL,
	"version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_acceptances_once" UNIQUE("tenant_id","user_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."terms_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "terms_versions_sha256" CHECK ("platform"."terms_versions"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "terms_versions_url" CHECK ("platform"."terms_versions"."url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "platform"."usage_daily" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_tenant_id_day_metric_pk" PRIMARY KEY("tenant_id","day","metric"),
	CONSTRAINT "usage_daily_metric_valid" CHECK ("platform"."usage_daily"."metric" in ('orders', 'order_total', 'emails', 'sms', 'storage_bytes', 'products', 'staff', 'custom_domains')),
	CONSTRAINT "usage_daily_value_nonnegative" CHECK ("platform"."usage_daily"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "kind" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
-- Hand-added: existing rows meet the new checks. A store suspended before
-- Phase 5B has no recorded reason; one closed or purged has no dates.
UPDATE "platform"."tenants" SET "status_reason" = 'other' WHERE "status" = 'suspended';--> statement-breakpoint
UPDATE "platform"."tenants" SET "closed_at" = "updated_at", "purge_after" = "updated_at" + interval '30 days'
  WHERE "status" IN ('closed', 'purged');--> statement-breakpoint
UPDATE "platform"."tenants" SET "purged_at" = "updated_at" WHERE "status" = 'purged';--> statement-breakpoint
-- The two demo stores and the E2E suite's stores (phase-5b-plan §3.1).
UPDATE "platform"."tenants" SET "kind" = 'demo' WHERE "slug" IN ('demo-fashion', 'demo-grocery');--> statement-breakpoint
UPDATE "platform"."tenants" SET "kind" = 'test' WHERE "slug" LIKE 'e2e-%';--> statement-breakpoint
ALTER TABLE "platform"."billing_payments" ADD CONSTRAINT "billing_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "platform"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."billing_payments" ADD CONSTRAINT "billing_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."billing_payments" ADD CONSTRAINT "billing_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "platform"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."reminders" ADD CONSTRAINT "reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "platform"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."store_health" ADD CONSTRAINT "store_health_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "platform"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_jobs" ADD CONSTRAINT "tenant_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_jobs" ADD CONSTRAINT "tenant_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_purges" ADD CONSTRAINT "tenant_purges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_purges" ADD CONSTRAINT "tenant_purges_job_id_tenant_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "platform"."tenant_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_purges" ADD CONSTRAINT "tenant_purges_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_version_id_terms_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "platform"."terms_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."terms_versions" ADD CONSTRAINT "terms_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."usage_daily" ADD CONSTRAINT "usage_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_invoice_idx" ON "platform"."billing_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "billing_payments_tenant_idx" ON "platform"."billing_payments" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payments_val_id_unique" ON "platform"."billing_payments" USING btree ("gateway_val_id") WHERE method = 'sslcommerz';--> statement-breakpoint
CREATE INDEX "invoices_tenant_created_idx" ON "platform"."invoices" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "platform"."invoices" USING btree ("status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_period_unique" ON "platform"."invoices" USING btree ("tenant_id","period_start") WHERE status <> 'void' and period_start is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_billing_day_idx" ON "platform"."subscriptions" USING btree ("billing_day");--> statement-breakpoint
CREATE INDEX "tenant_jobs_status_idx" ON "platform"."tenant_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tenant_jobs_tenant_idx" ON "platform"."tenant_jobs" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_jobs_one_open" ON "platform"."tenant_jobs" USING btree ("tenant_id","kind") WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "tenant_purges_tenant_idx" ON "platform"."tenant_purges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "terms_acceptances_version_idx" ON "platform"."terms_acceptances" USING btree ("version_id","tenant_id");--> statement-breakpoint
CREATE INDEX "terms_versions_effective_idx" ON "platform"."terms_versions" USING btree (effective_at desc);--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_kind_valid" CHECK ("platform"."tenants"."kind" in ('client', 'demo', 'test'));--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_status_reason_valid" CHECK (("platform"."tenants"."status" = 'suspended') = ("platform"."tenants"."status_reason" is not null) and "platform"."tenants"."status_reason" in ('overdue', 'abuse', 'client_request', 'other'));--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_closed_dates" CHECK (("platform"."tenants"."status" in ('closed', 'purged')) = ("platform"."tenants"."closed_at" is not null and "platform"."tenants"."purge_after" is not null));--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_purged_at" CHECK (("platform"."tenants"."status" = 'purged') = ("platform"."tenants"."purged_at" is not null));