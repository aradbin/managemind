// A store's couriers (phase-7-plan §3.3): connecting one saves its keys in
// the vault (ADR 0024) with a webhook secret we make, which staff paste into
// the courier's panel with the callback URL. Saving keeps the secret, so
// re-entering keys never breaks the courier's webhook.
import { AppError } from '@managemind/shared';
import { COURIER_SECRET_FIELDS } from '@managemind/shared/credentials';
import { type Courier, isCourier } from '@managemind/shared/orders';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import type { Keyring } from '../credentials/crypto';
import {
  type CredentialCheck,
  type CredentialSummary,
  listCredentials,
  loadCredentials,
  removeCredentials,
  resealCredentials,
  saveCredentials,
} from '../credentials/service';
import type { TenantTx } from '../tenant';

/** A store's saved courier, opened, for the code that calls it. */
export interface CourierConnection {
  courier: Courier;
  mode: 'sandbox' | 'live' | null;
  secrets: Record<string, unknown>;
  config: Record<string, unknown>;
}

export const courierConnectInput = z
  .object({
    mode: z.enum(['sandbox', 'live']).optional(),
    secrets: z.record(z.string(), z.unknown()),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/** 32 random bytes, URL-safe: what a courier sends back to prove a webhook is for us. */
export function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function requireCourier(value: string, allowFake: boolean): Courier {
  if (!isCourier(value) || (value === 'fake' && !allowFake)) throw new AppError('not_found');
  return value;
}

/** The store's connected couriers, without secrets. */
export async function listCouriers(tx: TenantTx, actor: Actor): Promise<CredentialSummary[]> {
  authorize(actor, 'orders.read');
  const all = await listCredentials(tx, {
    ...actor,
    permissions: new Set(['settings.credentials']),
  });
  return all.filter((c) => isCourier(c.kind));
}

/**
 * Connects a courier, or replaces its keys. Only the fields staff type are
 * taken from the input; the webhook secret (and Pathao's tokens) are the
 * server's. The check runs with the courier before anything is saved.
 */
export async function connectCourier(
  tx: TenantTx,
  actor: Actor,
  keyring: Keyring,
  courier: Courier,
  input: unknown,
  check: CredentialCheck,
): Promise<CredentialSummary> {
  authorize(actor, 'settings.credentials');
  const v = parseInput(courierConnectInput, input);
  const typed: Record<string, unknown> = {};
  for (const field of COURIER_SECRET_FIELDS[courier]) typed[field] = v.secrets[field];
  const existing = await loadCredentials(tx, keyring, courier);
  const webhookSecret =
    typeof existing?.secrets.webhookSecret === 'string'
      ? existing.secrets.webhookSecret
      : newWebhookSecret();
  return saveCredentials(
    tx,
    actor,
    keyring,
    courier,
    {
      provider: courier,
      ...(v.mode ? { mode: v.mode } : {}),
      secrets: { ...typed, webhookSecret },
      config: v.config,
    },
    check,
  );
}

export async function disconnectCourier(
  tx: TenantTx,
  actor: Actor,
  courier: Courier,
): Promise<void> {
  await removeCredentials(tx, actor, courier);
}

/** The courier's keys, opened; null when the store hasn't connected it or can't open them. */
export async function loadCourier(
  tx: TenantTx,
  keyring: Keyring | null,
  courier: Courier,
): Promise<CourierConnection | null> {
  const c = await loadCredentials(tx, keyring, courier);
  if (!c) return null;
  return { courier, mode: c.mode, secrets: c.secrets, config: c.config };
}

/** What staff paste into the courier's panel: shown to who may see credentials. */
export async function courierWebhookSecret(
  tx: TenantTx,
  actor: Actor,
  keyring: Keyring,
  courier: Courier,
): Promise<string> {
  authorize(actor, 'settings.credentials');
  const c = await loadCourier(tx, keyring, courier);
  const secret = c?.secrets.webhookSecret;
  if (typeof secret !== 'string') throw new AppError('not_found');
  return secret;
}

/** A new webhook secret; the courier's panel must get it too. Audited. */
export async function rotateWebhookSecret(
  tx: TenantTx,
  actor: Actor,
  keyring: Keyring,
  courier: Courier,
): Promise<string> {
  authorize(actor, 'settings.credentials');
  const c = await loadCourier(tx, keyring, courier);
  if (!c) throw new AppError('not_found');
  const webhookSecret = newWebhookSecret();
  await resealCredentials(tx, keyring, courier, { ...c.secrets, webhookSecret });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'courier.webhook_secret_rotated',
    entityType: 'provider_credentials',
    after: { kind: courier },
  });
  return webhookSecret;
}

/** Seals renewed tokens back (Pathao, Q6); the rest of the secrets stay as they are. */
export async function saveCourierSecrets(
  tx: TenantTx,
  keyring: Keyring,
  courier: Courier,
  patch: Record<string, unknown>,
): Promise<void> {
  const c = await loadCourier(tx, keyring, courier);
  if (!c) return;
  await resealCredentials(tx, keyring, courier, { ...c.secrets, ...patch });
}
