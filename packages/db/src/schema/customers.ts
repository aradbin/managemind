// Customers, their addresses, shopper accounts and the phone blocklist
// (phase-4-plan §3.10, §3.11, §3.15). A customer is one phone number in one
// store; a shopper account is an optional sign-in on top (ADR 0005), with
// Better Auth's tables in the store schema, unique per store.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { areas } from './ref';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () => ts().notNull().defaultNow();
const money = () => bigint({ mode: 'number' });
const tenantIdUnique = (table: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) =>
  unique(`${table}_tenant_id_unique`).on(t.tenantId, t.id);
/** E.164 Bangladeshi mobile numbers (shared/phone.ts normalizes every input). */
const phoneCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^\\+8801[3-9][0-9]{8}$'`);

export const customers = store.table(
  'customers',
  {
    ...tenantColumns(),
    id: id(),
    phone: text().notNull(),
    name: text().notNull(),
    email: text(),
    /** Groups ("wholesale", "vip"); promotions can target them. */
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    note: text(),
    // Kept in the same transaction as order changes (§3.10).
    orderCount: integer().notNull().default(0),
    /** Delivered orders only. */
    totalSpent: money().notNull().default(0),
    /** Shipments that came back undelivered (phase-5a-plan §3.11). */
    failedDeliveries: integer().notNull().default(0),
    /** Flagged by staff, whatever the count; clearing resets both. */
    flagged: boolean().notNull().default(false),
    firstOrderAt: ts(),
    lastOrderAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('customers', t),
    uniqueIndex('customers_phone_unique').on(t.tenantId, t.phone).where(sql`deleted_at is null`),
    index('customers_name_trgm_idx').using(
      'gin',
      t.tenantId,
      sql`app.search_text(${t.name}) gin_trgm_ops`,
    ),
    index('customers_tenant_last_order_idx').on(t.tenantId, sql`last_order_at desc nulls last`),
    phoneCheck('customers_phone_format', t.phone),
    check('customers_name_length', sql`char_length(${t.name}) between 1 and 100`),
    check('customers_email_length', sql`char_length(${t.email}) <= 254`),
    check('customers_note_length', sql`char_length(${t.note}) <= 2000`),
    check('customers_tags_count', sql`cardinality(${t.tags}) <= 20`),
    check(
      'customers_totals_non_negative',
      sql`${t.orderCount} >= 0 and ${t.totalSpent} >= 0 and ${t.failedDeliveries} >= 0`,
    ),
  ],
);

export const customerAddresses = store.table(
  'customer_addresses',
  {
    ...tenantColumns(),
    id: id(),
    customerId: uuid().notNull(),
    name: text().notNull(),
    phone: text().notNull(),
    divisionId: smallint().notNull(),
    districtId: smallint().notNull(),
    areaId: integer().notNull(),
    line: text().notNull(),
    /** "Home", "Office". */
    label: text(),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    foreignKey({
      name: 'customer_addresses_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }).onDelete('cascade'),
    // The area must be in the district (ref.areas' (district_id, id) key).
    foreignKey({
      name: 'customer_addresses_area_fk',
      columns: [t.districtId, t.areaId],
      foreignColumns: [areas.districtId, areas.id],
    }),
    index('customer_addresses_customer_idx').on(t.tenantId, t.customerId),
    uniqueIndex('customer_addresses_one_default')
      .on(t.tenantId, t.customerId)
      .where(sql`is_default`),
    phoneCheck('customer_addresses_phone_format', t.phone),
    check('customer_addresses_name_length', sql`char_length(${t.name}) between 1 and 100`),
    check('customer_addresses_line_length', sql`char_length(${t.line}) between 1 and 250`),
    check('customer_addresses_label_length', sql`char_length(${t.label}) <= 40`),
  ],
);

// ---- Shopper accounts (Better Auth's tables; property keys are its field names) -----------

export const shopperUsers = store.table(
  'shopper_users',
  {
    ...tenantColumns(),
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    /** Saved from checkout ("save my details"); never verified, so never used to sign in. */
    phone: text(),
    /**
     * A phone account's number, verified by a code (phase-5a-plan §3.14). Kept
     * apart from `phone`, so a number someone typed can't sign anyone in.
     */
    phoneNumber: text(),
    phoneNumberVerified: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('shopper_users', t),
    unique('shopper_users_email_unique').on(t.tenantId, t.email),
    check('shopper_users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    phoneCheck('shopper_users_phone_format', t.phone),
    phoneCheck('shopper_users_phone_number_format', t.phoneNumber),
    uniqueIndex('shopper_users_phone_number_unique')
      .on(t.tenantId, t.phoneNumber)
      .where(sql`phone_number is not null`),
  ],
);

const shopperRef = (table: string, t: { tenantId: AnyPgColumn; userId: AnyPgColumn }) =>
  foreignKey({
    name: `${table}_user_fk`,
    columns: [t.tenantId, t.userId],
    foreignColumns: [shopperUsers.tenantId, shopperUsers.id],
  }).onDelete('cascade');

export const shopperSessions = store.table(
  'shopper_sessions',
  {
    ...tenantColumns(),
    id: id(),
    userId: uuid().notNull(),
    token: text().notNull(),
    expiresAt: ts().notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    shopperRef('shopper_sessions', t),
    unique('shopper_sessions_token_unique').on(t.tenantId, t.token),
    index('shopper_sessions_user_idx').on(t.tenantId, t.userId),
    index('shopper_sessions_expires_idx').on(t.tenantId, t.expiresAt),
  ],
);

export const shopperAccounts = store.table(
  'shopper_accounts',
  {
    ...tenantColumns(),
    id: id(),
    userId: uuid().notNull(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    shopperRef('shopper_accounts', t),
    index('shopper_accounts_user_idx').on(t.tenantId, t.userId),
    unique('shopper_accounts_provider_account_unique').on(t.tenantId, t.providerId, t.accountId),
  ],
);

export const shopperVerifications = store.table(
  'shopper_verifications',
  {
    ...tenantColumns(),
    // Text, as for staff: Better Auth writes its own non-UUID ids here.
    id: text().primaryKey().default(sql`uuidv7()::text`),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    index('shopper_verifications_identifier_idx').on(t.tenantId, t.identifier),
    index('shopper_verifications_expires_idx').on(t.tenantId, t.expiresAt),
  ],
);

/**
 * A signed-in shopper's saved addresses (§3.11), apart from the customer's:
 * nobody has verified that the shopper owns a phone, so an account never
 * reads a customer's addresses by phone.
 */
export const shopperAddresses = store.table(
  'shopper_addresses',
  {
    ...tenantColumns(),
    id: id(),
    userId: uuid().notNull(),
    name: text().notNull(),
    phone: text().notNull(),
    divisionId: smallint().notNull(),
    districtId: smallint().notNull(),
    areaId: integer().notNull(),
    line: text().notNull(),
    label: text(),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('shopper_addresses', t),
    shopperRef('shopper_addresses', t),
    foreignKey({
      name: 'shopper_addresses_area_fk',
      columns: [t.districtId, t.areaId],
      foreignColumns: [areas.districtId, areas.id],
    }),
    index('shopper_addresses_user_idx').on(t.tenantId, t.userId),
    uniqueIndex('shopper_addresses_one_default').on(t.tenantId, t.userId).where(sql`is_default`),
    phoneCheck('shopper_addresses_phone_format', t.phone),
    check('shopper_addresses_name_length', sql`char_length(${t.name}) between 1 and 100`),
    check('shopper_addresses_line_length', sql`char_length(${t.line}) between 1 and 250`),
    check('shopper_addresses_label_length', sql`char_length(${t.label}) <= 40`),
  ],
);

/** Phones refused at checkout with a generic message (§3.15). */
export const blockedPhones = store.table(
  'blocked_phones',
  {
    ...tenantColumns(),
    phone: text().notNull(),
    reason: text().notNull(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.phone] }),
    phoneCheck('blocked_phones_phone_format', t.phone),
    check('blocked_phones_reason_length', sql`char_length(${t.reason}) between 1 and 300`),
  ],
);
