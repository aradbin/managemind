// A store's provider credentials (phase-5a-plan §3.1). Saving checks them
// against the provider first, through a check the caller passes (the API
// owns the adapters), and saves nothing if the check fails. Lists show the
// provider, mode and hint; only code that calls the provider decrypts.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  CREDENTIAL_KINDS,
  type CredentialKind,
  type CredentialMode,
  type CredentialProvider,
  credentialConfigs,
  credentialHint,
  credentialInput,
  credentialSecrets,
  providerOf,
} from '@managemind/shared/credentials';
import { eq } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { requireFeature } from '../billing/entitlements';
import { parseInput } from '../catalog/common';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { type Keyring, openCredentials, sealCredentials } from './crypto';

export interface CredentialSummary {
  kind: CredentialKind;
  provider: CredentialProvider;
  mode: CredentialMode | null;
  hint: string;
  config: Record<string, unknown>;
  checkedAt: string | null;
  checkError: string | null;
  updatedAt: string;
}

/** What a provider check gets: everything, decrypted, before anything is saved. */
export interface CredentialsToCheck {
  kind: CredentialKind;
  provider: CredentialProvider;
  mode: CredentialMode | null;
  secrets: Record<string, unknown>;
  config: Record<string, unknown>;
}

/** Resolves when the provider accepts the credentials; throws with a reason otherwise. */
export type CredentialCheck = (c: CredentialsToCheck) => Promise<void>;

export interface LoadedCredentials<P extends CredentialProvider = CredentialProvider> {
  provider: P;
  mode: CredentialMode | null;
  secrets: Record<string, unknown>;
  config: Record<string, unknown>;
}

const c = schema.providerCredentials;

export const isCredentialKind = (value: string): value is CredentialKind =>
  (CREDENTIAL_KINDS as readonly string[]).includes(value);

function invalid(path: string, message: string): AppError {
  return new AppError('validation_failed', { fields: [{ path, code: 'invalid', message }] });
}

export async function listCredentials(tx: TenantTx, actor: Actor): Promise<CredentialSummary[]> {
  authorize(actor, 'settings.credentials');
  const rows = await tx.db
    .select({
      kind: c.kind,
      provider: c.provider,
      mode: c.mode,
      hint: c.hint,
      config: c.config,
      checkedAt: c.checkedAt,
      checkError: c.checkError,
      updatedAt: c.updatedAt,
    })
    .from(c)
    .orderBy(c.kind);
  return rows.map((r) => ({
    ...r,
    config: r.config as Record<string, unknown>,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Validates, checks with the provider, encrypts and saves one kind,
 * replacing what was there. The check runs before the write, outside any
 * lock, so a slow provider holds nothing.
 */
export async function saveCredentials(
  tx: TenantTx,
  actor: Actor,
  keyring: Keyring,
  kind: CredentialKind,
  input: unknown,
  check: CredentialCheck,
): Promise<CredentialSummary> {
  authorize(actor, 'settings.credentials');
  // The store's own gateway, SMS and email key are plan features (phase-5b-plan §3.5).
  await requireFeature(
    tx,
    kind === 'sslcommerz' ? 'sslcommerz' : kind === 'sms' ? 'sms' : 'customEmailKey',
  );
  const v = parseInput(credentialInput, input);
  const provider = providerOf(kind, v.provider);
  if (!provider) throw invalid('provider', `not a ${kind} provider`);
  const mode = kind === 'sslcommerz' ? (v.mode ?? null) : null;
  if (kind === 'sslcommerz' && !mode) throw invalid('mode', 'sandbox or live');
  const secrets = parseInput(credentialSecrets[provider], v.secrets) as Record<string, unknown>;
  const config = parseInput(credentialConfigs[provider], v.config) as Record<string, unknown>;

  try {
    await check({ kind, provider, mode, secrets, config });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new AppError('validation_failed', {
      fields: [{ path: 'secrets', code: 'rejected', message: message.slice(0, 300) }],
    });
  }

  const sealed = await sealCredentials(keyring, tx.tenantId, kind, secrets);
  const values = {
    provider,
    mode,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    keyVersion: sealed.keyVersion,
    hint: credentialHint(secrets),
    config,
    checkedAt: new Date(),
    checkError: null,
    updatedBy: actor.userId,
  };
  const [row] = await tx.db
    .insert(c)
    .values({ kind, ...values })
    .onConflictDoUpdate({ target: [c.tenantId, c.kind], set: values })
    .returning();
  if (!row) throw new AppError('internal');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'credentials.saved',
    entityType: 'provider_credentials',
    // Never the secrets: who changed which provider, in which mode.
    after: { kind, provider, mode, hint: row.hint },
  });
  await emit(tx, 'credentials.changed', {
    aggregateType: 'tenant',
    aggregateId: tx.tenantId,
    payload: { kind },
  });
  return {
    kind,
    provider,
    mode,
    hint: row.hint,
    config,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    checkError: null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function removeCredentials(
  tx: TenantTx,
  actor: Actor,
  kind: CredentialKind,
): Promise<void> {
  authorize(actor, 'settings.credentials');
  const deleted = await tx.db
    .delete(c)
    .where(eq(c.kind, kind))
    .returning({ provider: c.provider, mode: c.mode });
  const row = deleted[0];
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'credentials.removed',
    entityType: 'provider_credentials',
    before: { kind, provider: row.provider, mode: row.mode },
  });
  await emit(tx, 'credentials.changed', {
    aggregateType: 'tenant',
    aggregateId: tx.tenantId,
    payload: { kind },
  });
}

/**
 * The store's credentials of one kind, decrypted, for the code that calls the
 * provider; null when the store has none. No permission check: callers are
 * the system's own jobs and requests that already decided to send or charge.
 */
export async function loadCredentials(
  tx: TenantTx,
  keyring: Keyring | null,
  kind: CredentialKind,
): Promise<LoadedCredentials | null> {
  if (!keyring) return null;
  const [row] = await tx.db.select().from(c).where(eq(c.kind, kind));
  if (!row) return null;
  const secrets = (await openCredentials(keyring, tx.tenantId, kind, {
    ciphertext: row.ciphertext,
    iv: row.iv,
    keyVersion: row.keyVersion,
  })) as Record<string, unknown>;
  return {
    provider: row.provider as CredentialProvider,
    mode: row.mode as CredentialMode | null,
    secrets,
    config: row.config as Record<string, unknown>,
  };
}

/** Records the latest failure of saved credentials, for the settings page (§3.4). */
export async function markCredentialsFailing(
  tx: TenantTx,
  kind: CredentialKind,
  error: string | null,
): Promise<void> {
  await tx.db
    .update(c)
    .set({ checkError: error?.slice(0, 300) ?? null, checkedAt: new Date() })
    .where(eq(c.kind, kind));
}
