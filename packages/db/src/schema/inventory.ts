// Inventory (phase-2-plan §3.8): stock locations, levels per variant and
// location, and the append-only ledger. The inventory service is the only
// writer of levels and movements; a level is a cache of its movements' sum.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { variants } from './catalog';
import { ACTOR_TYPES } from './store';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const STOCK_MOVEMENT_TYPES = [
  'receive',
  'sale',
  'reservation',
  'release',
  'adjustment',
  'return',
] as const;

const ts = () => timestamp({ withTimezone: true });

export const stockLocations = store.table(
  'stock_locations',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    name: text().notNull(),
    isDefault: boolean().notNull().default(false),
    address: jsonb(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('stock_locations_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('stock_locations_one_default').on(t.tenantId).where(sql`is_default`),
    check('stock_locations_name_length', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

export const inventoryLevels = store.table(
  'inventory_levels',
  {
    ...tenantColumns(),
    variantId: uuid().notNull(),
    locationId: uuid().notNull(),
    /** Can go below zero only for variants that allow backorders. */
    onHand: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.variantId, t.locationId] }),
    // A draft without stock history can still be deleted; the ledger's own
    // reference (restrict) stops that once anything moved.
    foreignKey({
      name: 'inventory_levels_variant_fk',
      columns: [t.tenantId, t.variantId],
      foreignColumns: [variants.tenantId, variants.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inventory_levels_location_fk',
      columns: [t.tenantId, t.locationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete('restrict'),
    index('inventory_levels_location_idx').on(t.tenantId, t.locationId),
    check('inventory_levels_reserved_non_negative', sql`${t.reserved} >= 0`),
  ],
);

/**
 * The ledger: append-only for the app role (insert and select only). Each
 * type moves one column of the level, with a fixed sign (§3.8), so on hand
 * and reserved always equal their movements' sums.
 */
export const stockMovements = store.table(
  'stock_movements',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    variantId: uuid().notNull(),
    locationId: uuid().notNull(),
    type: text({ enum: STOCK_MOVEMENT_TYPES }).notNull(),
    /** Signed: what this movement added to its column. */
    quantity: integer().notNull(),
    /** Why: received, count, damaged, import, order, … */
    reason: text().notNull(),
    note: text(),
    referenceType: text(),
    referenceId: uuid(),
    /** Unique per store: a retried request or a redelivered import chunk writes nothing twice. */
    idempotencyKey: text(),
    /** The cost per unit it was valued at (phase-8-plan §3.4): receipts, adjustments, counts, returns. */
    unitCost: bigint({ mode: 'number' }),
    actorType: text({ enum: ACTOR_TYPES }).notNull(),
    actorId: uuid(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    foreignKey({
      name: 'stock_movements_variant_fk',
      columns: [t.tenantId, t.variantId],
      foreignColumns: [variants.tenantId, variants.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_location_fk',
      columns: [t.tenantId, t.locationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete('restrict'),
    index('stock_movements_variant_idx').on(
      t.tenantId,
      t.variantId,
      t.locationId,
      sql`created_at desc`,
    ),
    index('stock_movements_reference_idx')
      .on(t.tenantId, t.referenceType, t.referenceId)
      .where(sql`reference_id is not null`),
    uniqueIndex('stock_movements_idempotency_unique')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
    check(
      'stock_movements_type_sign',
      sql`case ${t.type}
        when 'receive' then ${t.quantity} > 0
        when 'return' then ${t.quantity} > 0
        when 'sale' then ${t.quantity} < 0
        when 'reservation' then ${t.quantity} > 0
        when 'release' then ${t.quantity} < 0
        when 'adjustment' then ${t.quantity} <> 0
        else false end`,
    ),
    check(
      'stock_movements_actor_type_valid',
      sql`${t.actorType} in (${sql.raw(ACTOR_TYPES.map((a) => `'${a}'`).join(', '))})`,
    ),
    check('stock_movements_reason_length', sql`char_length(${t.reason}) between 1 and 50`),
    check('stock_movements_note_length', sql`char_length(${t.note}) <= 500`),
    check('stock_movements_unit_cost', sql`coalesce(${t.unitCost}, 0) >= 0`),
    check(
      'stock_movements_idempotency_key_length',
      sql`char_length(${t.idempotencyKey}) between 1 and 255`,
    ),
  ],
);
