CREATE TABLE "store"."whatsapp_contacts" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"phone" text NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_contacts_tenant_id_phone_pk" PRIMARY KEY("tenant_id","phone"),
	CONSTRAINT "whatsapp_contacts_phone_format" CHECK ("store"."whatsapp_contacts"."phone" ~ '^\+[0-9]{8,15}$')
);
--> statement-breakpoint
ALTER TABLE "store"."whatsapp_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."whatsapp_templates" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"event" text NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"variables" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"meta_template_id" text,
	"reason" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_templates_tenant_id_event_locale_pk" PRIMARY KEY("tenant_id","event","locale"),
	CONSTRAINT "whatsapp_templates_event_valid" CHECK ("store"."whatsapp_templates"."event" in ('order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'payment_received', 'payment_expired', 'return_approved', 'return_rejected', 'return_received', 'refund_issued', 'store_credit_issued', 'confirm_request', 'new_order', 'online_payment', 'shopper_cancelled', 'return_requested', 'payment_problem')),
	CONSTRAINT "whatsapp_templates_status_valid" CHECK ("store"."whatsapp_templates"."status" in ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
	CONSTRAINT "whatsapp_templates_locale_valid" CHECK ("store"."whatsapp_templates"."locale" in ('bn', 'en')),
	CONSTRAINT "whatsapp_templates_lengths" CHECK (char_length("store"."whatsapp_templates"."name") <= 100 and char_length("store"."whatsapp_templates"."body") between 1 and 1024
        and char_length("store"."whatsapp_templates"."meta_template_id") <= 50 and char_length("store"."whatsapp_templates"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."whatsapp_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."messages" DROP CONSTRAINT "messages_channel_valid";--> statement-breakpoint
ALTER TABLE "store"."messages" DROP CONSTRAINT "messages_status_valid";--> statement-breakpoint
ALTER TABLE "store"."messages" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "store"."messages" ADD COLUMN "delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_provider_message_idx" ON "store"."messages" USING btree ("tenant_id","provider_message_id") WHERE provider_message_id is not null;--> statement-breakpoint
ALTER TABLE "store"."messages" ADD CONSTRAINT "messages_delivery_status_valid" CHECK ("store"."messages"."delivery_status" in ('sent', 'delivered', 'read', 'failed'));--> statement-breakpoint
ALTER TABLE "store"."messages" ADD CONSTRAINT "messages_channel_valid" CHECK ("store"."messages"."channel" in ('email', 'sms', 'push', 'whatsapp'));--> statement-breakpoint
ALTER TABLE "store"."messages" ADD CONSTRAINT "messages_status_valid" CHECK ("store"."messages"."status" in ('queued', 'sent', 'failed', 'skipped', 'waiting'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."whatsapp_contacts" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."whatsapp_contacts"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."whatsapp_contacts"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."whatsapp_templates" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."whatsapp_templates"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."whatsapp_templates"."tenant_id" = (select app.current_tenant_id()));