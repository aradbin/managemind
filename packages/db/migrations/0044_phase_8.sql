CREATE TABLE "store"."cost_changes" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"old_cost" bigint,
	"new_cost" bigint,
	"on_hand" integer NOT NULL,
	"source" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_changes_source_valid" CHECK ("store"."cost_changes"."source" in ('receipt', 'return', 'manual', 'import')),
	CONSTRAINT "cost_changes_actor_type_valid" CHECK ("store"."cost_changes"."actor_type" in ('staff', 'platform', 'system', 'shopper')),
	CONSTRAINT "cost_changes_money" CHECK (coalesce("store"."cost_changes"."old_cost", 0) >= 0 and coalesce("store"."cost_changes"."new_cost", 0) >= 0),
	CONSTRAINT "cost_changes_reference_type_length" CHECK (char_length("store"."cost_changes"."reference_type") <= 50)
);
--> statement-breakpoint
ALTER TABLE "store"."cost_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."daily_product_sales" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"day" date NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"net_sales" bigint DEFAULT 0 NOT NULL,
	"cogs" bigint DEFAULT 0 NOT NULL,
	"returned_units" integer DEFAULT 0 NOT NULL,
	"returns" bigint DEFAULT 0 NOT NULL,
	"returned_cogs" bigint DEFAULT 0 NOT NULL,
	"missing_cost_units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_product_sales_tenant_id_day_variant_id_pk" PRIMARY KEY("tenant_id","day","variant_id")
);
--> statement-breakpoint
ALTER TABLE "store"."daily_product_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."daily_sales" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"day" date NOT NULL,
	"orders_delivered" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"gross_sales" bigint DEFAULT 0 NOT NULL,
	"discounts" bigint DEFAULT 0 NOT NULL,
	"net_sales" bigint DEFAULT 0 NOT NULL,
	"vat" bigint DEFAULT 0 NOT NULL,
	"delivery_income" bigint DEFAULT 0 NOT NULL,
	"courier_fees" bigint DEFAULT 0 NOT NULL,
	"failed_delivery_costs" bigint DEFAULT 0 NOT NULL,
	"returned_units" integer DEFAULT 0 NOT NULL,
	"returns" bigint DEFAULT 0 NOT NULL,
	"cogs" bigint DEFAULT 0 NOT NULL,
	"returned_cogs" bigint DEFAULT 0 NOT NULL,
	"missing_cost_units" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_sales_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
ALTER TABLE "store"."daily_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."expense_categories" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text,
	"name" jsonb NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_categories_name_size" CHECK (octet_length("store"."expense_categories"."name"::text) <= 1000),
	CONSTRAINT "expense_categories_key_length" CHECK (char_length("store"."expense_categories"."key") <= 50)
);
--> statement-breakpoint
ALTER TABLE "store"."expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."expenses" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"spent_on" date NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"payee" text,
	"note" text,
	"receipt_media" jsonb,
	"recurring_expense_id" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "expenses_method_valid" CHECK ("store"."expenses"."method" in ('cash', 'bank', 'bkash', 'nagad', 'card', 'other')),
	CONSTRAINT "expenses_amount_positive" CHECK ("store"."expenses"."amount" > 0),
	CONSTRAINT "expenses_payee_length" CHECK (char_length("store"."expenses"."payee") <= 200),
	CONSTRAINT "expenses_note_length" CHECK (char_length("store"."expenses"."note") <= 1000),
	CONSTRAINT "expenses_receipt_valid" CHECK ("store"."expenses"."receipt_media" is null or (octet_length("store"."expenses"."receipt_media"::text) <= 500
          and ("store"."expenses"."receipt_media"->>'bytes')::int between 1 and 2097152
          and "store"."expenses"."receipt_media"->>'mimeType' in ('image/jpeg', 'image/png', 'image/webp')))
);
--> statement-breakpoint
ALTER TABLE "store"."expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."goods_receipt_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"landed_unit_cost" bigint NOT NULL,
	CONSTRAINT "goods_receipt_lines_tenant_id_goods_receipt_id_variant_id_pk" PRIMARY KEY("tenant_id","goods_receipt_id","variant_id"),
	CONSTRAINT "goods_receipt_lines_quantity_positive" CHECK ("store"."goods_receipt_lines"."quantity" > 0),
	CONSTRAINT "goods_receipt_lines_cost" CHECK ("store"."goods_receipt_lines"."unit_cost" >= 0 and "store"."goods_receipt_lines"."landed_unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."goods_receipt_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."goods_receipts" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer NOT NULL,
	"supplier_id" uuid,
	"purchase_order_id" uuid,
	"location_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"supplier_invoice" text,
	"other_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" bigint NOT NULL,
	"other_cost_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"note" text,
	"received_by" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "goods_receipts_number_positive" CHECK ("store"."goods_receipts"."number" > 0),
	CONSTRAINT "goods_receipts_invoice_length" CHECK (char_length("store"."goods_receipts"."supplier_invoice") <= 100),
	CONSTRAINT "goods_receipts_note_length" CHECK (char_length("store"."goods_receipts"."note") <= 1000),
	CONSTRAINT "goods_receipts_idempotency_key_length" CHECK (char_length("store"."goods_receipts"."idempotency_key") between 1 and 255),
	CONSTRAINT "goods_receipts_other_costs_valid" CHECK (jsonb_typeof("store"."goods_receipts"."other_costs") = 'array' and jsonb_array_length("store"."goods_receipts"."other_costs") <= 10 and octet_length("store"."goods_receipts"."other_costs"::text) <= 2000),
	CONSTRAINT "goods_receipts_money" CHECK ("store"."goods_receipts"."subtotal" >= 0 and "store"."goods_receipts"."other_cost_total" >= 0 and "store"."goods_receipts"."total" = "store"."goods_receipts"."subtotal" + "store"."goods_receipts"."other_cost_total"),
	CONSTRAINT "goods_receipts_order_has_supplier" CHECK ("store"."goods_receipts"."purchase_order_id" is null or "store"."goods_receipts"."supplier_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "store"."goods_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."monthly_stock_values" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"month" date NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" integer NOT NULL,
	"unit_cost" bigint,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "monthly_stock_values_tenant_id_month_variant_id_location_id_pk" PRIMARY KEY("tenant_id","month","variant_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "store"."monthly_stock_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."purchase_order_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_order_lines_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_lines_quantity" CHECK ("store"."purchase_order_lines"."quantity" > 0 and "store"."purchase_order_lines"."received_quantity" >= 0),
	CONSTRAINT "purchase_order_lines_cost" CHECK ("store"."purchase_order_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."purchase_orders" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer NOT NULL,
	"supplier_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_on" date,
	"supplier_ref" text,
	"note" text,
	"other_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"other_cost_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"placed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_orders_status_valid" CHECK ("store"."purchase_orders"."status" in ('draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled')),
	CONSTRAINT "purchase_orders_number_positive" CHECK ("store"."purchase_orders"."number" > 0),
	CONSTRAINT "purchase_orders_supplier_ref_length" CHECK (char_length("store"."purchase_orders"."supplier_ref") <= 100),
	CONSTRAINT "purchase_orders_note_length" CHECK (char_length("store"."purchase_orders"."note") <= 1000),
	CONSTRAINT "purchase_orders_other_costs_valid" CHECK (jsonb_typeof("store"."purchase_orders"."other_costs") = 'array' and jsonb_array_length("store"."purchase_orders"."other_costs") <= 10 and octet_length("store"."purchase_orders"."other_costs"::text) <= 2000),
	CONSTRAINT "purchase_orders_money" CHECK ("store"."purchase_orders"."subtotal" >= 0 and "store"."purchase_orders"."other_cost_total" >= 0 and "store"."purchase_orders"."total" = "store"."purchase_orders"."subtotal" + "store"."purchase_orders"."other_cost_total")
);
--> statement-breakpoint
ALTER TABLE "store"."purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."recurring_expenses" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"payee" text,
	"note" text,
	"cadence" text NOT NULL,
	"day" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"next_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expenses_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_expenses_method_valid" CHECK ("store"."recurring_expenses"."method" in ('cash', 'bank', 'bkash', 'nagad', 'card', 'other')),
	CONSTRAINT "recurring_expenses_cadence_valid" CHECK ("store"."recurring_expenses"."cadence" in ('monthly', 'weekly')),
	CONSTRAINT "recurring_expenses_day_valid" CHECK (case "store"."recurring_expenses"."cadence" when 'monthly' then "store"."recurring_expenses"."day" between 0 and 28
                            when 'weekly' then "store"."recurring_expenses"."day" between 1 and 7 else false end),
	CONSTRAINT "recurring_expenses_amount_positive" CHECK ("store"."recurring_expenses"."amount" > 0),
	CONSTRAINT "recurring_expenses_dates" CHECK ("store"."recurring_expenses"."ends_on" is null or "store"."recurring_expenses"."ends_on" >= "store"."recurring_expenses"."starts_on"),
	CONSTRAINT "recurring_expenses_payee_length" CHECK (char_length("store"."recurring_expenses"."payee") <= 200),
	CONSTRAINT "recurring_expenses_note_length" CHECK (char_length("store"."recurring_expenses"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "store"."recurring_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."stock_count_lines" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"counted" integer,
	"counted_at" timestamp with time zone,
	"counted_by" uuid,
	"expected_at_count" integer,
	"difference" integer,
	"unit_cost" bigint,
	"applied_at" timestamp with time zone,
	CONSTRAINT "stock_count_lines_tenant_id_stock_count_id_variant_id_pk" PRIMARY KEY("tenant_id","stock_count_id","variant_id"),
	CONSTRAINT "stock_count_lines_counted" CHECK (("store"."stock_count_lines"."counted" is null) = ("store"."stock_count_lines"."counted_at" is null) and coalesce("store"."stock_count_lines"."counted", 0) >= 0),
	CONSTRAINT "stock_count_lines_cost" CHECK (coalesce("store"."stock_count_lines"."unit_cost", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."stock_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."stock_counts" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'counting' NOT NULL,
	"scope" jsonb NOT NULL,
	"note" text,
	"line_count" integer DEFAULT 0 NOT NULL,
	"started_by" uuid,
	"submitted_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"apply_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_counts_status_valid" CHECK ("store"."stock_counts"."status" in ('counting', 'review', 'applying', 'applied', 'cancelled')),
	CONSTRAINT "stock_counts_number_positive" CHECK ("store"."stock_counts"."number" > 0),
	CONSTRAINT "stock_counts_scope_size" CHECK (octet_length("store"."stock_counts"."scope"::text) <= 80000),
	CONSTRAINT "stock_counts_note_length" CHECK (char_length("store"."stock_counts"."note") <= 500),
	CONSTRAINT "stock_counts_apply_error_length" CHECK (char_length("store"."stock_counts"."apply_error") <= 500),
	CONSTRAINT "stock_counts_line_count" CHECK ("store"."stock_counts"."line_count" between 0 and 2000)
);
--> statement-breakpoint
ALTER TABLE "store"."stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."supplier_payments" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"goods_receipt_id" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_payments_method_valid" CHECK ("store"."supplier_payments"."method" in ('cash', 'bank', 'bkash', 'nagad', 'card', 'other')),
	CONSTRAINT "supplier_payments_amount_positive" CHECK ("store"."supplier_payments"."amount" > 0),
	CONSTRAINT "supplier_payments_reference_length" CHECK (char_length("store"."supplier_payments"."reference") <= 100),
	CONSTRAINT "supplier_payments_note_length" CHECK (char_length("store"."supplier_payments"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "store"."supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."suppliers" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"email" text,
	"address" jsonb,
	"note" text,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_name_length" CHECK (char_length("store"."suppliers"."name") between 1 and 200),
	CONSTRAINT "suppliers_contact_name_length" CHECK (char_length("store"."suppliers"."contact_name") <= 200),
	CONSTRAINT "suppliers_phones_count" CHECK (cardinality("store"."suppliers"."phones") <= 3),
	CONSTRAINT "suppliers_email_length" CHECK (char_length("store"."suppliers"."email") <= 254),
	CONSTRAINT "suppliers_address_size" CHECK (octet_length("store"."suppliers"."address"::text) <= 1000),
	CONSTRAINT "suppliers_note_length" CHECK (char_length("store"."suppliers"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "store"."suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."counters" DROP CONSTRAINT "counters_name_valid";--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ADD COLUMN "unit_cost" bigint;--> statement-breakpoint
ALTER TABLE "store"."cost_changes" ADD CONSTRAINT "cost_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."cost_changes" ADD CONSTRAINT "cost_changes_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."daily_product_sales" ADD CONSTRAINT "daily_product_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."daily_product_sales" ADD CONSTRAINT "daily_product_sales_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."daily_product_sales" ADD CONSTRAINT "daily_product_sales_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."daily_sales" ADD CONSTRAINT "daily_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."expenses" ADD CONSTRAINT "expenses_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "store"."expense_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."expenses" ADD CONSTRAINT "expenses_recurring_fk" FOREIGN KEY ("tenant_id","recurring_expense_id") REFERENCES "store"."recurring_expenses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_fk" FOREIGN KEY ("tenant_id","goods_receipt_id") REFERENCES "store"."goods_receipts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_order_line_fk" FOREIGN KEY ("tenant_id","purchase_order_line_id") REFERENCES "store"."purchase_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "store"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipts" ADD CONSTRAINT "goods_receipts_order_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "store"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."goods_receipts" ADD CONSTRAINT "goods_receipts_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "store"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."monthly_stock_values" ADD CONSTRAINT "monthly_stock_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."monthly_stock_values" ADD CONSTRAINT "monthly_stock_values_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."monthly_stock_values" ADD CONSTRAINT "monthly_stock_values_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "store"."stock_locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "store"."purchase_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "store"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."purchase_orders" ADD CONSTRAINT "purchase_orders_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "store"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."recurring_expenses" ADD CONSTRAINT "recurring_expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "store"."expense_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_fk" FOREIGN KEY ("tenant_id","stock_count_id") REFERENCES "store"."stock_counts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_counts" ADD CONSTRAINT "stock_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_counts" ADD CONSTRAINT "stock_counts_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "store"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "store"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."supplier_payments" ADD CONSTRAINT "supplier_payments_receipt_fk" FOREIGN KEY ("tenant_id","goods_receipt_id") REFERENCES "store"."goods_receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_changes_variant_idx" ON "store"."cost_changes" USING btree ("tenant_id","variant_id",created_at desc);--> statement-breakpoint
CREATE INDEX "daily_product_sales_variant_idx" ON "store"."daily_product_sales" USING btree ("tenant_id","variant_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_key_unique" ON "store"."expense_categories" USING btree ("tenant_id","key") WHERE key is not null;--> statement-breakpoint
CREATE INDEX "expenses_spent_idx" ON "store"."expenses" USING btree ("tenant_id",spent_on desc);--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "store"."expenses" USING btree ("tenant_id","category_id","spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_unique" ON "store"."expenses" USING btree ("tenant_id","recurring_expense_id","spent_on") WHERE recurring_expense_id is not null;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_variant_idx" ON "store"."goods_receipt_lines" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_number_unique" ON "store"."goods_receipts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_idempotency_unique" ON "store"."goods_receipts" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "goods_receipts_supplier_idx" ON "store"."goods_receipts" USING btree ("tenant_id","supplier_id","received_on");--> statement-breakpoint
CREATE INDEX "goods_receipts_order_idx" ON "store"."goods_receipts" USING btree ("tenant_id","purchase_order_id") WHERE purchase_order_id is not null;--> statement-breakpoint
CREATE INDEX "goods_receipts_received_idx" ON "store"."goods_receipts" USING btree ("tenant_id",received_on desc);--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_variant_unique" ON "store"."purchase_order_lines" USING btree ("tenant_id","purchase_order_id","variant_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_variant_idx" ON "store"."purchase_order_lines" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_unique" ON "store"."purchase_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "store"."purchase_orders" USING btree ("tenant_id","status",created_at desc);--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "store"."purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_next_idx" ON "store"."recurring_expenses" USING btree ("tenant_id","next_on") WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_number_unique" ON "store"."stock_counts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "stock_counts_status_idx" ON "store"."stock_counts" USING btree ("tenant_id","status",created_at desc);--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "store"."supplier_payments" USING btree ("tenant_id","supplier_id","paid_on");--> statement-breakpoint
CREATE INDEX "suppliers_name_trgm_idx" ON "store"."suppliers" USING gin ("tenant_id",app.search_text("name") gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ADD CONSTRAINT "stock_movements_unit_cost" CHECK (coalesce("store"."stock_movements"."unit_cost", 0) >= 0);--> statement-breakpoint
ALTER TABLE "store"."counters" ADD CONSTRAINT "counters_name_valid" CHECK ("store"."counters"."name" in ('order_number', 'return_number', 'purchase_order_number', 'goods_receipt_number', 'stock_count_number'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."cost_changes" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."cost_changes"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."cost_changes"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."daily_product_sales" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."daily_product_sales"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."daily_product_sales"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."daily_sales" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."daily_sales"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."daily_sales"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."expense_categories" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."expense_categories"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."expense_categories"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."expenses" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."expenses"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."expenses"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."goods_receipt_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."goods_receipt_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."goods_receipt_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."goods_receipts" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."goods_receipts"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."goods_receipts"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."monthly_stock_values" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."monthly_stock_values"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."monthly_stock_values"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."purchase_order_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."purchase_order_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."purchase_order_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."purchase_orders" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."purchase_orders"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."purchase_orders"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."recurring_expenses" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."recurring_expenses"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."recurring_expenses"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."stock_count_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."stock_count_lines"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."stock_count_lines"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."stock_counts" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."stock_counts"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."stock_counts"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."supplier_payments" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."supplier_payments"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."supplier_payments"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."suppliers" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."suppliers"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."suppliers"."tenant_id" = (select app.current_tenant_id()));