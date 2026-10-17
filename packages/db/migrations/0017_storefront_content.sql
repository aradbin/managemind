CREATE TABLE "store"."page_translations" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"page_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"body" jsonb,
	"seo_title" text,
	"seo_description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_translations_tenant_id_page_id_locale_pk" PRIMARY KEY("tenant_id","page_id","locale"),
	CONSTRAINT "page_translations_slug_unique" UNIQUE("tenant_id","locale","slug"),
	CONSTRAINT "page_translations_locale_valid" CHECK ("store"."page_translations"."locale" in ('bn', 'en')),
	CONSTRAINT "page_translations_title_length" CHECK (char_length("store"."page_translations"."title") between 1 and 120),
	CONSTRAINT "page_translations_slug_format" CHECK ("store"."page_translations"."slug" = lower("store"."page_translations"."slug") and char_length("store"."page_translations"."slug") between 1 and 120 and "store"."page_translations"."slug" !~ '(^-|-$|--|[[:space:]/?#%&])')
);
--> statement-breakpoint
ALTER TABLE "store"."page_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."pages" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pages_kind_valid" CHECK ("store"."pages"."kind" in ('about', 'contact', 'privacy', 'returns', 'delivery', 'terms', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "store"."pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store"."theme_media" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "theme_media_tenant_id_media_id_pk" PRIMARY KEY("tenant_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "store"."theme_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_domain_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" DROP CONSTRAINT "tenant_domains_hostname_unique";--> statement-breakpoint
ALTER TABLE "store"."slug_redirects" DROP CONSTRAINT "slug_redirects_entity_type_valid";--> statement-breakpoint
ALTER TABLE "store"."products" ADD COLUMN "price_min" bigint;--> statement-breakpoint
ALTER TABLE "store"."products" ADD COLUMN "price_max" bigint;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ADD COLUMN "ssl_status" text;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ADD COLUMN "ownership_record" jsonb;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ADD COLUMN "check_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "store"."page_translations" ADD CONSTRAINT "page_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."page_translations" ADD CONSTRAINT "page_translations_page_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "store"."pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."theme_media" ADD CONSTRAINT "theme_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."theme_media" ADD CONSTRAINT "theme_media_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "store"."media"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domain_history" ADD CONSTRAINT "tenant_domain_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domain_history" ADD CONSTRAINT "tenant_domain_history_domain_id_tenant_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "platform"."tenant_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_one_per_kind" ON "store"."pages" USING btree ("tenant_id","kind") WHERE kind <> 'custom';--> statement-breakpoint
CREATE INDEX "pages_tenant_position_idx" ON "store"."pages" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "tenant_domain_history_domain_idx" ON "platform"."tenant_domain_history" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "products_tenant_status_price_idx" ON "store"."products" USING btree ("tenant_id","status","price_min");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_hostname_unique" ON "platform"."tenant_domains" USING btree ("hostname") WHERE status <> 'removed';--> statement-breakpoint
ALTER TABLE "store"."products" ADD CONSTRAINT "products_price_range" CHECK ("store"."products"."price_min" <= "store"."products"."price_max");--> statement-breakpoint
ALTER TABLE "store"."slug_redirects" ADD CONSTRAINT "slug_redirects_entity_type_valid" CHECK ("store"."slug_redirects"."entity_type" in ('product', 'category', 'collection', 'page'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."page_translations" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."page_translations"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."page_translations"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."pages" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."pages"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."pages"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."theme_media" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."theme_media"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."theme_media"."tenant_id" = (select app.current_tenant_id()));