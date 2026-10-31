CREATE TABLE "store"."feeds" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"kind" text NOT NULL,
	"dirty_since" timestamp with time zone,
	"built_at" timestamp with time zone,
	"chunks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etag" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feeds_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind"),
	CONSTRAINT "feeds_kind_valid" CHECK ("store"."feeds"."kind" in ('meta')),
	CONSTRAINT "feeds_rows_non_negative" CHECK ("store"."feeds"."rows" >= 0),
	CONSTRAINT "feeds_text_lengths" CHECK (char_length("store"."feeds"."etag") <= 100 and char_length("store"."feeds"."last_error") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."meta_events" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_events_order_name_unique" UNIQUE("tenant_id","order_id","name"),
	CONSTRAINT "meta_events_name_valid" CHECK ("store"."meta_events"."name" in ('Purchase', 'Delivered')),
	CONSTRAINT "meta_events_status_valid" CHECK ("store"."meta_events"."status" in ('queued', 'sent', 'failed', 'skipped')),
	CONSTRAINT "meta_events_reason_length" CHECK (char_length("store"."meta_events"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."meta_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" DROP CONSTRAINT "provider_credentials_kind_valid";--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" DROP CONSTRAINT "provider_credentials_provider_valid";--> statement-breakpoint
ALTER TABLE "store"."orders" DROP CONSTRAINT "orders_source_valid";--> statement-breakpoint
ALTER TABLE "store"."orders" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "store"."feeds" ADD CONSTRAINT "feeds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."meta_events" ADD CONSTRAINT "meta_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."meta_events" ADD CONSTRAINT "meta_events_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_events_tenant_created_idx" ON "store"."meta_events" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_kind_valid" CHECK ("store"."provider_credentials"."kind" in ('sslcommerz', 'sms', 'email', 'steadfast', 'pathao', 'redx', 'fake', 'meta_capi', 'whatsapp'));--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_provider_valid" CHECK ("store"."provider_credentials"."provider" in ('sslcommerz', 'sms_net_bd', 'bulksmsbd', 'sms_http', 'resend', 'brevo', 'steadfast', 'pathao', 'redx', 'fake', 'meta_capi', 'whatsapp'));--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_attribution_size" CHECK (octet_length("store"."orders"."attribution"::text) <= 2000);--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_source_valid" CHECK ("store"."orders"."source" in ('website', 'facebook', 'phone', 'walk_in', 'other', 'exchange', 'whatsapp', 'messenger', 'instagram'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."feeds" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."feeds"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."feeds"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."meta_events" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."meta_events"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."meta_events"."tenant_id" = (select app.current_tenant_id()));