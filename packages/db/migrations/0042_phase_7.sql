CREATE TABLE "ref"."courier_area_map" (
	"area_id" integer NOT NULL,
	"courier" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" integer NOT NULL,
	"match" text NOT NULL,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_area_map_area_id_courier_pk" PRIMARY KEY("area_id","courier"),
	CONSTRAINT "courier_area_map_courier_valid" CHECK ("ref"."courier_area_map"."courier" in ('pathao', 'redx')),
	CONSTRAINT "courier_area_map_match_valid" CHECK ("ref"."courier_area_map"."match" in ('name', 'manual')),
	CONSTRAINT "courier_area_map_kind" CHECK (("ref"."courier_area_map"."courier" = 'pathao' and "ref"."courier_area_map"."kind" = 'zone') or ("ref"."courier_area_map"."courier" = 'redx' and "ref"."courier_area_map"."kind" = 'area'))
);
--> statement-breakpoint
CREATE TABLE "ref"."courier_areas" (
	"courier" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"name_bn" text,
	"district_name" text,
	"post_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_areas_courier_kind_external_id_pk" PRIMARY KEY("courier","kind","external_id"),
	CONSTRAINT "courier_areas_courier_valid" CHECK ("ref"."courier_areas"."courier" in ('pathao', 'redx')),
	CONSTRAINT "courier_areas_kind_valid" CHECK ("ref"."courier_areas"."kind" in ('city', 'zone', 'area')),
	CONSTRAINT "courier_areas_kinds_by_courier" CHECK ("ref"."courier_areas"."courier" = 'pathao' or "ref"."courier_areas"."kind" = 'area'),
	CONSTRAINT "courier_areas_name_length" CHECK (char_length("ref"."courier_areas"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "store"."courier_payout_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"payout_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"collected" bigint NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"net" bigint NOT NULL,
	CONSTRAINT "courier_payout_lines_tenant_id_payout_id_shipment_id_pk" PRIMARY KEY("tenant_id","payout_id","shipment_id"),
	CONSTRAINT "courier_payout_lines_money" CHECK ("store"."courier_payout_lines"."collected" >= 0 and "store"."courier_payout_lines"."fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."courier_payout_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."courier_payouts" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"courier" text NOT NULL,
	"reference" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"amount" bigint NOT NULL,
	"fee_total" bigint DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"recorded_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_payouts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "courier_payouts_courier_valid" CHECK ("store"."courier_payouts"."courier" in ('steadfast', 'pathao', 'redx', 'fake')),
	CONSTRAINT "courier_payouts_source_valid" CHECK ("store"."courier_payouts"."source" in ('courier', 'import', 'manual')),
	CONSTRAINT "courier_payouts_reference_length" CHECK (char_length("store"."courier_payouts"."reference") between 1 and 100),
	CONSTRAINT "courier_payouts_money" CHECK ("store"."courier_payouts"."amount" >= 0 and "store"."courier_payouts"."fee_total" >= 0),
	CONSTRAINT "courier_payouts_note_length" CHECK (char_length("store"."courier_payouts"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "store"."courier_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shipment_events" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"courier_status" text NOT NULL,
	"update" text NOT NULL,
	"message" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"courier_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_events_update_valid" CHECK ("store"."shipment_events"."update" in ('booked', 'picked_up', 'in_transit', 'on_hold', 'delivered', 'partial_delivered', 'returning', 'returned', 'cancelled', 'paid_out', 'unknown')),
	CONSTRAINT "shipment_events_source_valid" CHECK ("store"."shipment_events"."source" in ('booking', 'webhook', 'poll', 'staff')),
	CONSTRAINT "shipment_events_status_length" CHECK (char_length("store"."shipment_events"."courier_status") <= 60),
	CONSTRAINT "shipment_events_message_size" CHECK (octet_length("store"."shipment_events"."message"::text) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "store"."shipment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" DROP CONSTRAINT "provider_credentials_kind_valid";--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" DROP CONSTRAINT "provider_credentials_provider_valid";--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" DROP CONSTRAINT "provider_credentials_kind_provider";--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" DROP CONSTRAINT "provider_credentials_ciphertext_size";--> statement-breakpoint
ALTER TABLE "store"."orders" DROP CONSTRAINT "orders_flags_valid";--> statement-breakpoint
ALTER TABLE "store"."shipments" DROP CONSTRAINT "shipments_status_valid";--> statement-breakpoint
ALTER TABLE "store"."return_lines" DROP CONSTRAINT "return_lines_reason_valid";--> statement-breakpoint
ALTER TABLE "store"."returns" DROP CONSTRAINT "returns_reason_valid";--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_ref" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "consignment_id" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "tracking_code" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_status" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_message" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "booking_state" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "booking_error" text;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "booked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "in_transit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "cod_amount" bigint;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "cod_collected" bigint;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_fee" bigint;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "return_charge" bigint;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD COLUMN "courier_area" jsonb;--> statement-breakpoint
ALTER TABLE "ref"."courier_area_map" ADD CONSTRAINT "courier_area_map_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "ref"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."courier_area_map" ADD CONSTRAINT "courier_area_map_place_fk" FOREIGN KEY ("courier","kind","external_id") REFERENCES "ref"."courier_areas"("courier","kind","external_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."courier_payout_lines" ADD CONSTRAINT "courier_payout_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."courier_payout_lines" ADD CONSTRAINT "courier_payout_lines_payout_fk" FOREIGN KEY ("tenant_id","payout_id") REFERENCES "store"."courier_payouts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."courier_payout_lines" ADD CONSTRAINT "courier_payout_lines_shipment_fk" FOREIGN KEY ("tenant_id","shipment_id") REFERENCES "store"."shipments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."courier_payouts" ADD CONSTRAINT "courier_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipment_events" ADD CONSTRAINT "shipment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipment_events" ADD CONSTRAINT "shipment_events_shipment_fk" FOREIGN KEY ("tenant_id","shipment_id") REFERENCES "store"."shipments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_areas_parent_idx" ON "ref"."courier_areas" USING btree ("courier","kind","parent_id");--> statement-breakpoint
CREATE INDEX "courier_areas_name_trgm_idx" ON "ref"."courier_areas" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "courier_payout_lines_shipment_unique" ON "store"."courier_payout_lines" USING btree ("tenant_id","shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_payouts_reference_unique" ON "store"."courier_payouts" USING btree ("tenant_id","courier","reference");--> statement-breakpoint
CREATE INDEX "courier_payouts_paid_idx" ON "store"."courier_payouts" USING btree ("tenant_id","courier","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_events_unique" ON "store"."shipment_events" USING btree ("tenant_id","shipment_id","courier_status","courier_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_courier_ref_unique" ON "store"."shipments" USING btree ("tenant_id","courier","courier_ref") WHERE courier_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_consignment_unique" ON "store"."shipments" USING btree ("tenant_id","courier","consignment_id") WHERE consignment_id is not null;--> statement-breakpoint
CREATE INDEX "shipments_courier_open_idx" ON "store"."shipments" USING btree ("last_synced_at") WHERE courier is not null and status in ('booked', 'shipped', 'in_transit', 'failed');--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_kind_valid" CHECK ("store"."provider_credentials"."kind" in ('sslcommerz', 'sms', 'email', 'steadfast', 'pathao', 'redx', 'fake'));--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_provider_valid" CHECK ("store"."provider_credentials"."provider" in ('sslcommerz', 'sms_net_bd', 'bulksmsbd', 'sms_http', 'resend', 'brevo', 'steadfast', 'pathao', 'redx', 'fake'));--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_kind_provider" CHECK (case "store"."provider_credentials"."kind"
        when 'sslcommerz' then "store"."provider_credentials"."provider" = 'sslcommerz' and "store"."provider_credentials"."mode" is not null
        when 'sms' then "store"."provider_credentials"."provider" in ('sms_net_bd', 'bulksmsbd', 'sms_http') and "store"."provider_credentials"."mode" is null
        when 'email' then "store"."provider_credentials"."provider" in ('resend', 'brevo') and "store"."provider_credentials"."mode" is null
        else "store"."provider_credentials"."provider" = "store"."provider_credentials"."kind" end);--> statement-breakpoint
ALTER TABLE "store"."provider_credentials" ADD CONSTRAINT "provider_credentials_ciphertext_size" CHECK (octet_length("store"."provider_credentials"."ciphertext") <= 8192);--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_flags_valid" CHECK ("store"."orders"."flags" <@ array['payment_risk', 'late_payment', 'flagged_phone', 'possible_duplicate', 'unreachable', 'cod_difference', 'partial_delivery']::text[]);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_valid" CHECK ("store"."shipments"."courier" in ('steadfast', 'pathao', 'redx', 'fake'));--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_booking_state_valid" CHECK ("store"."shipments"."booking_state" in ('booking', 'unsure'));--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_fields" CHECK ("store"."shipments"."courier" is not null or ("store"."shipments"."courier_ref" is null and "store"."shipments"."consignment_id" is null and "store"."shipments"."booking_state" is null));--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_ref_length" CHECK (char_length("store"."shipments"."courier_ref") <= 60);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_consignment_length" CHECK (char_length("store"."shipments"."consignment_id") <= 100);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_tracking_code_length" CHECK (char_length("store"."shipments"."tracking_code") <= 100);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_status_length" CHECK (char_length("store"."shipments"."courier_status") <= 60);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_message_length" CHECK (char_length("store"."shipments"."courier_message") <= 500);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_booking_error_length" CHECK (char_length("store"."shipments"."booking_error") <= 300);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_money" CHECK (coalesce("store"."shipments"."cod_amount", 0) >= 0 and coalesce("store"."shipments"."cod_collected", 0) >= 0
          and coalesce("store"."shipments"."courier_fee", 0) >= 0 and coalesce("store"."shipments"."return_charge", 0) >= 0);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_courier_area_size" CHECK (octet_length("store"."shipments"."courier_area"::text) <= 1000);--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_status_valid" CHECK ("store"."shipments"."status" in ('pending', 'booked', 'shipped', 'in_transit', 'delivered', 'failed', 'returned'));--> statement-breakpoint
ALTER TABLE "store"."return_lines" ADD CONSTRAINT "return_lines_reason_valid" CHECK ("store"."return_lines"."reason" in ('wrong_size', 'damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other', 'refused_at_door'));--> statement-breakpoint
ALTER TABLE "store"."returns" ADD CONSTRAINT "returns_reason_valid" CHECK ("store"."returns"."reason" in ('wrong_size', 'damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other', 'refused_at_door'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."courier_payout_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."courier_payout_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."courier_payout_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."courier_payouts" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."courier_payouts"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."courier_payouts"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shipment_events" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shipment_events"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shipment_events"."tenant_id" = (select app.current_tenant_id()));