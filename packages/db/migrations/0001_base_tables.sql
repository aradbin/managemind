CREATE SCHEMA "store";
--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"default_locale" text DEFAULT 'bn' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_slug_format" CHECK ("platform"."tenants"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'),
	CONSTRAINT "tenants_status_valid" CHECK ("platform"."tenants"."status" in ('active', 'suspended', 'closed', 'purged')),
	CONSTRAINT "tenants_locale_valid" CHECK ("platform"."tenants"."default_locale" in ('bn', 'en'))
);
--> statement-breakpoint
CREATE TABLE "store"."audit_log" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_valid" CHECK (actor_type in ('staff', 'platform', 'system'))
);
--> statement-breakpoint
ALTER TABLE "store"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."idempotency_keys" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'in_progress' NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"locked_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '2 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_id_scope_key_pk" PRIMARY KEY("tenant_id","scope","key"),
	CONSTRAINT "idempotency_keys_key_length" CHECK (char_length(key) between 8 and 255),
	CONSTRAINT "idempotency_keys_state_valid" CHECK (state in ('in_progress', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "store"."idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."outbox" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid,
	"payload" jsonb NOT NULL,
	"request_id" text,
	"dispatched_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."outbox" ADD CONSTRAINT "outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "store"."audit_log" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE INDEX "audit_log_tenant_entity_idx" ON "store"."audit_log" USING btree ("tenant_id","entity_type","entity_id",created_at desc);--> statement-breakpoint
CREATE INDEX "idempotency_keys_tenant_expires_idx" ON "store"."idempotency_keys" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "outbox_tenant_created_idx" ON "store"."outbox" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "store"."outbox" USING btree ("created_at") WHERE dispatched_at is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."audit_log" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."audit_log"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."audit_log"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."idempotency_keys" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."idempotency_keys"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."idempotency_keys"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."outbox" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."outbox"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."outbox"."tenant_id" = (select app.current_tenant_id()));