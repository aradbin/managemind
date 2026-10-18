ALTER TABLE "store"."shopper_users" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "store"."shopper_users" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shopper_users_phone_number_unique" ON "store"."shopper_users" USING btree ("tenant_id","phone_number") WHERE phone_number is not null;--> statement-breakpoint
ALTER TABLE "store"."shopper_users" ADD CONSTRAINT "shopper_users_phone_number_format" CHECK ("store"."shopper_users"."phone_number" ~ '^\+8801[3-9][0-9]{8}$');