-- Hand-written (phase-2-plan §4): extensions the catalog's indexes need,
-- created before the tables that use them. Both are trusted extensions, so
-- Neon's migration role can create them.
--   pg_trgm:   typo-tolerant search on Bangla and English titles and tags.
--   btree_gin: lets those GIN indexes start with tenant_id, like every other
--              store index (ADR 0009).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;
