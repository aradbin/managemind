// What a store saves for each provider (phase-5a-plan §3.1): the secret
// fields, encrypted together, and the plain settings next to them. Staff
// never get the secrets back, only the provider, the mode and a hint.
import { z } from 'zod';

/** Each courier is its own kind, so a store can connect several (phase-7-plan §3.3). */
export const CREDENTIAL_KINDS = [
  'sslcommerz',
  'sms',
  'email',
  'steadfast',
  'pathao',
  'redx',
  'fake',
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_PROVIDERS = {
  sslcommerz: ['sslcommerz'],
  sms: ['sms_net_bd', 'bulksmsbd', 'sms_http'],
  email: ['resend', 'brevo'],
  steadfast: ['steadfast'],
  pathao: ['pathao'],
  redx: ['redx'],
  fake: ['fake'],
} as const satisfies Record<CredentialKind, readonly string[]>;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[CredentialKind][number];

export const CREDENTIAL_MODES = ['sandbox', 'live'] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

const secret = (max = 200) => z.string().trim().min(1).max(max);

/**
 * The secret we give a courier to send with its webhooks (§3.3, §3.5): made
 * by the server and kept with the store's credentials, never typed by staff.
 */
export const webhookSecret = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);
/** Pathao's tokens, renewed by the adapter and sealed again (Q6). */
const oauthTokens = {
  accessToken: z.string().max(4000).optional(),
  refreshToken: z.string().max(4000).optional(),
  /** Seconds since the epoch. */
  expiresAt: z.int().optional(),
};

/** The encrypted part, per provider. */
export const credentialSecrets = {
  sslcommerz: z.object({ storeId: secret(100), storePassword: secret(200) }).strict(),
  sms_net_bd: z.object({ apiKey: secret() }).strict(),
  bulksmsbd: z.object({ apiKey: secret() }).strict(),
  /** The generic adapter's secret header value, if it needs one. */
  sms_http: z.object({ authValue: secret(500).optional() }).strict(),
  resend: z.object({ apiKey: secret() }).strict(),
  brevo: z.object({ apiKey: secret() }).strict(),
  steadfast: z
    .object({ apiKey: secret(), secretKey: secret(), webhookSecret: webhookSecret.optional() })
    .strict(),
  pathao: z
    .object({
      clientId: secret(100),
      clientSecret: secret(),
      username: z.email().max(254),
      password: secret(),
      webhookSecret: webhookSecret.optional(),
      ...oauthTokens,
    })
    .strict(),
  redx: z.object({ token: secret(2000), webhookSecret: webhookSecret.optional() }).strict(),
  fake: z.object({ apiKey: secret(), webhookSecret: webhookSecret.optional() }).strict(),
} as const satisfies Record<CredentialProvider, z.ZodType>;

/** The secret fields staff type; the rest the server keeps (the webhook secret, tokens). */
export const COURIER_SECRET_FIELDS = {
  steadfast: ['apiKey', 'secretKey'],
  pathao: ['clientId', 'clientSecret', 'username', 'password'],
  redx: ['token'],
  fake: ['apiKey'],
} as const;

const senderId = z.string().trim().min(1).max(20);

/** The plain part, per provider. */
export const credentialConfigs = {
  sslcommerz: z.object({}).strict(),
  sms_net_bd: z.object({ senderId: senderId.optional() }).strict(),
  bulksmsbd: z.object({ senderId }).strict(),
  /**
   * A gateway we have no adapter for (§3.6): one HTTPS request per message,
   * with the number and text in the named fields, and success when the
   * response body contains the given text.
   */
  sms_http: z
    .object({
      url: z.url({ protocol: /^https$/ }).max(500),
      method: z.enum(['GET', 'POST']).default('POST'),
      toField: z.string().trim().min(1).max(50).default('to'),
      messageField: z.string().trim().min(1).max(50).default('message'),
      /** Extra fixed fields, such as a sender ID. */
      extra: z.record(z.string().max(50), z.string().max(200)).default({}),
      authHeader: z.string().trim().min(1).max(50).optional(),
      successText: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
  resend: z
    .object({ from: z.email().max(254), fromName: z.string().trim().min(1).max(100).optional() })
    .strict(),
  brevo: z
    .object({ from: z.email().max(254), fromName: z.string().trim().min(1).max(100).optional() })
    .strict(),
  steadfast: z.object({}).strict(),
  /** The pickup store, chosen from Pathao's list on saving; 48-hour delivery; a parcel. */
  pathao: z
    .object({
      storeId: z.int().positive().optional(),
      deliveryType: z.union([z.literal(48), z.literal(12)]).default(48),
      itemType: z.union([z.literal(1), z.literal(2)]).default(2),
      /** The value Pathao asks to see in a webhook's reply, copied from Pathao, when it asks. */
      integrationSecret: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
  /** The pickup store, chosen from RedX's list on saving. */
  redx: z.object({ pickupStoreId: z.int().positive().optional() }).strict(),
  fake: z.object({}).strict(),
} as const satisfies Record<CredentialProvider, z.ZodType>;

export type CredentialSecrets<P extends CredentialProvider> = z.infer<
  (typeof credentialSecrets)[P]
>;
export type CredentialConfig<P extends CredentialProvider> = z.infer<(typeof credentialConfigs)[P]>;

/** What staff send to save one kind. */
export const credentialInput = z
  .object({
    provider: z.string(),
    mode: z.enum(CREDENTIAL_MODES).optional(),
    secrets: z.record(z.string(), z.unknown()),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const providerOf = (kind: CredentialKind, provider: string): CredentialProvider | null =>
  (CREDENTIAL_PROVIDERS[kind] as readonly string[]).includes(provider)
    ? (provider as CredentialProvider)
    : null;

/** The last 4 characters of the field staff recognise: the store ID, or the key. */
export function credentialHint(secrets: Record<string, unknown>): string {
  const value = String(
    secrets.storeId ??
      secrets.apiKey ??
      secrets.clientId ??
      secrets.token ??
      secrets.authValue ??
      '',
  );
  return value.length > 4 ? value.slice(-4) : '';
}
