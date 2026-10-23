ALTER TABLE "store"."promotions" ADD COLUMN "credit_order_id" uuid;--> statement-breakpoint
ALTER TABLE "store"."promotions" ADD COLUMN "credit_parent_id" uuid;--> statement-breakpoint
CREATE INDEX "promotions_credit_parent_idx" ON "store"."promotions" USING btree ("tenant_id","credit_parent_id");