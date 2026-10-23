// The signed-in user's own view: their stores, switching store, and (for
// super admins) platform roles (phase-1-plan §5.3, §6.2).
import { schema } from '@managemind/db';
import { AppError, type PlatformRole, type StoreRole } from '@managemind/shared';
import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { type Actor, actorFor, auditActor, requirePlatformRole } from '../access';
import { type PlatformTx, recordPlatformAudit } from '../platform';

export interface MyStore {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  role: StoreRole;
  /** Set when access comes from a support grant rather than a membership. */
  supportUntil?: Date;
}

/** Stores the user belongs to, then stores they hold a live support grant for. */
const OPEN_STATUSES = ['active', 'suspended'] as const;

export async function listMyStores(
  tx: PlatformTx,
  actor: Actor,
  now = new Date(),
): Promise<MyStore[]> {
  if (!actor.userId) return [];
  const t = schema.tenants;
  const m = schema.memberships;
  const g = schema.supportGrants;
  const members = await tx.db
    .select({ tenantId: t.id, slug: t.slug, name: t.name, status: t.status, role: m.role })
    .from(m)
    .innerJoin(t, eq(t.id, m.tenantId))
    // A closed store can't be opened in the admin (phase-5b-plan §3.1).
    .where(and(eq(m.userId, actor.userId), inArray(t.status, OPEN_STATUSES)))
    .orderBy(asc(t.name));
  if (!actor.platformRole) return members;
  const grants = await tx.db
    .select({
      tenantId: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      role: g.role,
      supportUntil: g.expiresAt,
    })
    .from(g)
    .innerJoin(t, eq(t.id, g.tenantId))
    .where(
      and(
        eq(g.userId, actor.userId),
        gt(g.expiresAt, now),
        isNull(g.revokedAt),
        inArray(t.status, OPEN_STATUSES),
      ),
    )
    .orderBy(asc(t.name));
  const seen = new Set(members.map((s) => s.tenantId));
  return [...members, ...grants.filter((s) => !seen.has(s.tenantId) && seen.add(s.tenantId))];
}

/**
 * Makes `tenantId` the session's active store, if the user may act in it
 * (membership or live support grant). Returns the resulting Actor.
 */
export async function setActiveStore(
  tx: PlatformTx,
  actor: Actor,
  sessionId: string,
  tenantId: string,
): Promise<Actor> {
  if (!actor.userId) throw new AppError('forbidden');
  const [store] = await tx.db
    .select({ status: schema.tenants.status })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  if (store?.status === 'closed' || store?.status === 'purged') {
    throw new AppError('tenant_closed');
  }
  const next = await actorFor(tx.db, actor.userId, tenantId);
  if (next.tenantId !== tenantId) throw new AppError('forbidden');
  const s = schema.sessions;
  const updated = await tx.db
    .update(s)
    .set({ activeTenantId: tenantId })
    .where(and(eq(s.id, sessionId), eq(s.userId, actor.userId)))
    .returning({ id: s.id });
  if (updated.length === 0) throw new AppError('unauthorized');
  return next;
}

/** Sets or clears a user's platform role (super admins and the CLI). Signs them out everywhere. */
export async function setPlatformRole(
  tx: PlatformTx,
  actor: Actor,
  userId: string,
  role: PlatformRole | null,
): Promise<void> {
  requirePlatformRole(actor, 'super_admin');
  const u = schema.users;
  const [before] = await tx.db
    .select({ role: u.platformRole })
    .from(u)
    .where(eq(u.id, userId))
    .for('update');
  if (!before) throw new AppError('not_found');
  if ((before.role ?? null) === role) return;
  await tx.db.update(u).set({ platformRole: role }).where(eq(u.id, userId));
  await tx.db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    actorType: actor.kind === 'system' ? 'system' : 'platform',
    action: 'platform.role_changed',
    entityType: 'user',
    entityId: userId,
    before: { role: before.role ?? null },
    after: { role },
  });
}

/** The signed-in user's own name and language. */
export async function updateMyProfile(
  tx: PlatformTx,
  actor: Actor,
  patch: { name?: string; locale?: 'bn' | 'en' },
): Promise<void> {
  if (!actor.userId) throw new AppError('forbidden');
  const set = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
  };
  if (Object.keys(set).length === 0) return;
  await tx.db.update(schema.users).set(set).where(eq(schema.users.id, actor.userId));
}

/** Users with a platform role (super admins). */
export async function listPlatformStaff(tx: PlatformTx, actor: Actor) {
  requirePlatformRole(actor, 'super_admin');
  const u = schema.users;
  return tx.db
    .select({
      id: u.id,
      name: u.name,
      email: u.email,
      platformRole: u.platformRole,
      twoFactorEnabled: u.twoFactorEnabled,
    })
    .from(u)
    .where(isNotNull(u.platformRole))
    .orderBy(asc(u.email));
}
