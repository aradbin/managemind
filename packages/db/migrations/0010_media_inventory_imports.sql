CREATE TABLE "store"."product_media" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"product_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "product_media_tenant_id_product_id_media_id_pk" PRIMARY KEY("tenant_id","product_id","media_id"),
	CONSTRAINT "product_media_position_range" CHECK ("store"."product_media"."position" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "store"."product_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."import_errors" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"field" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	CONSTRAINT "import_errors_message_length" CHECK (char_length("store"."import_errors"."message") <= 500)
);
--> statement-breakpoint
ALTER TABLE "store"."import_errors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."import_images" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"url" text NOT NULL,
	"position" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"media_id" uuid,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_images_status_valid" CHECK ("store"."import_images"."status" in ('pending', 'done', 'failed')),
	CONSTRAINT "import_images_url_length" CHECK (char_length("store"."import_images"."url") between 1 and 2048),
	CONSTRAINT "import_images_position_range" CHECK ("store"."import_images"."position" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "store"."import_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."import_jobs" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text DEFAULT 'products' NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"file_name" text NOT NULL,
	"chunk_count" integer NOT NULL,
	"next_chunk" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_jobs_kind_valid" CHECK ("store"."import_jobs"."kind" in ('products')),
	CONSTRAINT "import_jobs_status_valid" CHECK ("store"."import_jobs"."status" in ('staging', 'running', 'images', 'done', 'failed', 'cancelled')),
	CONSTRAINT "import_jobs_counts_valid" CHECK ("store"."import_jobs"."chunk_count" between 1 and 1000 and "store"."import_jobs"."next_chunk" between 0 and "store"."import_jobs"."chunk_count"
          and "store"."import_jobs"."processed" <= "store"."import_jobs"."total" and "store"."import_jobs"."created" + "store"."import_jobs"."updated" + "store"."import_jobs"."failed" <= "store"."import_jobs"."processed"),
	CONSTRAINT "import_jobs_file_name_length" CHECK (char_length("store"."import_jobs"."file_name") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "store"."import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."inventory_levels" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_levels_tenant_id_variant_id_location_id_pk" PRIMARY KEY("tenant_id","variant_id","location_id"),
	CONSTRAINT "inventory_levels_reserved_non_negative" CHECK ("store"."inventory_levels"."reserved" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."inventory_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."stock_locations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_locations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_locations_name_length" CHECK (char_length("store"."stock_locations"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "store"."stock_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."stock_movements" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"reference_type" text,
	"reference_id" uuid,
	"idempotency_key" text,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_type_sign" CHECK (case "store"."stock_movements"."type"
        when 'receive' then "store"."stock_movements"."quantity" > 0
        when 'return' then "store"."stock_movements"."quantity" > 0
        when 'sale' then "store"."stock_movements"."quantity" < 0
        when 'reservation' then "store"."stock_movements"."quantity" > 0
        when 'release' then "store"."stock_movements"."quantity" < 0
        when 'adjustment' then "store"."stock_movements"."quantity" <> 0
        else false end),
	CONSTRAINT "stock_movements_actor_type_valid" CHECK ("store"."stock_movements"."actor_type" in ('staff', 'platform', 'system')),
	CONSTRAINT "stock_movements_reason_length" CHECK (char_length("store"."stock_movements"."reason") between 1 and 50),
	CONSTRAINT "stock_movements_note_length" CHECK (char_length("store"."stock_movements"."note") <= 500),
	CONSTRAINT "stock_movements_idempotency_key_length" CHECK (char_length("store"."stock_movements"."idempotency_key") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."media" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"files" jsonb NOT NULL,
	"unused_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "media_sha256_unique" UNIQUE("tenant_id","sha256"),
	CONSTRAINT "media_sha256_format" CHECK ("store"."media"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_mime_valid" CHECK ("store"."media"."mime" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "media_dimensions_positive" CHECK ("store"."media"."width" > 0 and "store"."media"."height" > 0),
	CONSTRAINT "media_files_array" CHECK (jsonb_typeof("store"."media"."files") = 'array')
);
--> statement-breakpoint
ALTER TABLE "store"."media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."media_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"media_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"alt" text NOT NULL,
	CONSTRAINT "media_translations_tenant_id_media_id_locale_pk" PRIMARY KEY("tenant_id","media_id","locale"),
	CONSTRAINT "media_translations_locale_valid" CHECK ("store"."media_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "media_translations_alt_length" CHECK (char_length("store"."media_translations"."alt") between 1 and 250)
);
--> statement-breakpoint
ALTER TABLE "store"."media_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."variants" ADD COLUMN "image_media_id" uuid;--> statement-breakpoint
ALTER TABLE "store"."product_media" ADD CONSTRAINT "product_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_media" ADD CONSTRAINT "product_media_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_media" ADD CONSTRAINT "product_media_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "store"."media"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_errors" ADD CONSTRAINT "import_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_errors" ADD CONSTRAINT "import_errors_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "store"."import_jobs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_images" ADD CONSTRAINT "import_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_images" ADD CONSTRAINT "import_images_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "store"."import_jobs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_images" ADD CONSTRAINT "import_images_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "store"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_images" ADD CONSTRAINT "import_images_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_images" ADD CONSTRAINT "import_images_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "store"."media"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."inventory_levels" ADD CONSTRAINT "inventory_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."inventory_levels" ADD CONSTRAINT "inventory_levels_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."inventory_levels" ADD CONSTRAINT "inventory_levels_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "store"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ADD CONSTRAINT "stock_movements_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "store"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."stock_movements" ADD CONSTRAINT "stock_movements_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "store"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."media" ADD CONSTRAINT "media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."media_translations" ADD CONSTRAINT "media_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."media_translations" ADD CONSTRAINT "media_translations_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "store"."media"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_media_order_idx" ON "store"."product_media" USING btree ("tenant_id","product_id","position");--> statement-breakpoint
CREATE INDEX "product_media_media_idx" ON "store"."product_media" USING btree ("tenant_id","media_id");--> statement-breakpoint
CREATE INDEX "import_errors_job_idx" ON "store"."import_errors" USING btree ("tenant_id","job_id","row");--> statement-breakpoint
CREATE INDEX "import_images_work_idx" ON "store"."import_images" USING btree ("tenant_id","job_id","status","row");--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created_idx" ON "store"."import_jobs" USING btree ("tenant_id",created_at desc);--> statement-breakpoint
CREATE INDEX "inventory_levels_location_idx" ON "store"."inventory_levels" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_locations_one_default" ON "store"."stock_locations" USING btree ("tenant_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "store"."stock_movements" USING btree ("tenant_id","variant_id","location_id",created_at desc);--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "store"."stock_movements" USING btree ("tenant_id","reference_type","reference_id") WHERE reference_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_idempotency_unique" ON "store"."stock_movements" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "media_unused_idx" ON "store"."media" USING btree ("tenant_id","unused_since") WHERE unused_since is not null;--> statement-breakpoint
ALTER TABLE "store"."variants" ADD CONSTRAINT "variants_image_fk" FOREIGN KEY ("tenant_id","image_media_id") REFERENCES "store"."media"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."product_media" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."product_media"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."product_media"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."import_errors" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."import_errors"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."import_errors"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."import_images" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."import_images"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."import_images"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."import_jobs" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."import_jobs"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."import_jobs"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."inventory_levels" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."inventory_levels"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."inventory_levels"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."stock_locations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."stock_locations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."stock_locations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."stock_movements" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."stock_movements"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."stock_movements"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."media" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."media"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."media"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."media_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."media_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."media_translations"."tenant_id" = (select app.current_tenant_id()));