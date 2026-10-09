// Platform data: our own records about each client. No RLS; the app role can
// read the tenant registry (to resolve a hostname to a store) but not write it.
import { sql } from 'drizzle-orm';
import { check, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');

export const TENANT_STATUSES = ['active', 'suspended', 'closed', 'purged'] as const;
export const LOCALES = ['bn', 'en'] as const;

export const tenants = platform.table(
  'tenants',
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    slug: text().notNull().unique(),
    name: text().notNull(),
    status: text({ enum: TENANT_STATUSES }).notNull().default('active'),
    defaultLocale: text({ enum: LOCALES }).notNull().default('bn'),
    settings: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'`),
    check('tenants_status_valid', sql`${t.status} in ('active', 'suspended', 'closed', 'purged')`),
    check('tenants_locale_valid', sql`${t.defaultLocale} in ('bn', 'en')`),
  ],
);
