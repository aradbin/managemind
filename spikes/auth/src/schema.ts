// Drizzle tables for the auth spike. Property keys are Better Auth's field
// names; column names follow the project's snake_case convention.
import { sql } from 'drizzle-orm';
import { boolean, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const platform = pgSchema('platform');
const store = pgSchema('store');

const ts = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const tenantId = () => uuid('tenant_id').notNull().default(sql`app.current_tenant_id_guarded()`);

// Staff (platform schema, no RLS).
export const staffUsers = platform.table('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const staffSessions = platform.table('sessions', {
  id: id(),
  userId: uuid('user_id').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  activeOrganizationId: uuid('active_organization_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
const accountColumns = () => ({
  id: id(),
  userId: uuid('user_id').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const staffAccounts = platform.table('accounts', accountColumns());
const verificationColumns = () => ({
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const staffVerifications = platform.table('verifications', verificationColumns());
export const organizations = platform.table('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const members = platform.table('members', {
  id: id(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const invitations = platform.table('invitations', {
  id: id(),
  organizationId: uuid('organization_id').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull(),
  expiresAt: ts('expires_at').notNull(),
  inviterId: uuid('inviter_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// Shoppers (store schema, FORCE RLS on tenant_id; the column is never set by
// Better Auth, so the database default fills it from the tenant context).
export const shopperUsers = store.table('shopper_users', {
  tenantId: tenantId(),
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const shopperSessions = store.table('shopper_sessions', {
  tenantId: tenantId(),
  id: id(),
  userId: uuid('user_id').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const shopperAccounts = store.table('shopper_accounts', {
  tenantId: tenantId(),
  ...accountColumns(),
});
export const shopperVerifications = store.table('shopper_verifications', {
  tenantId: tenantId(),
  ...verificationColumns(),
});

export const staffSchema = {
  user: staffUsers,
  session: staffSessions,
  account: staffAccounts,
  verification: staffVerifications,
  organization: organizations,
  member: members,
  invitation: invitations,
};
export const shopperSchema = {
  user: shopperUsers,
  session: shopperSessions,
  account: shopperAccounts,
  verification: shopperVerifications,
};
