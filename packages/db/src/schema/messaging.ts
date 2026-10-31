// Credentials and messages (phase-5a-plan §3.1, §3.6–§3.9): each store's
// gateway, SMS and email keys, encrypted; the delivery log of every email,
// SMS and push; per-store template overrides; staff push devices and alert
// choices.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { users } from './platform';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const CREDENTIAL_KINDS = [
  'sslcommerz',
  'sms',
  'email',
  'steadfast',
  'pathao',
  'redx',
  'fake',
  'meta_capi',
  'whatsapp',
] as const;
export const CREDENTIAL_PROVIDERS = [
  'sslcommerz',
  'sms_net_bd',
  'bulksmsbd',
  'sms_http',
  'resend',
  'brevo',
  'steadfast',
  'pathao',
  'redx',
  'fake',
  'meta_capi',
  'whatsapp',
] as const;
export const CREDENTIAL_MODES = ['sandbox', 'live'] as const;
export const CHANNELS = ['email', 'sms', 'push'] as const;
export const MESSAGE_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export const RECIPIENT_TYPES = ['shopper', 'staff'] as const;
export const MESSAGE_EVENTS = [
  'order_placed',
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'payment_received',
  'payment_expired',
  'return_approved',
  'return_rejected',
  'return_received',
  'refund_issued',
  'store_credit_issued',
  'confirm_request',
  'new_order',
  'online_payment',
  'shopper_cancelled',
  'return_requested',
  'payment_problem',
] as const;
export const STAFF_EVENTS = [
  'new_order',
  'online_payment',
  'shopper_cancelled',
  'return_requested',
  'payment_problem',
] as const;

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  fromDriver: (value) => new Uint8Array(value),
  toDriver: (value) => Buffer.from(value),
});
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);

/** One row per kind: the encrypted JSON of its secret fields (AES-256-GCM, §3.1). */
export const providerCredentials = store.table(
  'provider_credentials',
  {
    ...tenantColumns(),
    kind: text({ enum: CREDENTIAL_KINDS }).notNull(),
    provider: text({ enum: CREDENTIAL_PROVIDERS }).notNull(),
    /** SSLCommerz only. */
    mode: text({ enum: CREDENTIAL_MODES }),
    ciphertext: bytea().notNull(),
    iv: bytea().notNull(),
    keyVersion: smallint().notNull(),
    /** The last 4 characters of the store ID or key, for staff to recognise it. */
    hint: text().notNull(),
    /** Non-secret settings: the generic SMS adapter's URL and fields, the sender ID. */
    config: jsonb().notNull().default({}),
    checkedAt: ts(),
    checkError: text(),
    updatedBy: uuid(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.kind] }),
    oneOf('provider_credentials_kind_valid', t.kind, CREDENTIAL_KINDS),
    oneOf('provider_credentials_provider_valid', t.provider, CREDENTIAL_PROVIDERS),
    oneOf('provider_credentials_mode_valid', t.mode, CREDENTIAL_MODES),
    check(
      'provider_credentials_kind_provider',
      sql`case ${t.kind}
        when 'sslcommerz' then ${t.provider} = 'sslcommerz' and ${t.mode} is not null
        when 'sms' then ${t.provider} in ('sms_net_bd', 'bulksmsbd', 'sms_http') and ${t.mode} is null
        when 'email' then ${t.provider} in ('resend', 'brevo') and ${t.mode} is null
        else ${t.provider} = ${t.kind} end`,
    ),
    check('provider_credentials_iv_length', sql`octet_length(${t.iv}) = 12`),
    check('provider_credentials_ciphertext_size', sql`octet_length(${t.ciphertext}) <= 8192`),
    check('provider_credentials_hint_length', sql`char_length(${t.hint}) <= 8`),
    check('provider_credentials_config_size', sql`octet_length(${t.config}::text) <= 2000`),
    check('provider_credentials_check_error_length', sql`char_length(${t.checkError}) <= 300`),
  ],
);

/** The delivery log (§3.6): one row per message, kept 90 days. */
export const messages = store.table(
  'messages',
  {
    ...tenantColumns(),
    id: id(),
    /** event ID + channel + recipient, so a redelivered event never sends twice. */
    idempotencyKey: text().notNull(),
    event: text({ enum: MESSAGE_EVENTS }).notNull(),
    channel: text({ enum: CHANNELS }).notNull(),
    recipientType: text({ enum: RECIPIENT_TYPES }).notNull(),
    /** A phone, an email address, or a staff user's ID for push. */
    recipient: text().notNull(),
    orderId: uuid(),
    locale: text().notNull(),
    status: text({ enum: MESSAGE_STATUSES }).notNull().default('queued'),
    /** Why it was skipped or failed: no_gateway, no_address, quota, or the provider's error. */
    reason: text(),
    attempts: smallint().notNull().default(0),
    provider: text(),
    providerMessageId: text(),
    sentAt: ts(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('messages_tenant_id_unique').on(t.tenantId, t.id),
    unique('messages_idempotency_unique').on(t.tenantId, t.idempotencyKey),
    foreignKey({
      name: 'messages_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete('restrict'),
    index('messages_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    index('messages_order_idx').on(t.tenantId, t.orderId).where(sql`order_id is not null`),
    oneOf('messages_event_valid', t.event, MESSAGE_EVENTS),
    oneOf('messages_channel_valid', t.channel, CHANNELS),
    oneOf('messages_recipient_type_valid', t.recipientType, RECIPIENT_TYPES),
    oneOf('messages_status_valid', t.status, MESSAGE_STATUSES),
    check('messages_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check(
      'messages_text_lengths',
      sql`char_length(${t.idempotencyKey}) <= 200 and char_length(${t.recipient}) <= 254
        and char_length(${t.reason}) <= 300 and char_length(${t.provider}) <= 30
        and char_length(${t.providerMessageId}) <= 200`,
    ),
  ],
);

/** A store's own wording for an event (§3.7); the defaults live in code. */
export const messageTemplates = store.table(
  'message_templates',
  {
    ...tenantColumns(),
    event: text({ enum: MESSAGE_EVENTS }).notNull(),
    channel: text({ enum: CHANNELS }).notNull(),
    locale: text().notNull(),
    /** Email only. */
    subject: text(),
    body: text().notNull(),
    updatedBy: uuid(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.event, t.channel, t.locale] }),
    oneOf('message_templates_event_valid', t.event, MESSAGE_EVENTS),
    oneOf('message_templates_channel_valid', t.channel, CHANNELS),
    check('message_templates_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check('message_templates_subject_length', sql`char_length(${t.subject}) <= 200`),
    check('message_templates_body_length', sql`char_length(${t.body}) between 1 and 5000`),
  ],
);

/** A staff member's device for web push (§3.9), per store. */
export const pushSubscriptions = store.table(
  'push_subscriptions',
  {
    ...tenantColumns(),
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    createdAt: ts().notNull().defaultNow(),
    lastUsedAt: ts(),
  },
  (t) => [
    tenantPolicy(t),
    unique('push_subscriptions_endpoint_unique').on(t.tenantId, t.endpoint),
    index('push_subscriptions_user_idx').on(t.tenantId, t.userId),
    check('push_subscriptions_endpoint_https', sql`${t.endpoint} ~ '^https://'`),
    check(
      'push_subscriptions_lengths',
      sql`char_length(${t.endpoint}) <= 1000 and char_length(${t.p256dh}) <= 200
        and char_length(${t.auth}) <= 50 and char_length(${t.userAgent}) <= 300`,
    ),
  ],
);

/** A staff member's choice per alert and channel; no row means the default (push on). */
export const staffAlertPreferences = store.table(
  'staff_alert_preferences',
  {
    ...tenantColumns(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text({ enum: STAFF_EVENTS }).notNull(),
    channel: text({ enum: CHANNELS }).notNull(),
    enabled: boolean().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.userId, t.event, t.channel] }),
    oneOf('staff_alert_preferences_event_valid', t.event, STAFF_EVENTS),
    oneOf('staff_alert_preferences_channel_valid', t.channel, CHANNELS),
  ],
);
