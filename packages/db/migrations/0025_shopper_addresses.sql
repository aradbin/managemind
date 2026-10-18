CREATE TABLE "store"."shopper_addresses" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
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
	CONSTRAINT "shopper_addresses_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "shopper_addresses_phone_format" CHECK ("store"."shopper_addresses"."phone" ~ '^\+8801[3-9][0-9]{8}$'),
	CONSTRAINT "shopper_addresses_name_length" CHECK (char_length("store"."shopper_addresses"."name") between 1 and 100),
	CONSTRAINT "shopper_addresses_line_length" CHECK (char_length("store"."shopper_addresses"."line") between 1 and 250),
	CONSTRAINT "shopper_addresses_label_length" CHECK (char_length("store"."shopper_addresses"."label") <= 40)
);
--> statement-breakpoint
ALTER TABLE "store"."shopper_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."shopper_addresses" ADD CONSTRAINT "shopper_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_addresses" ADD CONSTRAINT "shopper_addresses_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "store"."shopper_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shopper_addresses" ADD CONSTRAINT "shopper_addresses_area_fk" FOREIGN KEY ("district_id","area_id") REFERENCES "ref"."areas"("district_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopper_addresses_user_idx" ON "store"."shopper_addresses" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopper_addresses_one_default" ON "store"."shopper_addresses" USING btree ("tenant_id","user_id") WHERE is_default;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store"."shopper_addresses" AS PERMISSIVE FOR ALL TO "app_rw" USING ("store"."shopper_addresses"."tenant_id" = (select app.current_tenant_id())) WITH CHECK ("store"."shopper_addresses"."tenant_id" = (select app.current_tenant_id()));--> statement-breakpoint
ALTER TABLE store.shopper_addresses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.shopper_addresses TO app_rw;
--> statement-breakpoint
CREATE TRIGGER shopper_addresses_set_updated_at BEFORE UPDATE ON store.shopper_addresses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
