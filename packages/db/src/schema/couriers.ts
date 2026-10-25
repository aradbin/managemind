// Couriers (phase-7-plan §3.1, §3.6, §3.7, §4): each courier status we heard
// about a parcel, the payouts couriers send the store, and the couriers'
// own area lists with our areas matched to them. Shipments themselves, with
// their courier columns, are in orders.ts.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { COURIER_UPDATES, COURIERS, EVENT_SOURCES, shipments } from './orders';
import { areas, ref } from './ref';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const PAYOUT_SOURCES = ['courier', 'import', 'manual'] as const;
export const AREA_COURIERS = ['pathao', 'redx'] as const;
/** Pathao has cities, zones and areas; RedX has areas only. */
export const COURIER_AREA_KINDS = ['city', 'zone', 'area'] as const;
export const AREA_MATCHES = ['name', 'manual'] as const;

const ts = () => timestamp({ withTimezone: true });
const money = () => bigint({ mode: 'number' });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);

/**
 * Every courier status we heard about a parcel (§3.1): what the order's
 * timeline and the tracking page show. The same status at the same courier
 * time is stored once, so a repeated webhook adds nothing.
 */
export const shipmentEvents = store.table(
  'shipment_events',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    shipmentId: uuid().notNull(),
    /** The courier's own word, as it said it. */
    courierStatus: text().notNull(),
    /** Ours (§3.2). */
    update: text({ enum: COURIER_UPDATES }).notNull(),
    /** { en?, bn? }: RedX gives both. */
    message: jsonb().notNull().default({}),
    courierAt: ts().notNull(),
    source: text({ enum: EVENT_SOURCES }).notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    foreignKey({
      name: 'shipment_events_shipment_fk',
      columns: [t.tenantId, t.shipmentId],
      foreignColumns: [shipments.tenantId, shipments.id],
    }).onDelete('cascade'),
    uniqueIndex('shipment_events_unique').on(
      t.tenantId,
      t.shipmentId,
      t.courierStatus,
      t.courierAt,
    ),
    oneOf('shipment_events_update_valid', t.update, COURIER_UPDATES),
    oneOf('shipment_events_source_valid', t.source, EVENT_SOURCES),
    check('shipment_events_status_length', sql`char_length(${t.courierStatus}) <= 60`),
    check('shipment_events_message_size', sql`octet_length(${t.message}::text) <= 1000`),
  ],
);

/** One payment from a courier to the store (§3.7). */
export const courierPayouts = store.table(
  'courier_payouts',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    courier: text({ enum: COURIERS }).notNull(),
    /** The courier's own reference for the payment. */
    reference: text().notNull(),
    paidAt: ts().notNull(),
    amount: money().notNull(),
    feeTotal: money().notNull().default(0),
    source: text({ enum: PAYOUT_SOURCES }).notNull(),
    recordedBy: uuid(),
    note: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('courier_payouts_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('courier_payouts_reference_unique').on(t.tenantId, t.courier, t.reference),
    index('courier_payouts_paid_idx').on(t.tenantId, t.courier, t.paidAt),
    oneOf('courier_payouts_courier_valid', t.courier, COURIERS),
    oneOf('courier_payouts_source_valid', t.source, PAYOUT_SOURCES),
    check('courier_payouts_reference_length', sql`char_length(${t.reference}) between 1 and 100`),
    check('courier_payouts_money', sql`${t.amount} >= 0 and ${t.feeTotal} >= 0`),
    check('courier_payouts_note_length', sql`char_length(${t.note}) <= 500`),
  ],
);

/** A parcel in a payout: paid once, so a shipment appears in one line only. */
export const courierPayoutLines = store.table(
  'courier_payout_lines',
  {
    ...tenantColumns(),
    payoutId: uuid().notNull(),
    shipmentId: uuid().notNull(),
    collected: money().notNull(),
    fee: money().notNull().default(0),
    net: money().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.payoutId, t.shipmentId] }),
    uniqueIndex('courier_payout_lines_shipment_unique').on(t.tenantId, t.shipmentId),
    foreignKey({
      name: 'courier_payout_lines_payout_fk',
      columns: [t.tenantId, t.payoutId],
      foreignColumns: [courierPayouts.tenantId, courierPayouts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'courier_payout_lines_shipment_fk',
      columns: [t.tenantId, t.shipmentId],
      foreignColumns: [shipments.tenantId, shipments.id],
    }).onDelete('restrict'),
    check('courier_payout_lines_money', sql`${t.collected} >= 0 and ${t.fee} >= 0`),
  ],
);

/**
 * A courier's own places (§3.6), the same for every merchant: Pathao's
 * cities, zones and areas, and RedX's areas. Places the courier drops are
 * retired, never deleted, since bookings point at them.
 */
export const courierAreas = ref.table(
  'courier_areas',
  {
    courier: text({ enum: AREA_COURIERS }).notNull(),
    kind: text({ enum: COURIER_AREA_KINDS }).notNull(),
    externalId: integer().notNull(),
    /** The parent's externalId: a zone's city, an area's zone. */
    parentId: integer(),
    name: text().notNull(),
    nameBn: text(),
    /** RedX gives each area's district and post code. */
    districtName: text(),
    postCode: text(),
    active: boolean().notNull().default(true),
    fetchedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.courier, t.kind, t.externalId] }),
    index('courier_areas_parent_idx').on(t.courier, t.kind, t.parentId),
    index('courier_areas_name_trgm_idx').using('gin', sql`lower(${t.name}) gin_trgm_ops`),
    oneOf('courier_areas_courier_valid', t.courier, AREA_COURIERS),
    oneOf('courier_areas_kind_valid', t.kind, COURIER_AREA_KINDS),
    check('courier_areas_kinds_by_courier', sql`${t.courier} = 'pathao' or ${t.kind} = 'area'`),
    check('courier_areas_name_length', sql`char_length(${t.name}) between 1 and 200`),
  ],
);

/**
 * Our area matched to a courier's place (§3.6): Pathao's zone, RedX's area.
 * Made by the sync's name match or by a super admin, who it records.
 */
export const courierAreaMap = ref.table(
  'courier_area_map',
  {
    areaId: integer()
      .notNull()
      .references(() => areas.id),
    courier: text({ enum: AREA_COURIERS }).notNull(),
    kind: text({ enum: COURIER_AREA_KINDS }).notNull(),
    externalId: integer().notNull(),
    match: text({ enum: AREA_MATCHES }).notNull(),
    reviewedBy: uuid(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.areaId, t.courier] }),
    foreignKey({
      name: 'courier_area_map_place_fk',
      columns: [t.courier, t.kind, t.externalId],
      foreignColumns: [courierAreas.courier, courierAreas.kind, courierAreas.externalId],
    }),
    oneOf('courier_area_map_courier_valid', t.courier, AREA_COURIERS),
    oneOf('courier_area_map_match_valid', t.match, AREA_MATCHES),
    check(
      'courier_area_map_kind',
      sql`(${t.courier} = 'pathao' and ${t.kind} = 'zone') or (${t.courier} = 'redx' and ${t.kind} = 'area')`,
    ),
  ],
);
