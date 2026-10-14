// Support access (phase-1-plan §5.4, Q5 as proposed): a platform user acts
// in one store with a grant's role, for at most 4 hours. Support staff can
// give themselves Viewer access with a written reason; Manager access needs
// a super admin. Each grant is in both audit logs, and the store's Owners
// are emailed (the caller sends it, with the owners this returns).
import { schema } from '@managemind/db';
import { AppError, type Locale } from '@managemind/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { recordAudit } from '../audit';
import { recordPlatformAudit } from '../platform';
import { type DbClient, type WithTenantOptions, withTenant } from '../tenant';

const g = schema.supportGrants;
export const SUPPORT_MAX_MINUTES = 240;

export interface SupportGrantInput {
  role: 'viewer' | 'manager';
  /** Shown to the store's Owners and kept in both audit logs; 10–500 characters. */
  reason: string;
  minutes: number;
}

export interface GrantedSupport {
  grant: { id: string; role: 'viewer' | 'manager'; expiresAt: Date };
  store: { name: string };
  /** The store's Owners, to email (§5.4). */
  owners: { email: string; name: string; locale: Locale }[];
}

export async function grantSupportAccess(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  input: SupportGrantInput,
  options: WithTenantOptions = {},
): Promise<GrantedSupport> {
  requirePlatformRole(actor, input.role === 'manager' ? 'super_admin' : 'support');
  if (actor.kind !== 'user' || !actor.userId) throw new AppError('forbidden');
  const reason = input.reason.trim();
  const minutes = Math.floor(input.minutes);
  const fields = [
    ...(reason.length < 10 || reason.length > 500
      ? [{ path: 'reason', code: 'length', message: 'must be 10 to 500 characters' }]
      : []),
    ...(minutes < 1 || minutes > SUPPORT_MAX_MINUTES
      ? [{ path: 'minutes', code: 'range', message: `must be 1 to ${SUPPORT_MAX_MINUTES}` }]
      : []),
  ];
  if (fields.length) throw new AppError('validation_failed', { fields });
  const userId = actor.userId;

  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const t = schema.tenants;
      const [store] = await tx.db
        .select({ name: t.name, status: t.status })
        .from(t)
        .where(eq(t.id, tenantId));
      if (!store || store.status === 'closed' || store.status === 'purged')
        throw new AppError('store_not_found');
      const [grant] = await tx.db
        .insert(g)
        .values({
          tenantId,
          userId,
          role: input.role,
          reason,
          grantedBy: userId,
          // The database clock, so the 4-hour CHECK can't trip on a skewed Worker clock.
          expiresAt: sql`now() + make_interval(mins => ${minutes})`,
        })
        .returning({ id: g.id, role: g.role, expiresAt: g.expiresAt });
      if (!grant)
        throw new AppError('internal', { detail: 'support grant insert returned no row' });

      const entry = {
        ...auditActor(actor, 'platform'),
        action: 'support.granted',
        entityType: 'support_grant',
        entityId: grant.id,
        after: { role: grant.role, reason, expiresAt: grant.expiresAt.toISOString() },
      };
      await recordPlatformAudit(tx, { ...entry, actorType: 'platform', tenantId });
      await recordAudit(tx, { ...entry, actorType: 'platform' });

      const m = schema.memberships;
      const u = schema.users;
      const owners = await tx.db
        .select({ email: u.email, name: u.name, locale: u.locale })
        .from(m)
        .innerJoin(u, eq(u.id, m.userId))
        .where(and(eq(m.tenantId, tenantId), eq(m.role, 'owner')));
      return { grant, store: { name: store.name }, owners };
    },
    options,
  );
}

/** Ends a grant now. The grantee or a super admin may. */
export async function revokeSupportAccess(
  client: DbClient,
  actor: Actor,
  grantId: string,
  options: WithTenantOptions = {},
): Promise<void> {
  requirePlatformRole(actor, 'support');
  const { rows } = await client.query<{ tenant_id: string; user_id: string }>(
    'select tenant_id, user_id from platform.support_grants where id = $1',
    [grantId],
  );
  const found = rows[0];
  if (!found) throw new AppError('not_found');
  if (found.user_id !== actor.userId) requirePlatformRole(actor, 'super_admin');
  await withTenant(
    client,
    found.tenant_id,
    async (tx) => {
      const [revoked] = await tx.db
        .update(g)
        .set({ revokedAt: new Date() })
        .where(and(eq(g.id, grantId), isNull(g.revokedAt)))
        .returning({ id: g.id });
      if (!revoked) return;
      const entry = {
        ...auditActor(actor, 'platform'),
        action: 'support.revoked',
        entityType: 'support_grant',
        entityId: grantId,
      };
      await recordPlatformAudit(tx, { ...entry, actorType: 'platform', tenantId: found.tenant_id });
      await recordAudit(tx, { ...entry, actorType: 'platform' });
    },
    options,
  );
}
