DROP INDEX "store"."product_tags_tag_trgm_idx";--> statement-breakpoint
DROP INDEX "store"."product_translations_title_trgm_idx";--> statement-breakpoint
CREATE INDEX "product_tags_search_trgm_idx" ON "store"."product_tags" USING gin ("tenant_id",app.search_text("tag") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_translations_search_trgm_idx" ON "store"."product_translations" USING gin ("tenant_id",app.search_text("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "variants_sku_trgm_idx" ON "store"."variants" USING gin ("tenant_id",lower("sku") gin_trgm_ops);