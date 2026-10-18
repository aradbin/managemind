CREATE TABLE "store"."message_templates" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_tenant_id_event_channel_locale_pk" PRIMARY KEY("tenant_id","event","channel","locale"),
	CONSTRAINT "message_templates_event_valid" CHECK ("store"."message_templates"."event" in ('order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'payment_received', 'payment_expired', 'return_approved', 'return_rejected', 'return_received', 'refund_issued', 'store_credit_issued', 'new_order', 'online_payment', 'shopper_cancelled', 'return_requested', 'payment_problem')),
	CONSTRAINT "message_templates_channel_valid" CHECK ("store"."message_templates"."channel" in ('email', 'sms', 'push')),
	CONSTRAINT "message_templates_locale_valid" CHECK ("store"."message_templates"."locale" in ('bn', 'en')),
	CONSTRAINT "message_templates_subject_length" CHECK (char_length("store"."message_templates"."subject") <= 200),
	CONSTRAINT "message_templates_body_length" CHECK (char_length("store"."message_templates"."body") between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "store"."message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."messages" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"idempotency_key" text NOT NULL,
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient" text NOT NULL,
	"order_id" uuid,
	"locale" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "messages_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "messages_event_valid" CHECK ("store"."messages"."event" in ('order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'payment_received', 'payment_expired', 'return_approved', 'return_rejected', 'return_received', 'refund_issued', 'store_credit_issued', 'new_order', 'online_payment', 'shopper_cancelled', 'return_requested', 'payment_problem')),
	CONSTRAINT "messages_channel_valid" CHECK ("store"."messages"."channel" in ('email', 'sms', 'push')),
	CONSTRAINT "messages_recipient_type_valid" CHECK ("store"."messages"."recipient_type" in ('shopper', 'staff')),
	CONSTRAINT "messages_status_valid" CHECK ("store"."messages"."status" in ('queued', 'sent', 'failed', 'skipped')),
	CONSTRAINT "messages_locale_valid" CHECK ("store"."messages"."locale" in ('bn', 'en')),
	CONSTRAINT "messages_text_lengths" CHECK (char_length("store"."messages"."idempotency_key") <= 200 and char_length("store"."messages"."recipient") <= 254
        and char_length("store"."messages"."reason") <= 300 and char_length("store"."messages"."provider") <= 30
        and char_length("store"."messages"."provider_message_id") <= 200)
);
--> statement-breakpoint
ALTER TABLE "store"."messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."provider_credentials" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"key_version" smallint NOT NULL,
	"hint" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"check_error" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind"),
	CONSTRAINT "provider_credentials_kind_valid" CHECK ("store"."provider_credentials"."kind" in ('sslcommerz', 'sms', 'email')),
	CONSTRAINT "provider_credentials_provider_valid" CHECK ("store"."provider_credentials"."provider" in ('sslcommerz', 'sms_net_bd', 'bulksmsbd', 'sms_http', 'resend', 'brevo')),
	CONSTRAINT "provider_credentials_mode_valid" CHECK ("store"."provider_credentials"."mode" in ('sandbox', 'live')),
	CONSTRAINT "provider_credentials_kind_provider" CHECK (case "store"."provider_credentials"."kind"
        when 'sslcommerz' then "store"."provider_credentials"."provider" = 'sslcommerz' and "store"."provider_credentials"."mode" is not null
        when 'sms' then "store"."provider_credentials"."provider" in ('sms_net_bd', 'bulksmsbd', 'sms_http') and "store"."provider_credentials"."mode" is null
        else "store"."provider_credentials"."provider" in ('resend', 'brevo') and "store"."provider_credentials"."mode" is null end),
	CONSTRAINT "provider_credentials_iv_length" CHECK (octet_length("store"."provider_credentials"."iv") = 12),
	CONSTRAINT "provider_credentials_ciphertext_size" CHECK (octet_length("store"."provider_credentials"."ciphertext") <= 4096),
	CONSTRAINT "provider_credentials_hint_length" CHECK (char_length("store"."provider_credentials"."hint") <= 8),
	CONSTRAINT "provider_credentials_config_size" CHECK (octet_length("store"."provider_credentials"."config"::text) <= 2000),
	CONSTRAINT "provider_credentials_check_error_length" CHECK (char_length("store"."provider_credentials"."check_error") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."push_subscriptions" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("tenant_id","endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("store"."push_subscriptions"."endpoint" ~ '^https://'),
	CONSTRAINT "push_subscriptions_lengths" CHECK (char_length("store"."push_subscriptions"."endpoint") <= 1000 and char_length("store"."push_subscriptions"."p256dh") <= 200
        and char_length("store"."push_subscriptions"."auth") <= 50 and char_length("store"."push_subscriptions"."user_agent") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."staff_alert_preferences" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "staff_alert_preferences_tenant_id_user_id_event_channel_pk" PRIMARY KEY("tenant_id","user_id","event","channel"),
	CONSTRAINT "staff_alert_preferences_event_valid" CHECK ("store"."staff_alert_preferences"."event" in ('new_order', 'online_payment', 'shopper_cancelled', 'return_requested', 'payment_problem')),
	CONSTRAINT "staff_alert_preferences_channel_valid" CHECK ("store"."staff_alert_preferences"."channel" in ('email', 'sms', 'push'))
);
--> statement-breakpoint
ALTER TABLE "store"."staff_alert_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."refund_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"refund_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "refund_lines_tenant_id_refund_id_order_line_id_pk" PRIMARY KEY("tenant_id","refund_id","order_line_id"),
	CONSTRAINT "refund_lines_quantities" CHECK ("store"."refund_lines"."quantity" > 0 and "store"."refund_lines"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."refund_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."refunds" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"return_id" uuid,
	"payment_id" uuid,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"delivery_amount" bigint DEFAULT 0 NOT NULL,
	"reference" text,
	"reason" text,
	"gateway_refund_ref" text,
	"gateway_error" text,
	"credit_code_id" uuid,
	"recorded_by" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "refunds_method_valid" CHECK ("store"."refunds"."method" in ('gateway', 'gateway_manual', 'bkash', 'nagad', 'rocket', 'bank', 'cash', 'store_credit')),
	CONSTRAINT "refunds_status_valid" CHECK ("store"."refunds"."status" in ('pending', 'processing', 'succeeded', 'failed')),
	CONSTRAINT "refunds_amounts" CHECK ("store"."refunds"."amount" > 0 and "store"."refunds"."delivery_amount" >= 0 and "store"."refunds"."delivery_amount" <= "store"."refunds"."amount"),
	CONSTRAINT "refunds_gateway_payment" CHECK (("store"."refunds"."method" in ('gateway', 'gateway_manual')) = ("store"."refunds"."payment_id" is not null)),
	CONSTRAINT "refunds_reference_length" CHECK (char_length("store"."refunds"."reference") <= 100),
	CONSTRAINT "refunds_reason_length" CHECK (char_length("store"."refunds"."reason") <= 300),
	CONSTRAINT "refunds_gateway_text_length" CHECK (char_length("store"."refunds"."gateway_refund_ref") <= 100 and char_length("store"."refunds"."gateway_error") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."return_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"restocked" integer DEFAULT 0 NOT NULL,
	"written_off" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "return_lines_tenant_id_return_id_order_line_id_pk" PRIMARY KEY("tenant_id","return_id","order_line_id"),
	CONSTRAINT "return_lines_reason_valid" CHECK ("store"."return_lines"."reason" in ('wrong_size', 'damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other')),
	CONSTRAINT "return_lines_quantities" CHECK ("store"."return_lines"."quantity" > 0 and "store"."return_lines"."restocked" >= 0 and "store"."return_lines"."written_off" >= 0
        and "store"."return_lines"."restocked" + "store"."return_lines"."written_off" <= "store"."return_lines"."quantity")
);
--> statement-breakpoint
ALTER TABLE "store"."return_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."return_photos" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"return_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_photos_mime_valid" CHECK ("store"."return_photos"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "return_photos_bytes" CHECK ("store"."return_photos"."bytes" between 1 and 2097152),
	CONSTRAINT "return_photos_key_length" CHECK (char_length("store"."return_photos"."object_key") <= 200)
);
--> statement-breakpoint
ALTER TABLE "store"."return_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."returns" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"requested_by" text NOT NULL,
	"created_by" uuid,
	"shopper_pays_return" boolean,
	"resolution" text,
	"reject_reason" text,
	"exchange_order_id" uuid,
	"approved_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"inspected_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "returns_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "returns_status_valid" CHECK ("store"."returns"."status" in ('requested', 'approved', 'rejected', 'in_transit', 'received', 'inspected', 'resolved')),
	CONSTRAINT "returns_reason_valid" CHECK ("store"."returns"."reason" in ('wrong_size', 'damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other')),
	CONSTRAINT "returns_requested_by_valid" CHECK ("store"."returns"."requested_by" in ('staff', 'platform', 'system', 'shopper')),
	CONSTRAINT "returns_resolution_valid" CHECK ("store"."returns"."resolution" in ('refunded', 'exchanged', 'store_credit', 'rejected')),
	CONSTRAINT "returns_number_positive" CHECK ("store"."returns"."number" > 0),
	CONSTRAINT "returns_note_length" CHECK (char_length("store"."returns"."note") <= 500),
	CONSTRAINT "returns_reject_reason_length" CHECK (char_length("store"."returns"."reject_reason") <= 300),
	CONSTRAINT "returns_resolved" CHECK (("store"."returns"."status" = 'resolved') = ("store"."returns"."resolution" is not null))
);
--> statement-breakpoint
ALTER TABLE "store"."returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."customers" DROP CONSTRAINT "customers_totals_non_negative";--> statement-breakpoint
ALTER TABLE "store"."counters" DROP CONSTRAINT "counters_name_valid";--> statement-breakpoint
ALTER TABLE "store"."order_history" DROP CONSTRAINT "order_history_machine_valid";--> statement-breakpoint
ALTER TABLE "store"."orders" DROP CONSTRAINT "orders_payment_status_valid";--> statement-breakpoint
ALTER TABLE "store"."orders" DROP CONSTRAINT "orders_return_status_valid";--> statement-breakpoint
ALTER TABLE "store"."orders" DROP CONSTRAINT "orders_source_valid";--> statement-breakpoint
ALTER TABLE "store"."payments" DROP CONSTRAINT "payments_provider_valid";--> statement-breakpoint
ALTER TABLE "store"."payments" DROP CONSTRAINT "payments_method_valid";--> statement-breakpoint
ALTER TABLE "store"."payments" DROP CONSTRAINT "payments_status_valid";--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "failed_deliveries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD COLUMN "refunded_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD COLUMN "flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."payments" ADD COLUMN "gateway_val_id" text;--> statement-breakpoint
ALTER TABLE "store"."payments" ADD COLUMN "gateway_bank_tran_id" text;--> statement-breakpoint
ALTER TABLE "store"."payments" ADD COLUMN "risk_level" smallint;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "return_cost" bigint;--> statement-breakpoint
ALTER TABLE "store"."message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."messages" ADD CONSTRAINT "messages_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."staff_alert_preferences" ADD CONSTRAINT "staff_alert_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."staff_alert_preferences" ADD CONSTRAINT "staff_alert_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refund_lines" ADD CONSTRAINT "refund_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refund_lines" ADD CONSTRAINT "refund_lines_refund_fk" FOREIGN KEY ("tenant_id","refund_id") REFERENCES "store"."refunds"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refund_lines" ADD CONSTRAINT "refund_lines_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "store"."order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refunds" ADD CONSTRAINT "refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refunds" ADD CONSTRAINT "refunds_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refunds" ADD CONSTRAINT "refunds_return_fk" FOREIGN KEY ("tenant_id","return_id") REFERENCES "store"."returns"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "store"."payments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."refunds" ADD CONSTRAINT "refunds_credit_code_fk" FOREIGN KEY ("tenant_id","credit_code_id") REFERENCES "store"."promotion_codes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."return_lines" ADD CONSTRAINT "return_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."return_lines" ADD CONSTRAINT "return_lines_return_fk" FOREIGN KEY ("tenant_id","return_id") REFERENCES "store"."returns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."return_lines" ADD CONSTRAINT "return_lines_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "store"."order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."return_photos" ADD CONSTRAINT "return_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."return_photos" ADD CONSTRAINT "return_photos_return_fk" FOREIGN KEY ("tenant_id","return_id") REFERENCES "store"."returns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."returns" ADD CONSTRAINT "returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."returns" ADD CONSTRAINT "returns_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."returns" ADD CONSTRAINT "returns_exchange_order_fk" FOREIGN KEY ("tenant_id","exchange_order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_tenant_created_idx" ON "store"."messages" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE INDEX "messages_order_idx" ON "store"."messages" USING btree ("tenant_id","order_id") WHERE order_id is not null;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "store"."push_subscriptions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "refund_lines_line_idx" ON "store"."refund_lines" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "store"."refunds" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "refunds_processing_idx" ON "store"."refunds" USING btree ("tenant_id") WHERE status = 'processing';--> statement-breakpoint
CREATE INDEX "return_lines_line_idx" ON "store"."return_lines" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "return_photos_return_idx" ON "store"."return_photos" USING btree ("tenant_id","return_id");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "store"."returns" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "returns_tenant_status_idx" ON "store"."returns" USING btree ("tenant_id","status",created_at desc);--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_val_id_unique" ON "store"."payments" USING btree ("tenant_id","provider","gateway_val_id") WHERE gateway_val_id is not null;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD CONSTRAINT "customers_totals_non_negative" CHECK ("store"."customers"."order_count" >= 0 and "store"."customers"."total_spent" >= 0 and "store"."customers"."failed_deliveries" >= 0);--> statement-breakpoint
ALTER TABLE "store"."counters" ADD CONSTRAINT "counters_name_valid" CHECK ("store"."counters"."name" in ('order_number', 'return_number'));--> statement-breakpoint
ALTER TABLE "store"."order_history" ADD CONSTRAINT "order_history_machine_valid" CHECK ("store"."order_history"."machine" in ('order', 'payment', 'delivery', 'shipment', 'edit', 'return', 'refund'));--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_refunded_within_paid" CHECK ("store"."orders"."refunded_total" >= 0 and "store"."orders"."refunded_total" <= "store"."orders"."paid_total");--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_flags_valid" CHECK ("store"."orders"."flags" <@ array['payment_risk', 'late_payment', 'flagged_phone']::text[]);--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_payment_status_valid" CHECK ("store"."orders"."payment_status" in ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'));--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_return_status_valid" CHECK ("store"."orders"."return_status" in ('none', 'requested', 'partially_returned', 'returned'));--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_source_valid" CHECK ("store"."orders"."source" in ('website', 'facebook', 'phone', 'walk_in', 'other', 'exchange'));--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_online_method" CHECK (("store"."payments"."provider" = 'sslcommerz') = ("store"."payments"."method" = 'online'));--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_gateway_fields_length" CHECK (char_length("store"."payments"."gateway_val_id") <= 100 and char_length("store"."payments"."gateway_bank_tran_id") <= 100);--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_provider_valid" CHECK ("store"."payments"."provider" in ('cod', 'manual', 'sslcommerz'));--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_method_valid" CHECK ("store"."payments"."method" in ('cod', 'bkash', 'nagad', 'rocket', 'bank', 'cash', 'other', 'online'));--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_status_valid" CHECK ("store"."payments"."status" in ('pending', 'paid', 'voided', 'failed', 'expired'));--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_return_cost_non_negative" CHECK ("store"."shipments"."return_cost" >= 0);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."message_templates" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."message_templates"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."message_templates"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."messages" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."messages"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."messages"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."provider_credentials" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."provider_credentials"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."provider_credentials"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."push_subscriptions" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."push_subscriptions"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."push_subscriptions"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."staff_alert_preferences" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."staff_alert_preferences"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."staff_alert_preferences"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."refund_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."refund_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."refund_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."refunds" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."refunds"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."refunds"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."return_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."return_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."return_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."return_photos" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."return_photos"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."return_photos"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."returns" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."returns"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."returns"."tenant_id" = (select app.current_tenant_id()));