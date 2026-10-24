// Staff requests to /v1/admin/* (phase-1-plan §7.1): one database
// connection for the whole request, the Better Auth session, and the Actor
// rebuilt from the membership or support grant every time, so a removed
// member or a revoked grant loses access on their next request.
import {
  type Actor,
  actorFor,
  ownerBlockedByTerms,
  relayEvents,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { createDb, schema } from '@managemind/db';
import { AppError, isPlatformRole } from '@managemind/shared';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type pg from 'pg';
import { adminOrigin } from '../auth/routes';
import { createStaffAuth } from '../auth/staff';
import { queueSink, withClient } from '../db';
import type { AppEnv } from '../env';

export interface Staff {
  client: pg.Client;
  actor: Actor;
  sessionId: string;
  user: { id: string; email: string; name: string; locale: 'bn' | 'en'; twoFactorEnabled: boolean };
}

export type StaffEnv = AppEnv & { Variables: { staff: Staff } };

export const staffSession = createMiddleware<StaffEnv>(async (c, next) => {
  await withClient(c.env, c.executionCtx, async (client) => {
    const db = createDb(client);
    const auth = createStaffAuth({
      db,
      secret: c.var.config.AUTH_SECRET,
      origin: adminOrigin(c as unknown as Context<AppEnv>),
      appName: c.var.config.PLATFORM_NAME,
      sendCode: () => {},
    });
    const { headers, response } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (!response) throw new AppError('unauthorized');
    const session = response.session as typeof response.session & {
      activeTenantId?: string | null;
    };
    // getSession just read the user row (no cookie cache), platform role included.
    const role = (response.user as { platformRole?: unknown }).platformRole;
    const actor = await actorFor(db, response.user.id, session.activeTenantId ?? null, {
      platformRole: isPlatformRole(role) ? role : null,
    });
    const user = response.user as unknown as Staff['user'];
    c.set('staff', { client, actor, sessionId: session.id, user });
    c.set('userId', user.id);
    if (actor.tenantId) c.set('tenantId', actor.tenantId);
    await next();
    // A refreshed session comes with a new cookie.
    for (const cookie of headers.getSetCookie()) c.res.headers.append('Set-Cookie', cookie);
  });
});

/**
 * Runs `fn` in a transaction on the actor's active store, relaying its
 * events after commit. Writes are refused with 423 while the store is
 * suspended; reads still work (§4.4).
 */
export async function inStore<T>(
  c: Context<StaffEnv>,
  fn: (tx: TenantTx) => Promise<T>,
  options: {
    write?: boolean;
    /**
     * A write an owner can make before accepting the platform terms (paying
     * our invoice). Every other owner write waits for the terms (phase-5b-plan §3.4).
     */
    beforeTerms?: boolean;
  } = {},
): Promise<T> {
  const { client, actor } = c.var.staff;
  if (!actor.tenantId) throw new AppError('forbidden', { detail: 'no active store' });
  return withTenant(
    client,
    actor.tenantId,
    async (tx) => {
      if (options.write) {
        const [store] = await tx.db
          .select({ status: schema.tenants.status })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, tx.tenantId));
        if (store?.status !== 'active') throw new AppError('tenant_suspended');
        if (!options.beforeTerms && (await ownerBlockedByTerms(tx, actor))) {
          throw new AppError('terms_required');
        }
      }
      return fn(tx);
    },
    { requestId: c.var.requestId, afterCommit: relayTo(c) },
  );
}

/** Hands committed events to the queue on the request's connection (ADR 0010). */
export const relayTo =
  (c: Context<StaffEnv>) =>
  async (events: Parameters<typeof relayEvents>[1]): Promise<void> => {
    await relayEvents(c.var.staff.client, events, queueSink(c.env.OUTBOX));
  };
