ALTER TABLE "store"."customers" DROP CONSTRAINT "customers_phone_format";--> statement-breakpoint
ALTER TABLE "store"."customers" ADD CONSTRAINT "customers_phone_format" CHECK ("store"."customers"."phone" ~ '^\+8801[3-9][0-9]{8}$' or ("store"."customers"."deleted_at" is not null and "store"."customers"."phone" = '+8801000000000'));--> statement-breakpoint
-- A shopper's deletion request (phase-5b-plan §3.13) removes their delivery
-- log rows and their per-phone offer use; nothing else in the app deletes these.
GRANT DELETE ON store.messages, store.promotion_customer_usage TO app_rw;
