CREATE TABLE "store"."incomplete_orders" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"cart_id" uuid,
	"phone" text NOT NULL,
	"name" text,
	"email" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal" bigint NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"contacted_by" uuid,
	"contacted_at" timestamp with time zone,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incomplete_orders_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "incomplete_orders_status_valid" CHECK ("store"."incomplete_orders"."status" in ('open', 'contacted', 'converted', 'recovered', 'dismissed')),
	CONSTRAINT "incomplete_orders_phone_format" CHECK ("store"."incomplete_orders"."phone" ~ '^\+8801[3-9][0-9]{8}$'),
	CONSTRAINT "incomplete_orders_locale_valid" CHECK ("store"."incomplete_orders"."locale" in ('bn', 'en')),
	CONSTRAINT "incomplete_orders_name_length" CHECK (char_length("store"."incomplete_orders"."name") <= 100),
	CONSTRAINT "incomplete_orders_email_length" CHECK (char_length("store"."incomplete_orders"."email") <= 254),
	CONSTRAINT "incomplete_orders_note_length" CHECK (char_length("store"."incomplete_orders"."note") <= 500),
	CONSTRAINT "incomplete_orders_subtotal" CHECK ("store"."incomplete_orders"."subtotal" >= 0),
	CONSTRAINT "incomplete_orders_lines" CHECK (jsonb_typeof("store"."incomplete_orders"."lines") = 'array' and jsonb_array_length("store"."incomplete_orders"."lines") between 1 and 50),
	CONSTRAINT "incomplete_orders_address_size" CHECK (octet_length("store"."incomplete_orders"."address"::text) <= 2000),
	CONSTRAINT "incomplete_orders_order_status" CHECK (("store"."incomplete_orders"."status" = 'converted') <= ("store"."incomplete_orders"."order_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "store"."incomplete_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."order_confirmations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"order_id" uuid NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_outcome" text,
	"last_note" text,
	"due_at" timestamp with time zone,
	"claimed_by" uuid,
	"claimed_until" timestamp with time zone,
	"link_hash" text,
	"link_sends" smallint DEFAULT 0 NOT NULL,
	"link_sent_at" timestamp with time zone,
	"link_expires_at" timestamp with time zone,
	"link_answer" text,
	"link_answered_at" timestamp with time zone,
	"confirmed_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_confirmations_tenant_id_order_id_pk" PRIMARY KEY("tenant_id","order_id"),
	CONSTRAINT "order_confirmations_outcome_valid" CHECK ("store"."order_confirmations"."last_outcome" in ('confirmed', 'no_answer', 'call_back', 'wrong_number', 'cancelled')),
	CONSTRAINT "order_confirmations_via_valid" CHECK ("store"."order_confirmations"."confirmed_via" in ('call', 'link', 'staff', 'auto')),
	CONSTRAINT "order_confirmations_answer_valid" CHECK ("store"."order_confirmations"."link_answer" in ('confirm', 'cancel')),
	CONSTRAINT "order_confirmations_attempts_range" CHECK ("store"."order_confirmations"."attempts" between 0 and 100),
	CONSTRAINT "order_confirmations_link_sends_range" CHECK ("store"."order_confirmations"."link_sends" between 0 and 10),
	CONSTRAINT "order_confirmations_note_length" CHECK (char_length("store"."order_confirmations"."last_note") <= 500),
	CONSTRAINT "order_confirmations_link_hash_format" CHECK ("store"."order_confirmations"."link_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_confirmations_claim" CHECK (("store"."order_confirmations"."claimed_by" is null) = ("store"."order_confirmations"."claimed_until" is null))
);
--> statement-breakpoint
ALTER TABLE "store"."order_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."message_templates" DROP CONSTRAINT "message_templates_event_valid";--> statement-breakpoint
ALTER TABLE "store"."messages" DROP CONSTRAINT "messages_event_valid";--> statement-breakpoint
ALTER TABLE "store"."order_history" DROP CONSTRAINT "order_history_machine_valid";--> statement-breakpoint
ALTER TABLE "store"."orders" DROP CONSTRAINT "orders_flags_valid";--> statement-breakpoint
DROP INDEX "store"."orders_tenant_phone_idx";--> statement-breakpoint
ALTER TABLE "store"."carts" ADD COLUMN "recovery_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD COLUMN "cancel_code" text;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD COLUMN "phone_score" smallint;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "store"."incomplete_orders" ADD CONSTRAINT "incomplete_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."incomplete_orders" ADD CONSTRAINT "incomplete_orders_cart_fk" FOREIGN KEY ("tenant_id","cart_id") REFERENCES "store"."carts"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."incomplete_orders" ADD CONSTRAINT "incomplete_orders_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_confirmations" ADD CONSTRAINT "order_confirmations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_confirmations" ADD CONSTRAINT "order_confirmations_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incomplete_orders_cart_unique" ON "store"."incomplete_orders" USING btree ("tenant_id","cart_id") WHERE cart_id is not null;--> statement-breakpoint
CREATE INDEX "incomplete_orders_status_idx" ON "store"."incomplete_orders" USING btree ("tenant_id","status",updated_at desc);--> statement-breakpoint
CREATE INDEX "incomplete_orders_phone_idx" ON "store"."incomplete_orders" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "order_confirmations_link_unique" ON "store"."order_confirmations" USING btree ("tenant_id","link_hash") WHERE link_hash is not null;--> statement-breakpoint
CREATE INDEX "order_confirmations_due_idx" ON "store"."order_confirmations" USING btree ("tenant_id","due_at");--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_duplicate_of_fk" FOREIGN KEY ("tenant_id","duplicate_of") REFERENCES "store"."orders"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_tenant_phone_idx" ON "store"."orders" USING btree ("tenant_id","phone",placed_at desc);--> statement-breakpoint
ALTER TABLE "store"."message_templates" ADD CONSTRAINT "message_templates_event_valid" CHECK ("store"."message_templates"."event" in ('order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'payment_received', 'payment_expired', 'return_approved', 'return_rejected', 'return_received', 'refund_issued', 'store_credit_issued', 'confirm_request', 'new_order', 'online_payment', 'shopper_cancelled', 'return_requested', 'payment_problem'));--> statement-breakpoint
ALTER TABLE "store"."messages" ADD CONSTRAINT "messages_event_valid" CHECK ("store"."messages"."event" in ('order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'payment_received', 'payment_expired', 'return_approved', 'return_rejected', 'return_received', 'refund_issued', 'store_credit_issued', 'confirm_request', 'new_order', 'online_payment', 'shopper_cancelled', 'return_requested', 'payment_problem'));--> statement-breakpoint
ALTER TABLE "store"."order_history" ADD CONSTRAINT "order_history_machine_valid" CHECK ("store"."order_history"."machine" in ('order', 'payment', 'delivery', 'shipment', 'edit', 'return', 'refund', 'confirmation'));--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_cancel_code_valid" CHECK ("store"."orders"."cancel_code" in ('shopper_request', 'no_answer', 'wrong_number', 'fake', 'duplicate', 'out_of_stock', 'payment_expired', 'other'));--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_phone_score_range" CHECK ("store"."orders"."phone_score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_duplicate_of_other" CHECK ("store"."orders"."duplicate_of" <> "store"."orders"."id");--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_flags_valid" CHECK ("store"."orders"."flags" <@ array['payment_risk', 'late_payment', 'flagged_phone', 'possible_duplicate', 'unreachable']::text[]);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."incomplete_orders" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."incomplete_orders"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."incomplete_orders"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."order_confirmations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."order_confirmations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."order_confirmations"."tenant_id" = (select app.current_tenant_id()));