// Global reference data (phase-4-plan §3.2, PLAN.md: non-tenant tables):
// Bangladesh's divisions, districts and areas, loaded by migration from
// packages/shared/src/geo/bd.json. Read-only for the app; no RLS, because
// every store sees the same rows.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core';

export const ref = pgSchema('ref');

export const divisions = ref.table('divisions', {
  id: smallint().primaryKey(),
  code: text().notNull().unique(),
  nameBn: text().notNull(),
  nameEn: text().notNull(),
});

export const districts = ref.table(
  'districts',
  {
    id: smallint().primaryKey(),
    divisionId: smallint()
      .notNull()
      .references(() => divisions.id),
    code: text().notNull().unique(),
    nameBn: text().notNull(),
    nameEn: text().notNull(),
  },
  (t) => [index('districts_division_idx').on(t.divisionId)],
);

export const AREA_KINDS = ['upazila', 'thana'] as const;

export const areas = ref.table(
  'areas',
  {
    id: integer().primaryKey(),
    districtId: smallint().notNull(),
    code: text().notNull().unique(),
    kind: text({ enum: AREA_KINDS }).notNull(),
    nameBn: text().notNull(),
    nameEn: text().notNull(),
    /** Retired areas stay, so old addresses and zones still resolve. */
    active: boolean().notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: 'areas_district_fk',
      columns: [t.districtId],
      foreignColumns: [districts.id],
    }),
    // Lets a store table reference (district, area) and know they match.
    unique('areas_district_id_unique').on(t.districtId, t.id),
    check('areas_kind_valid', sql`${t.kind} in ('upazila', 'thana')`),
  ],
);
