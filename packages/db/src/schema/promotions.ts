// Promotions (phase-4-plan §3.13): conditions and an action as typed JSON
// (shared/orders/promotions.ts validates them), codes, and usage counters
// that hold under concurrent checkouts through conditional updates.
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
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const PROMOTION_KINDS = ['automatic', 'code'] as const;
export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;

const ts = () => timestamp({ withTimezone: true });
const money = () => bigint({ mode: 'number' });

export const promotions = store.table(
  'promotions',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    /** { bn?, en? }, shown to shoppers. */
    title: jsonb().notNull(),
    kind: text({ enum: PROMOTION_KINDS }).notNull(),
    status: text({ enum: PROMOTION_STATUSES }).notNull().default('draft'),
    startsAt: ts(),
    endsAt: ts(),
    priority: integer().notNull().default(0),
    exclusive: boolean().notNull().default(false),
    maxDiscount: money(),
    usageLimit: integer(),
    usageCount: integer().notNull().default(0),
    perCustomerLimit: integer(),
    conditions: jsonb().notNull().default({}),
    action: jsonb().notNull(),
    /**
     * A refund as store credit (phase-5a-plan §3.13, Q11): one code for one
     * phone. What an order leaves unused comes back as a new code.
     */
    storeCredit: boolean().notNull().default(false),
    /** Store credit: the order it was issued for (a refund, or what that order left unused). */
    creditOrderId: uuid(),
    /** Store credit that is another credit's unused remainder: that credit. */
    creditParentId: uuid(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('promotions_tenant_id_unique').on(t.tenantId, t.id),
    index('promotions_tenant_status_idx').on(t.tenantId, t.status, t.startsAt),
    index('promotions_credit_parent_idx').on(t.tenantId, t.creditParentId),
    check('promotions_kind_valid', sql`${t.kind} in ('automatic', 'code')`),
    check('promotions_status_valid', sql`${t.status} in ('draft', 'active', 'paused', 'ended')`),
    check('promotions_dates', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'promotions_usage',
      sql`${t.usageCount} >= 0 and (${t.usageLimit} is null or ${t.usageLimit} > 0)`,
    ),
    check('promotions_max_discount_positive', sql`${t.maxDiscount} > 0`),
    check(
      'promotions_json_objects',
      sql`jsonb_typeof(${t.conditions}) = 'object' and jsonb_typeof(${t.action}) = 'object'`,
    ),
  ],
);

export const promotionCodes = store.table(
  'promotion_codes',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    promotionId: uuid().notNull(),
    code: text().notNull(),
    /** Null: limited only by the promotion's own limit. */
    usageLimit: integer(),
    usageCount: integer().notNull().default(0),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('promotion_codes_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'promotion_codes_promotion_fk',
      columns: [t.tenantId, t.promotionId],
      foreignColumns: [promotions.tenantId, promotions.id],
    }).onDelete('cascade'),
    // Matched without regard to case.
    uniqueIndex('promotion_codes_code_unique').on(t.tenantId, sql`upper(code)`),
    index('promotion_codes_promotion_idx').on(t.tenantId, t.promotionId),
    check('promotion_codes_code_format', sql`${t.code} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$'`),
    check(
      'promotion_codes_usage',
      sql`${t.usageCount} >= 0 and (${t.usageLimit} is null or ${t.usageLimit} > 0)`,
    ),
  ],
);

/** Uses per promotion and phone, for per-customer limits (counted by the normalized phone). */
export const promotionCustomerUsage = store.table(
  'promotion_customer_usage',
  {
    ...tenantColumns(),
    promotionId: uuid().notNull(),
    phone: text().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.promotionId, t.phone] }),
    foreignKey({
      name: 'promotion_customer_usage_promotion_fk',
      columns: [t.tenantId, t.promotionId],
      foreignColumns: [promotions.tenantId, promotions.id],
    }).onDelete('cascade'),
    check('promotion_customer_usage_count', sql`${t.count} >= 0`),
  ],
);
