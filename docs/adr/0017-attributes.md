# ADR 0017: Product attributes, brand and tags

- Status: Accepted
- Date: 2026-10-15
- Plan: phase-2-plan §3.4 (added at the owner's request). Code: `packages/db/src/schema/catalog.ts`, `packages/shared/src/catalog/schemas.ts`

## Context

Clients need to describe products ("Fabric: Cotton", "RAM: 8 GB", "Origin: Bangladesh"), show those facts as specifications, and later let shoppers filter by them (Phase 3). Meta's product feed needs a brand. Staff want free labels to organize products.

PLAN.md's core principles say custom attributes use "a typed `metadata` JSON column, never ad-hoc columns per client". That rule guards against per-client schema changes. It doesn't fit data that has to be translated, typed and indexed for filters across every product of a store.

Every platform studied separates the two kinds of product data: options make variants; attributes describe the product (Shopify's metafields, Saleor's attributes, Vendure's facets, commercetools' product type attributes).

## Decision

1. **Attributes are rows, defined per store**: a stable Latin `key` (used by import columns and feeds), a type (choice, multiple choice, number, text, yes/no), names and units per language, and two flags, `filterable` (never for text) and `visible`.
2. **Choice values are defined once per attribute**, with a label per language, so "Cotton" is one value on every product and filters work. Labels are unique per attribute and language.
3. **Product values live in `product_attributes`**, one row per choice value, or one row with a number or yes/no; text values are per language in `product_attribute_translations`. The row repeats the attribute's type, and composite foreign keys make the database refuse a value of the wrong type, a value of another attribute, or anything from another store. Indexes on `(tenant_id, attribute_id, value_id)` and `(tenant_id, attribute_id, number_value)` serve filters.
4. **Product-level only.** Anything that differs between variants is an option. Per-variant attributes can be added later without changing these tables' meaning.
5. **Category templates** (`category_attributes`) list the attributes a category's products usually have. Nothing is required, so an unfilled attribute never blocks publishing.
6. **Brand is a built-in choice attribute** (`key = 'brand'`, filterable, shown) that every store gets from `app.create_store_defaults()`. A trigger refuses to delete it (except in a closed store's purge) and refuses to change any attribute's key, type or system flag.
7. **Tags** are free, untranslated staff labels in `product_tags`, normalized (NFC, trimmed, lowercased) and searchable by trigram.
8. **Option labels get normalized keys** (`name_key`, `label_key`, indexed), so Phase 3 can filter by "Colour: Red" across products while options stay per product.
9. **`metadata` stays**, for integration data shoppers never see.

## Consequences

- Filters, specifications and the product feed need no schema change per client. A new attribute is a row.
- An attribute's key and type are fixed after creation; changing a type means a new attribute and moving the values, which the admin can offer later.
- Limits (100 attributes per store, 500 values per attribute) are enforced by the services, not the database.
- Product writes touch more rows (values and translations), which the CPU step on previews measures.
