CREATE TABLE "store"."attribute_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	CONSTRAINT "attribute_translations_tenant_id_attribute_id_locale_pk" PRIMARY KEY("tenant_id","attribute_id","locale"),
	CONSTRAINT "attribute_translations_locale_valid" CHECK ("store"."attribute_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "attribute_translations_name_length" CHECK (char_length("store"."attribute_translations"."name") between 1 and 100),
	CONSTRAINT "attribute_translations_unit_length" CHECK (char_length("store"."attribute_translations"."unit") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "store"."attribute_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."attribute_value_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"value_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"label_key" text NOT NULL,
	CONSTRAINT "attribute_value_translations_tenant_id_value_id_locale_pk" PRIMARY KEY("tenant_id","value_id","locale"),
	CONSTRAINT "attribute_value_translations_label_unique" UNIQUE("tenant_id","attribute_id","locale","label_key"),
	CONSTRAINT "attribute_value_translations_locale_valid" CHECK ("store"."attribute_value_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "attribute_value_translations_label_length" CHECK (char_length("store"."attribute_value_translations"."label") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "store"."attribute_value_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."attribute_values" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attribute_values_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attribute_values_attribute_id_unique" UNIQUE("tenant_id","attribute_id","id")
);
--> statement-breakpoint
ALTER TABLE "store"."attribute_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."attributes" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"filterable" boolean DEFAULT false NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attributes_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attributes_tenant_id_type_unique" UNIQUE("tenant_id","id","type"),
	CONSTRAINT "attributes_key_unique" UNIQUE("tenant_id","key"),
	CONSTRAINT "attributes_type_valid" CHECK ("store"."attributes"."type" in ('choice', 'multi_choice', 'number', 'text', 'boolean')),
	CONSTRAINT "attributes_key_format" CHECK ("store"."attributes"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "attributes_text_not_filterable" CHECK (not ("store"."attributes"."filterable" and "store"."attributes"."type" = 'text'))
);
--> statement-breakpoint
ALTER TABLE "store"."attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."categories" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid,
	"depth" smallint DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "categories_depth_range" CHECK ("store"."categories"."depth" between 0 and 2),
	CONSTRAINT "categories_root_depth" CHECK (("store"."categories"."parent_id" is null) = ("store"."categories"."depth" = 0)),
	CONSTRAINT "categories_not_own_parent" CHECK ("store"."categories"."parent_id" is distinct from "store"."categories"."id")
);
--> statement-breakpoint
ALTER TABLE "store"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."category_attributes" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"category_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_attributes_tenant_id_category_id_attribute_id_pk" PRIMARY KEY("tenant_id","category_id","attribute_id")
);
--> statement-breakpoint
ALTER TABLE "store"."category_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."category_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_translations_tenant_id_category_id_locale_pk" PRIMARY KEY("tenant_id","category_id","locale"),
	CONSTRAINT "category_translations_slug_unique" UNIQUE("tenant_id","locale","slug"),
	CONSTRAINT "category_translations_locale_valid" CHECK ("store"."category_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "category_translations_name_length" CHECK (char_length("store"."category_translations"."name") between 1 and 100),
	CONSTRAINT "category_translations_slug_format" CHECK ("store"."category_translations"."slug" = lower("store"."category_translations"."slug") and char_length("store"."category_translations"."slug") between 1 and 120 and "store"."category_translations"."slug" !~ '(^-|-$|--|[[:space:]/?#%&])')
);
--> statement-breakpoint
ALTER TABLE "store"."category_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."collection_products" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_products_tenant_id_collection_id_product_id_pk" PRIMARY KEY("tenant_id","collection_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "store"."collection_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."collection_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"collection_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_translations_tenant_id_collection_id_locale_pk" PRIMARY KEY("tenant_id","collection_id","locale"),
	CONSTRAINT "collection_translations_slug_unique" UNIQUE("tenant_id","locale","slug"),
	CONSTRAINT "collection_translations_locale_valid" CHECK ("store"."collection_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "collection_translations_name_length" CHECK (char_length("store"."collection_translations"."name") between 1 and 100),
	CONSTRAINT "collection_translations_slug_format" CHECK ("store"."collection_translations"."slug" = lower("store"."collection_translations"."slug") and char_length("store"."collection_translations"."slug") between 1 and 120 and "store"."collection_translations"."slug" !~ '(^-|-$|--|[[:space:]/?#%&])')
);
--> statement-breakpoint
ALTER TABLE "store"."collection_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."collections" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"rules" jsonb,
	"sort" text DEFAULT 'manual' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "collections_kind_valid" CHECK ("store"."collections"."kind" in ('manual', 'rule')),
	CONSTRAINT "collections_sort_valid" CHECK ("store"."collections"."sort" in ('manual', 'newest', 'price_asc', 'price_desc', 'title_asc')),
	CONSTRAINT "collections_rules_match_kind" CHECK (("store"."collections"."kind" = 'rule') = ("store"."collections"."rules" is not null) and not ("store"."collections"."kind" = 'rule' and "store"."collections"."sort" = 'manual'))
);
--> statement-breakpoint
ALTER TABLE "store"."collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_attribute_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"product_attribute_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "product_attribute_translations_tenant_id_product_attribute_id_locale_pk" PRIMARY KEY("tenant_id","product_attribute_id","locale"),
	CONSTRAINT "product_attribute_translations_locale_valid" CHECK ("store"."product_attribute_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "product_attribute_translations_text_length" CHECK (char_length("store"."product_attribute_translations"."text") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "store"."product_attribute_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_attributes" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"attribute_type" text NOT NULL,
	"value_id" uuid,
	"number_value" numeric,
	"boolean_value" boolean,
	CONSTRAINT "product_attributes_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_attributes_value_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","product_id","attribute_id","value_id"),
	CONSTRAINT "product_attributes_value_matches_type" CHECK (case "store"."product_attributes"."attribute_type"
        when 'choice' then "store"."product_attributes"."value_id" is not null and "store"."product_attributes"."number_value" is null and "store"."product_attributes"."boolean_value" is null
        when 'multi_choice' then "store"."product_attributes"."value_id" is not null and "store"."product_attributes"."number_value" is null and "store"."product_attributes"."boolean_value" is null
        when 'number' then "store"."product_attributes"."value_id" is null and "store"."product_attributes"."number_value" is not null and "store"."product_attributes"."boolean_value" is null
        when 'boolean' then "store"."product_attributes"."value_id" is null and "store"."product_attributes"."number_value" is null and "store"."product_attributes"."boolean_value" is not null
        when 'text' then "store"."product_attributes"."value_id" is null and "store"."product_attributes"."number_value" is null and "store"."product_attributes"."boolean_value" is null
        else false end)
);
--> statement-breakpoint
ALTER TABLE "store"."product_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_categories" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_categories_tenant_id_product_id_category_id_pk" PRIMARY KEY("tenant_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "store"."product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_option_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"option_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	CONSTRAINT "product_option_translations_tenant_id_option_id_locale_pk" PRIMARY KEY("tenant_id","option_id","locale"),
	CONSTRAINT "product_option_translations_locale_valid" CHECK ("store"."product_option_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "product_option_translations_name_length" CHECK (char_length("store"."product_option_translations"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "store"."product_option_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_option_value_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"value_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"label_key" text NOT NULL,
	CONSTRAINT "product_option_value_translations_tenant_id_value_id_locale_pk" PRIMARY KEY("tenant_id","value_id","locale"),
	CONSTRAINT "product_option_value_translations_locale_valid" CHECK ("store"."product_option_value_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "product_option_value_translations_label_length" CHECK (char_length("store"."product_option_value_translations"."label") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "store"."product_option_value_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_option_values" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"option_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "product_option_values_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_option_values_position_range" CHECK ("store"."product_option_values"."position" between 0 and 99)
);
--> statement-breakpoint
ALTER TABLE "store"."product_option_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_options" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "product_options_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_options_position_range" CHECK ("store"."product_options"."position" between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "store"."product_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_tags" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"product_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "product_tags_tenant_id_product_id_tag_pk" PRIMARY KEY("tenant_id","product_id","tag"),
	CONSTRAINT "product_tags_tag_length" CHECK (char_length("store"."product_tags"."tag") between 1 and 50),
	CONSTRAINT "product_tags_tag_normalized" CHECK ("store"."product_tags"."tag" = lower(btrim("store"."product_tags"."tag")))
);
--> statement-breakpoint
ALTER TABLE "store"."product_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."product_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" jsonb,
	"seo_title" text,
	"seo_description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_translations_tenant_id_product_id_locale_pk" PRIMARY KEY("tenant_id","product_id","locale"),
	CONSTRAINT "product_translations_slug_unique" UNIQUE("tenant_id","locale","slug"),
	CONSTRAINT "product_translations_locale_valid" CHECK ("store"."product_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "product_translations_title_length" CHECK (char_length("store"."product_translations"."title") between 1 and 200),
	CONSTRAINT "product_translations_slug_format" CHECK ("store"."product_translations"."slug" = lower("store"."product_translations"."slug") and char_length("store"."product_translations"."slug") between 1 and 120 and "store"."product_translations"."slug" !~ '(^-|-$|--|[[:space:]/?#%&])')
);
--> statement-breakpoint
ALTER TABLE "store"."product_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."products" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"vat_category" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_status_valid" CHECK ("store"."products"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "products_metadata_object" CHECK (jsonb_typeof("store"."products"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "store"."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."slug_redirects" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_type" text NOT NULL,
	"locale" text NOT NULL,
	"from_slug" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slug_redirects_from_unique" UNIQUE("tenant_id","entity_type","locale","from_slug"),
	CONSTRAINT "slug_redirects_entity_type_valid" CHECK ("store"."slug_redirects"."entity_type" in ('product', 'category', 'collection')),
	CONSTRAINT "slug_redirects_locale_valid" CHECK ("store"."slug_redirects"."locale" in ('bn', 'en'))
);
--> statement-breakpoint
ALTER TABLE "store"."slug_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."variant_option_values" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"variant_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	CONSTRAINT "variant_option_values_tenant_id_variant_id_value_id_pk" PRIMARY KEY("tenant_id","variant_id","value_id")
);
--> statement-breakpoint
ALTER TABLE "store"."variant_option_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."variants" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"options_key" text NOT NULL,
	"sku" text,
	"barcode" text,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"cost_price" bigint,
	"weight_grams" integer,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"allow_backorder" boolean DEFAULT false NOT NULL,
	"low_stock_threshold" integer,
	"position" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "variants_amounts_non_negative" CHECK ("store"."variants"."price" >= 0 and coalesce("store"."variants"."compare_at_price", 0) >= 0 and coalesce("store"."variants"."cost_price", 0) >= 0),
	CONSTRAINT "variants_counts_non_negative" CHECK (coalesce("store"."variants"."weight_grams", 0) >= 0 and coalesce("store"."variants"."low_stock_threshold", 0) >= 0),
	CONSTRAINT "variants_sku_length" CHECK (char_length("store"."variants"."sku") between 1 and 64),
	CONSTRAINT "variants_barcode_length" CHECK (char_length("store"."variants"."barcode") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "store"."variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."attribute_translations" ADD CONSTRAINT "attribute_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."attribute_translations" ADD CONSTRAINT "attribute_translations_attribute_fk" FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "store"."attributes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."attribute_value_translations" ADD CONSTRAINT "attribute_value_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."attribute_value_translations" ADD CONSTRAINT "attribute_value_translations_value_fk" FOREIGN KEY ("tenant_id","attribute_id","value_id") REFERENCES "store"."attribute_values"("tenant_id","attribute_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."attribute_values" ADD CONSTRAINT "attribute_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."attribute_values" ADD CONSTRAINT "attribute_values_attribute_fk" FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "store"."attributes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."attributes" ADD CONSTRAINT "attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "store"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."category_attributes" ADD CONSTRAINT "category_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."category_attributes" ADD CONSTRAINT "category_attributes_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "store"."categories"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."category_attributes" ADD CONSTRAINT "category_attributes_attribute_fk" FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "store"."attributes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."category_translations" ADD CONSTRAINT "category_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."category_translations" ADD CONSTRAINT "category_translations_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "store"."categories"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."collection_products" ADD CONSTRAINT "collection_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."collection_products" ADD CONSTRAINT "collection_products_collection_fk" FOREIGN KEY ("tenant_id","collection_id") REFERENCES "store"."collections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."collection_products" ADD CONSTRAINT "collection_products_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."collection_translations" ADD CONSTRAINT "collection_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."collection_translations" ADD CONSTRAINT "collection_translations_collection_fk" FOREIGN KEY ("tenant_id","collection_id") REFERENCES "store"."collections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."collections" ADD CONSTRAINT "collections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_attribute_translations" ADD CONSTRAINT "product_attribute_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_attribute_translations" ADD CONSTRAINT "product_attribute_translations_attribute_fk" FOREIGN KEY ("tenant_id","product_attribute_id") REFERENCES "store"."product_attributes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_attributes" ADD CONSTRAINT "product_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_attributes" ADD CONSTRAINT "product_attributes_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_attributes" ADD CONSTRAINT "product_attributes_attribute_fk" FOREIGN KEY ("tenant_id","attribute_id","attribute_type") REFERENCES "store"."attributes"("tenant_id","id","type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_attributes" ADD CONSTRAINT "product_attributes_value_fk" FOREIGN KEY ("tenant_id","attribute_id","value_id") REFERENCES "store"."attribute_values"("tenant_id","attribute_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_categories" ADD CONSTRAINT "product_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_categories" ADD CONSTRAINT "product_categories_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_categories" ADD CONSTRAINT "product_categories_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "store"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_option_translations" ADD CONSTRAINT "product_option_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_option_translations" ADD CONSTRAINT "product_option_translations_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "store"."product_options"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_option_value_translations" ADD CONSTRAINT "product_option_value_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_option_value_translations" ADD CONSTRAINT "product_option_value_translations_value_fk" FOREIGN KEY ("tenant_id","value_id") REFERENCES "store"."product_option_values"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_option_values" ADD CONSTRAINT "product_option_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_option_values" ADD CONSTRAINT "product_option_values_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "store"."product_options"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_options" ADD CONSTRAINT "product_options_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_options" ADD CONSTRAINT "product_options_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_tags" ADD CONSTRAINT "product_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_tags" ADD CONSTRAINT "product_tags_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_translations" ADD CONSTRAINT "product_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_translations" ADD CONSTRAINT "product_translations_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."slug_redirects" ADD CONSTRAINT "slug_redirects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."variant_option_values" ADD CONSTRAINT "variant_option_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."variant_option_values" ADD CONSTRAINT "variant_option_values_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."variant_option_values" ADD CONSTRAINT "variant_option_values_value_fk" FOREIGN KEY ("tenant_id","value_id") REFERENCES "store"."product_option_values"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."variants" ADD CONSTRAINT "variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."variants" ADD CONSTRAINT "variants_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribute_values_order_idx" ON "store"."attribute_values" USING btree ("tenant_id","attribute_id","position");--> statement-breakpoint
CREATE INDEX "categories_tenant_parent_idx" ON "store"."categories" USING btree ("tenant_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "category_attributes_attribute_idx" ON "store"."category_attributes" USING btree ("tenant_id","attribute_id");--> statement-breakpoint
CREATE INDEX "collection_products_order_idx" ON "store"."collection_products" USING btree ("tenant_id","collection_id","position");--> statement-breakpoint
CREATE INDEX "collection_products_product_idx" ON "store"."collection_products" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "collections_tenant_created_idx" ON "store"."collections" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE UNIQUE INDEX "product_attributes_single_unique" ON "store"."product_attributes" USING btree ("tenant_id","product_id","attribute_id") WHERE attribute_type <> 'multi_choice';--> statement-breakpoint
CREATE INDEX "product_attributes_value_idx" ON "store"."product_attributes" USING btree ("tenant_id","attribute_id","value_id");--> statement-breakpoint
CREATE INDEX "product_attributes_number_idx" ON "store"."product_attributes" USING btree ("tenant_id","attribute_id","number_value");--> statement-breakpoint
CREATE INDEX "product_categories_category_idx" ON "store"."product_categories" USING btree ("tenant_id","category_id","position");--> statement-breakpoint
CREATE INDEX "product_option_translations_key_idx" ON "store"."product_option_translations" USING btree ("tenant_id","locale","name_key");--> statement-breakpoint
CREATE INDEX "product_option_value_translations_key_idx" ON "store"."product_option_value_translations" USING btree ("tenant_id","locale","label_key");--> statement-breakpoint
CREATE INDEX "product_option_values_tenant_option_idx" ON "store"."product_option_values" USING btree ("tenant_id","option_id","position");--> statement-breakpoint
CREATE INDEX "product_options_tenant_product_idx" ON "store"."product_options" USING btree ("tenant_id","product_id","position");--> statement-breakpoint
CREATE INDEX "product_tags_tag_idx" ON "store"."product_tags" USING btree ("tenant_id","tag");--> statement-breakpoint
CREATE INDEX "product_tags_tag_trgm_idx" ON "store"."product_tags" USING gin ("tenant_id","tag" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_translations_title_trgm_idx" ON "store"."product_translations" USING gin ("tenant_id","title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_tenant_status_created_idx" ON "store"."products" USING btree ("tenant_id","status",created_at desc);--> statement-breakpoint
CREATE INDEX "slug_redirects_entity_idx" ON "store"."slug_redirects" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "variant_option_values_value_idx" ON "store"."variant_option_values" USING btree ("tenant_id","value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku_unique" ON "store"."variants" USING btree ("tenant_id",lower(sku)) WHERE sku is not null and archived_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "variants_combination_unique" ON "store"."variants" USING btree ("tenant_id","product_id","options_key") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "variants_tenant_product_idx" ON "store"."variants" USING btree ("tenant_id","product_id","position");--> statement-breakpoint
CREATE INDEX "variants_tenant_barcode_idx" ON "store"."variants" USING btree ("tenant_id","barcode") WHERE barcode is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."attribute_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."attribute_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."attribute_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."attribute_value_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."attribute_value_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."attribute_value_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."attribute_values" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."attribute_values"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."attribute_values"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."attributes" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."attributes"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."attributes"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."categories" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."categories"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."categories"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."category_attributes" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."category_attributes"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."category_attributes"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."category_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."category_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."category_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."collection_products" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."collection_products"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."collection_products"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."collection_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."collection_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."collection_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."collections" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."collections"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."collections"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_attribute_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_attribute_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_attribute_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_attributes" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_attributes"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_attributes"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_categories" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_categories"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_categories"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_option_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_option_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_option_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_option_value_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_option_value_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_option_value_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_option_values" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_option_values"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_option_values"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_options" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_options"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_options"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_tags" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_tags"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_tags"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."products" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."products"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."products"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."slug_redirects" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."slug_redirects"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."slug_redirects"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."variant_option_values" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."variant_option_values"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."variant_option_values"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."variants" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."variants"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."variants"."tenant_id" = (select app.current_tenant_id()));