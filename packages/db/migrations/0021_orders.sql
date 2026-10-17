CREATE TABLE "store"."blocked_phones" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"phone" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_phones_tenant_id_phone_pk" PRIMARY KEY("tenant_id","phone"),
	CONSTRAINT "blocked_phones_phone_format" CHECK ("store"."blocked_phones"."phone" ~ '^\+8801[3-9][0-9]{8}$'),
	CONSTRAINT "blocked_phones_reason_length" CHECK (char_length("store"."blocked_phones"."reason") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "store"."blocked_phones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."customer_addresses" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"division_id" smallint NOT NULL,
	"district_id" smallint NOT NULL,
	"area_id" integer NOT NULL,
	"line" text NOT NULL,
	"label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_phone_format" CHECK ("store"."customer_addresses"."phone" ~ '^\+8801[3-9][0-9]{8}$'),
	CONSTRAINT "customer_addresses_name_length" CHECK (char_length("store"."customer_addresses"."name") between 1 and 100),
	CONSTRAINT "customer_addresses_line_length" CHECK (char_length("store"."customer_addresses"."line") between 1 and 250),
	CONSTRAINT "customer_addresses_label_length" CHECK (char_length("store"."customer_addresses"."label") <= 40)
);
--> statement-breakpoint
ALTER TABLE "store"."customer_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."customers" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"order_count" integer DEFAULT 0 NOT NULL,
	"total_spent" bigint DEFAULT 0 NOT NULL,
	"first_order_at" timestamp with time zone,
	"last_order_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_phone_format" CHECK ("store"."customers"."phone" ~ '^\+8801[3-9][0-9]{8}$'),
	CONSTRAINT "customers_name_length" CHECK (char_length("store"."customers"."name") between 1 and 100),
	CONSTRAINT "customers_email_length" CHECK (char_length("store"."customers"."email") <= 254),
	CONSTRAINT "customers_note_length" CHECK (char_length("store"."customers"."note") <= 2000),
	CONSTRAINT "customers_tags_count" CHECK (cardinality("store"."customers"."tags") <= 20),
	CONSTRAINT "customers_totals_non_negative" CHECK ("store"."customers"."order_count" >= 0 and "store"."customers"."total_spent" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shopper_accounts" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopper_accounts_provider_account_unique" UNIQUE("tenant_id","provider_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "store"."shopper_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shopper_sessions" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopper_sessions_token_unique" UNIQUE("tenant_id","token")
);
--> statement-breakpoint
ALTER TABLE "store"."shopper_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shopper_users" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopper_users_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "shopper_users_email_unique" UNIQUE("tenant_id","email"),
	CONSTRAINT "shopper_users_email_lowercase" CHECK ("store"."shopper_users"."email" = lower("store"."shopper_users"."email")),
	CONSTRAINT "shopper_users_phone_format" CHECK ("store"."shopper_users"."phone" ~ '^\+8801[3-9][0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE "store"."shopper_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shopper_verifications" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" text PRIMARY KEY DEFAULT uuidv7()::text NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store"."shopper_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."cart_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_lines_tenant_id_cart_id_variant_id_pk" PRIMARY KEY("tenant_id","cart_id","variant_id"),
	CONSTRAINT "cart_lines_quantity_range" CHECK ("store"."cart_lines"."quantity" between 1 and 999)
);
--> statement-breakpoint
ALTER TABLE "store"."cart_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."carts" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"shopper_user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"order_id" uuid,
	"locale" text DEFAULT 'bn' NOT NULL,
	"area_id" integer,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "carts_token_unique" UNIQUE("tenant_id","token_hash"),
	CONSTRAINT "carts_status_valid" CHECK ("store"."carts"."status" in ('active', 'converted')),
	CONSTRAINT "carts_locale_valid" CHECK ("store"."carts"."locale" in ('bn', 'en')),
	CONSTRAINT "carts_token_hash_format" CHECK ("store"."carts"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "carts_code_length" CHECK (char_length("store"."carts"."code") between 1 and 32)
);
--> statement-breakpoint
ALTER TABLE "store"."carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."counters" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"name" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "counters_tenant_id_name_pk" PRIMARY KEY("tenant_id","name"),
	CONSTRAINT "counters_name_valid" CHECK ("store"."counters"."name" in ('order_number'))
);
--> statement-breakpoint
ALTER TABLE "store"."counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."delivery_zone_areas" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"zone_id" uuid NOT NULL,
	"district_id" smallint,
	"area_id" integer,
	CONSTRAINT "delivery_zone_areas_one_place" CHECK (num_nonnulls("store"."delivery_zone_areas"."district_id", "store"."delivery_zone_areas"."area_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "store"."delivery_zone_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."delivery_zones" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" jsonb NOT NULL,
	"fee" bigint NOT NULL,
	"free_weight_grams" integer,
	"fee_per_extra_kg" bigint,
	"estimate" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "delivery_zones_amounts" CHECK ("store"."delivery_zones"."fee" >= 0 and coalesce("store"."delivery_zones"."fee_per_extra_kg", 0) >= 0 and coalesce("store"."delivery_zones"."free_weight_grams", 0) >= 0),
	CONSTRAINT "delivery_zones_weight_rule" CHECK (("store"."delivery_zones"."free_weight_grams" is null) = ("store"."delivery_zones"."fee_per_extra_kg" is null))
);
--> statement-breakpoint
ALTER TABLE "store"."delivery_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."order_adjustments" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"promotion_id" uuid,
	"code" text,
	"code_id" uuid,
	"title" jsonb NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_adjustments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_adjustments_kind_valid" CHECK ("store"."order_adjustments"."kind" in ('promotion', 'manual')),
	CONSTRAINT "order_adjustments_target_valid" CHECK ("store"."order_adjustments"."target" in ('items', 'order', 'delivery')),
	CONSTRAINT "order_adjustments_amount_positive" CHECK ("store"."order_adjustments"."amount" > 0),
	CONSTRAINT "order_adjustments_promotion_kind" CHECK (("store"."order_adjustments"."kind" = 'promotion') = ("store"."order_adjustments"."promotion_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "store"."order_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."order_history" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"machine" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"event" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_history_machine_valid" CHECK ("store"."order_history"."machine" in ('order', 'payment', 'delivery', 'shipment', 'edit')),
	CONSTRAINT "order_history_actor_type_valid" CHECK ("store"."order_history"."actor_type" in ('staff', 'platform', 'system', 'shopper')),
	CONSTRAINT "order_history_event_length" CHECK (char_length("store"."order_history"."event") between 1 and 50),
	CONSTRAINT "order_history_reason_length" CHECK (char_length("store"."order_history"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."order_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."order_line_adjustments" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "order_line_adjustments_tenant_id_order_line_id_adjustment_id_pk" PRIMARY KEY("tenant_id","order_line_id","adjustment_id"),
	CONSTRAINT "order_line_adjustments_amount_positive" CHECK ("store"."order_line_adjustments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "store"."order_line_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."order_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"title" jsonb NOT NULL,
	"option_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sku" text,
	"image" jsonb,
	"unit_price" bigint NOT NULL,
	"compare_at_price" bigint,
	"cost_price" bigint,
	"weight_grams" integer,
	"vat_category" text,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"quantity" integer NOT NULL,
	"line_subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"vat_amount" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint NOT NULL,
	"shipped_quantity" integer DEFAULT 0 NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_lines_quantity_positive" CHECK ("store"."order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_shipped_range" CHECK ("store"."order_lines"."shipped_quantity" between 0 and "store"."order_lines"."quantity"),
	CONSTRAINT "order_lines_amounts" CHECK ("store"."order_lines"."unit_price" >= 0 and "store"."order_lines"."line_subtotal" >= 0 and "store"."order_lines"."discount_total" between 0 and "store"."order_lines"."line_subtotal"
        and "store"."order_lines"."vat_amount" >= 0 and "store"."order_lines"."line_total" >= 0 and "store"."order_lines"."vat_rate_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "store"."order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."order_notes" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_notes_body_length" CHECK (char_length("store"."order_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "store"."order_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."orders" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"delivery_status" text DEFAULT 'not_shipped' NOT NULL,
	"return_status" text DEFAULT 'none' NOT NULL,
	"source" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"shopper_user_id" uuid,
	"phone" text NOT NULL,
	"contact" jsonb NOT NULL,
	"address" jsonb,
	"zone_id" uuid,
	"zone_name" jsonb,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"delivery_fee" bigint DEFAULT 0 NOT NULL,
	"delivery_discount" bigint DEFAULT 0 NOT NULL,
	"vat_total" bigint DEFAULT 0 NOT NULL,
	"vat_included" boolean DEFAULT true NOT NULL,
	"rounding" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"paid_total" bigint DEFAULT 0 NOT NULL,
	"locale" text NOT NULL,
	"customer_note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_by" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "orders_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "orders_status_valid" CHECK ("store"."orders"."status" in ('pending', 'confirmed', 'processing', 'completed', 'cancelled')),
	CONSTRAINT "orders_payment_status_valid" CHECK ("store"."orders"."payment_status" in ('unpaid', 'partially_paid', 'paid')),
	CONSTRAINT "orders_delivery_status_valid" CHECK ("store"."orders"."delivery_status" in ('not_shipped', 'partially_shipped', 'shipped', 'delivered', 'failed')),
	CONSTRAINT "orders_return_status_valid" CHECK ("store"."orders"."return_status" in ('none')),
	CONSTRAINT "orders_source_valid" CHECK ("store"."orders"."source" in ('website', 'facebook', 'phone', 'walk_in', 'other')),
	CONSTRAINT "orders_cancelled_by_valid" CHECK ("store"."orders"."cancelled_by" in ('staff', 'platform', 'system', 'shopper')),
	CONSTRAINT "orders_number_positive" CHECK ("store"."orders"."number" > 0),
	CONSTRAINT "orders_locale_valid" CHECK ("store"."orders"."locale" in ('bn', 'en')),
	CONSTRAINT "orders_amounts_non_negative" CHECK ("store"."orders"."subtotal" >= 0 and "store"."orders"."discount_total" >= 0 and "store"."orders"."delivery_fee" >= 0 and "store"."orders"."delivery_discount" >= 0
        and "store"."orders"."vat_total" >= 0 and "store"."orders"."total" >= 0 and "store"."orders"."paid_total" >= 0
        and "store"."orders"."discount_total" <= "store"."orders"."subtotal" and "store"."orders"."delivery_discount" <= "store"."orders"."delivery_fee"),
	CONSTRAINT "orders_customer_note_length" CHECK (char_length("store"."orders"."customer_note") <= 500),
	CONSTRAINT "orders_cancel_reason_length" CHECK (char_length("store"."orders"."cancel_reason") <= 300),
	CONSTRAINT "orders_tags_count" CHECK (cardinality("store"."orders"."tags") <= 20)
);
--> statement-breakpoint
ALTER TABLE "store"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."payments" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"recorded_by" uuid,
	"settled_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_provider_valid" CHECK ("store"."payments"."provider" in ('cod', 'manual')),
	CONSTRAINT "payments_method_valid" CHECK ("store"."payments"."method" in ('cod', 'bkash', 'nagad', 'rocket', 'bank', 'cash', 'other')),
	CONSTRAINT "payments_status_valid" CHECK ("store"."payments"."status" in ('pending', 'paid', 'voided', 'failed')),
	CONSTRAINT "payments_amount_non_negative" CHECK ("store"."payments"."amount" >= 0),
	CONSTRAINT "payments_reference_length" CHECK (char_length("store"."payments"."reference") <= 100),
	CONSTRAINT "payments_cod_method" CHECK (("store"."payments"."provider" = 'cod') = ("store"."payments"."method" = 'cod'))
);
--> statement-breakpoint
ALTER TABLE "store"."payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shipment_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "shipment_lines_tenant_id_shipment_id_order_line_id_pk" PRIMARY KEY("tenant_id","shipment_id","order_line_id"),
	CONSTRAINT "shipment_lines_quantity_positive" CHECK ("store"."shipment_lines"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "store"."shipment_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."shipments" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failed_reason" text,
	"returned_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "shipments_status_valid" CHECK ("store"."shipments"."status" in ('pending', 'shipped', 'delivered', 'failed', 'returned')),
	CONSTRAINT "shipments_carrier_length" CHECK (char_length("store"."shipments"."carrier") <= 60),
	CONSTRAINT "shipments_tracking_number_length" CHECK (char_length("store"."shipments"."tracking_number") <= 100),
	CONSTRAINT "shipments_tracking_url_format" CHECK (char_length("store"."shipments"."tracking_url") <= 500 and "store"."shipments"."tracking_url" ~ '^https?://'),
	CONSTRAINT "shipments_failed_reason_length" CHECK (char_length("store"."shipments"."failed_reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "store"."shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."promotion_codes" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"code" text NOT NULL,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_codes_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "promotion_codes_code_format" CHECK ("store"."promotion_codes"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$'),
	CONSTRAINT "promotion_codes_usage" CHECK ("store"."promotion_codes"."usage_count" >= 0 and ("store"."promotion_codes"."usage_limit" is null or "store"."promotion_codes"."usage_limit" > 0))
);
--> statement-breakpoint
ALTER TABLE "store"."promotion_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."promotion_customer_usage" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "promotion_customer_usage_tenant_id_promotion_id_phone_pk" PRIMARY KEY("tenant_id","promotion_id","phone"),
	CONSTRAINT "promotion_customer_usage_count" CHECK ("store"."promotion_customer_usage"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."promotion_customer_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."promotions" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" jsonb NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"exclusive" boolean DEFAULT false NOT NULL,
	"max_discount" bigint,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"per_customer_limit" integer,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "promotions_kind_valid" CHECK ("store"."promotions"."kind" in ('automatic', 'code')),
	CONSTRAINT "promotions_status_valid" CHECK ("store"."promotions"."status" in ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "promotions_dates" CHECK ("store"."promotions"."ends_at" > "store"."promotions"."starts_at"),
	CONSTRAINT "promotions_usage" CHECK ("store"."promotions"."usage_count" >= 0 and ("store"."promotions"."usage_limit" is null or "store"."promotions"."usage_limit" > 0)),
	CONSTRAINT "promotions_max_discount_positive" CHECK ("store"."promotions"."max_discount" > 0),
	CONSTRAINT "promotions_json_objects" CHECK (jsonb_typeof("store"."promotions"."conditions") = 'object' and jsonb_typeof("store"."promotions"."action") = 'object')
);
--> statement-breakpoint
ALTER TABLE "store"."promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."import_jobs" DROP CONSTRAINT "import_jobs_kind_valid";--> statement-breakpoint
ALTER TABLE "store"."stock_movements" DROP CONSTRAINT "stock_movements_actor_type_valid";--> statement-breakpoint
ALTER TABLE "store"."audit_log" DROP CONSTRAINT "audit_log_actor_type_valid";--> statement-breakpoint
ALTER TABLE "store"."variants" ADD COLUMN "sale_price" bigint;--> statement-breakpoint
ALTER TABLE "store"."variants" ADD COLUMN "sale_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."variants" ADD COLUMN "sale_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."blocked_phones" ADD CONSTRAINT "blocked_phones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."customer_addresses" ADD CONSTRAINT "customer_addresses_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "store"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."customer_addresses" ADD CONSTRAINT "customer_addresses_area_fk" FOREIGN KEY ("district_id","area_id") REFERENCES "ref"."areas"("district_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_accounts" ADD CONSTRAINT "shopper_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_accounts" ADD CONSTRAINT "shopper_accounts_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "store"."shopper_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_sessions" ADD CONSTRAINT "shopper_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_sessions" ADD CONSTRAINT "shopper_sessions_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "store"."shopper_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_users" ADD CONSTRAINT "shopper_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_verifications" ADD CONSTRAINT "shopper_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."cart_lines" ADD CONSTRAINT "cart_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."cart_lines" ADD CONSTRAINT "cart_lines_cart_fk" FOREIGN KEY ("tenant_id","cart_id") REFERENCES "store"."carts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."cart_lines" ADD CONSTRAINT "cart_lines_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."carts" ADD CONSTRAINT "carts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."carts" ADD CONSTRAINT "carts_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "ref"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."carts" ADD CONSTRAINT "carts_shopper_fk" FOREIGN KEY ("tenant_id","shopper_user_id") REFERENCES "store"."shopper_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."counters" ADD CONSTRAINT "counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."delivery_zone_areas" ADD CONSTRAINT "delivery_zone_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."delivery_zone_areas" ADD CONSTRAINT "delivery_zone_areas_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "ref"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."delivery_zone_areas" ADD CONSTRAINT "delivery_zone_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "ref"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."delivery_zone_areas" ADD CONSTRAINT "delivery_zone_areas_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "store"."delivery_zones"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."delivery_zones" ADD CONSTRAINT "delivery_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_adjustments" ADD CONSTRAINT "order_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_adjustments" ADD CONSTRAINT "order_adjustments_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_adjustments" ADD CONSTRAINT "order_adjustments_promotion_fk" FOREIGN KEY ("tenant_id","promotion_id") REFERENCES "store"."promotions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_adjustments" ADD CONSTRAINT "order_adjustments_code_fk" FOREIGN KEY ("tenant_id","code_id") REFERENCES "store"."promotion_codes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_history" ADD CONSTRAINT "order_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_history" ADD CONSTRAINT "order_history_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_line_adjustments" ADD CONSTRAINT "order_line_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_line_adjustments" ADD CONSTRAINT "order_line_adjustments_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "store"."order_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_line_adjustments" ADD CONSTRAINT "order_line_adjustments_adjustment_fk" FOREIGN KEY ("tenant_id","adjustment_id") REFERENCES "store"."order_adjustments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_lines" ADD CONSTRAINT "order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_lines" ADD CONSTRAINT "order_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_lines" ADD CONSTRAINT "order_lines_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_lines" ADD CONSTRAINT "order_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_notes" ADD CONSTRAINT "order_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_notes" ADD CONSTRAINT "order_notes_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "store"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_shopper_fk" FOREIGN KEY ("tenant_id","shopper_user_id") REFERENCES "store"."shopper_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "store"."delivery_zones"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipment_lines" ADD CONSTRAINT "shipment_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_fk" FOREIGN KEY ("tenant_id","shipment_id") REFERENCES "store"."shipments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipment_lines" ADD CONSTRAINT "shipment_lines_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "store"."order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipments" ADD CONSTRAINT "shipments_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "store"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."promotion_codes" ADD CONSTRAINT "promotion_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."promotion_codes" ADD CONSTRAINT "promotion_codes_promotion_fk" FOREIGN KEY ("tenant_id","promotion_id") REFERENCES "store"."promotions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."promotion_customer_usage" ADD CONSTRAINT "promotion_customer_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."promotion_customer_usage" ADD CONSTRAINT "promotion_customer_usage_promotion_fk" FOREIGN KEY ("tenant_id","promotion_id") REFERENCES "store"."promotions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."promotions" ADD CONSTRAINT "promotions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "store"."customer_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_one_default" ON "store"."customer_addresses" USING btree ("tenant_id","customer_id") WHERE is_default;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_unique" ON "store"."customers" USING btree ("tenant_id","phone") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "store"."customers" USING gin ("tenant_id",app.search_text("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_tenant_last_order_idx" ON "store"."customers" USING btree ("tenant_id",last_order_at desc nulls last);--> statement-breakpoint
CREATE INDEX "shopper_accounts_user_idx" ON "store"."shopper_accounts" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "shopper_sessions_user_idx" ON "store"."shopper_sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "shopper_sessions_expires_idx" ON "store"."shopper_sessions" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "shopper_verifications_identifier_idx" ON "store"."shopper_verifications" USING btree ("tenant_id","identifier");--> statement-breakpoint
CREATE INDEX "shopper_verifications_expires_idx" ON "store"."shopper_verifications" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "cart_lines_variant_idx" ON "store"."cart_lines" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "carts_tenant_updated_idx" ON "store"."carts" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "carts_shopper_idx" ON "store"."carts" USING btree ("tenant_id","shopper_user_id") WHERE shopper_user_id is not null;--> statement-breakpoint
CREATE INDEX "delivery_zone_areas_zone_idx" ON "store"."delivery_zone_areas" USING btree ("tenant_id","zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zone_areas_district_unique" ON "store"."delivery_zone_areas" USING btree ("tenant_id","district_id") WHERE district_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zone_areas_area_unique" ON "store"."delivery_zone_areas" USING btree ("tenant_id","area_id") WHERE area_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_one_fallback" ON "store"."delivery_zones" USING btree ("tenant_id") WHERE is_fallback;--> statement-breakpoint
CREATE INDEX "delivery_zones_tenant_position_idx" ON "store"."delivery_zones" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "order_adjustments_order_idx" ON "store"."order_adjustments" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "order_adjustments_promotion_idx" ON "store"."order_adjustments" USING btree ("tenant_id","promotion_id") WHERE promotion_id is not null;--> statement-breakpoint
CREATE INDEX "order_history_order_idx" ON "store"."order_history" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_line_adjustments_adjustment_idx" ON "store"."order_line_adjustments" USING btree ("tenant_id","adjustment_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "store"."order_lines" USING btree ("tenant_id","order_id","position");--> statement-breakpoint
CREATE INDEX "order_lines_variant_idx" ON "store"."order_lines" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "order_notes_order_idx" ON "store"."order_notes" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_placed_idx" ON "store"."orders" USING btree ("tenant_id",placed_at desc);--> statement-breakpoint
CREATE INDEX "orders_tenant_status_idx" ON "store"."orders" USING btree ("tenant_id","status",placed_at desc);--> statement-breakpoint
CREATE INDEX "orders_tenant_delivery_idx" ON "store"."orders" USING btree ("tenant_id","delivery_status",placed_at desc);--> statement-breakpoint
CREATE INDEX "orders_tenant_customer_idx" ON "store"."orders" USING btree ("tenant_id","customer_id",placed_at desc);--> statement-breakpoint
CREATE INDEX "orders_tenant_phone_idx" ON "store"."orders" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "orders_shopper_idx" ON "store"."orders" USING btree ("tenant_id","shopper_user_id",placed_at desc) WHERE shopper_user_id is not null;--> statement-breakpoint
CREATE INDEX "orders_tags_idx" ON "store"."orders" USING gin ("tenant_id","tags");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "store"."payments" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "shipment_lines_line_idx" ON "store"."shipment_lines" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "store"."shipments" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "shipments_tenant_status_idx" ON "store"."shipments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_codes_code_unique" ON "store"."promotion_codes" USING btree ("tenant_id",upper(code));--> statement-breakpoint
CREATE INDEX "promotion_codes_promotion_idx" ON "store"."promotion_codes" USING btree ("tenant_id","promotion_id");--> statement-breakpoint
CREATE INDEX "promotions_tenant_status_idx" ON "store"."promotions" USING btree ("tenant_id","status","starts_at");--> statement-breakpoint
ALTER TABLE "store"."variants" ADD CONSTRAINT "variants_sale_valid" CHECK ("store"."variants"."sale_price" is null or ("store"."variants"."sale_price" >= 0 and "store"."variants"."sale_price" < "store"."variants"."price"
        and "store"."variants"."sale_starts_at" is not null and "store"."variants"."sale_ends_at" > "store"."variants"."sale_starts_at"));--> statement-breakpoint
ALTER TABLE "store"."import_jobs" ADD CONSTRAINT "import_jobs_kind_valid" CHECK ("store"."import_jobs"."kind" in ('products', 'customers'));--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ADD CONSTRAINT "stock_movements_actor_type_valid" CHECK ("store"."stock_movements"."actor_type" in ('staff', 'platform', 'system', 'shopper'));--> statement-breakpoint
ALTER TABLE "store"."audit_log" ADD CONSTRAINT "audit_log_actor_type_valid" CHECK (actor_type in ('staff', 'platform', 'system', 'shopper'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."blocked_phones" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."blocked_phones"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."blocked_phones"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."customer_addresses" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."customer_addresses"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."customer_addresses"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."customers" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."customers"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."customers"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shopper_accounts" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shopper_accounts"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shopper_accounts"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shopper_sessions" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shopper_sessions"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shopper_sessions"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shopper_users" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shopper_users"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shopper_users"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shopper_verifications" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shopper_verifications"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shopper_verifications"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."cart_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."cart_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."cart_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."carts" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."carts"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."carts"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."counters" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."counters"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."counters"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."delivery_zone_areas" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."delivery_zone_areas"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."delivery_zone_areas"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."delivery_zones" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."delivery_zones"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."delivery_zones"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."order_adjustments" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."order_adjustments"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."order_adjustments"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."order_history" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."order_history"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."order_history"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."order_line_adjustments" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."order_line_adjustments"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."order_line_adjustments"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."order_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."order_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."order_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."order_notes" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."order_notes"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."order_notes"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."orders" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."orders"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."orders"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."payments" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."payments"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."payments"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shipment_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shipment_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shipment_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shipments" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shipments"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shipments"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."promotion_codes" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."promotion_codes"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."promotion_codes"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."promotion_customer_usage" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."promotion_customer_usage"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."promotion_customer_usage"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."promotions" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."promotions"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."promotions"."tenant_id" = (select app.current_tenant_id()));