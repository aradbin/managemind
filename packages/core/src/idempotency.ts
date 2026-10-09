// Idempotent writes (after Stripe): the first result for a key is stored and
// replayed for retries; the same key with a different request is refused.
// The key row is inserted in the caller's transaction, so:
// - if the command fails, the transaction rolls back and leaves no key, so a
//   retry runs normally;
// - a concurrent duplicate waits on the unique index until the first commits,
//   then replays its result instead of running the command again.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { TenantTx } from './tenant';

export interface IdempotentResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyInput {
  /** The operation, e.g. "checkout.place_order". */
  scope: string;
  /** The client's Idempotency-Key header. */
  key: string;
  /** The request the key protects; hashed to detect reuse. */
  request: unknown;
}

/** JSON with object keys sorted, so equal requests hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function hashRequest(request: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(request)),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function runIdempotent(
  tx: TenantTx,
  input: IdempotencyInput,
  fn: () => Promise<IdempotentResponse>,
): Promise<IdempotentResponse & { replayed: boolean }> {
  if (input.key.length < 8 || input.key.length > 255) {
    throw new AppError('validation_failed', {
      detail: 'Idempotency-Key must be 8 to 255 characters',
      fields: [
        { path: 'Idempotency-Key', code: 'invalid_length', message: 'Use 8 to 255 characters' },
      ],
    });
  }
  const requestHash = await hashRequest(input.request);
  const t = schema.idempotencyKeys;
  const inserted = await tx.db
    .insert(t)
    .values({
      scope: input.scope,
      key: input.key,
      requestHash,
      lockedUntil: sql`now() + interval '30 seconds'`,
    })
    .onConflictDoNothing()
    .returning({ key: t.key });

  const match = and(eq(t.scope, input.scope), eq(t.key, input.key));
  if (inserted.length === 1) {
    const response = await fn();
    await tx.db
      .update(t)
      .set({ state: 'completed', responseStatus: response.status, responseBody: response.body })
      .where(match);
    return { ...response, replayed: false };
  }

  const [existing] = await tx.db.select().from(t).where(match);
  if (!existing) throw new AppError('internal', { detail: 'idempotency key vanished' });
  if (existing.requestHash !== requestHash) throw new AppError('idempotency_key_reused');
  if (existing.state !== 'completed' || existing.responseStatus === null) {
    throw new AppError('idempotency_request_in_progress');
  }
  return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
}
