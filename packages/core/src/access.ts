// Who is acting (phase-1-plan §5.3, §5.4, §6.2). Services check their own
// permissions with these helpers, on top of the route's check (PLAN.md:
// checked twice). actorFor builds a user's Actor on every request, so a
// removed member or a revoked support grant loses access at once.
import { type Db, schema } from '@managemind/db';
import {
  AppError,
  type Permission,
  type PlatformRole,
  permissionsOf,
  type StoreRole,
} from '@managemind/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';

export interface Actor {
  /** `system` is the platform CLI and background jobs. */
  kind: 'user' | 'system';
  userId: string | null;
  platformRole: PlatformRole | null;
  /** What the actor may do in its active store; empty outside a store. */
  permissions: ReadonlySet<Permission>;
  /** The active store, when the actor may act in it. */
  tenantId?: string;
  /** The store role in force: a membership's, or a support grant's. */
  storeRole?: StoreRole;
  /** Set while acting through a support grant (audited as `platform`). */
  supportGrantId?: string;
}

/**
 * The Actor for a signed-in user. The active store counts only while the
 * user is a member or holds a live support grant; otherwise the actor has
 * no store and no store permissions. Membership wins over a grant.
 */
export async function actorFor(
  db: Db,
  userId: string,
  activeTenantId: string | null,
  options: {
    now?: Date;
    /** The user row was just read (the session lookup): skip reading it again. */
    platformRole?: PlatformRole | null;
  } = {},
): Promise<Actor> {
  const now = options.now ?? new Date();
  let platformRole = options.platformRole;
  if (platformRole === undefined) {
    const u = schema.users;
    const [user] = await db
      .select({ platformRole: u.platformRole })
      .from(u)
      .where(eq(u.id, userId));
    if (!user) throw new AppError('unauthorized');
    platformRole = user.platformRole ?? null;
  }
  const actor: Actor = {
    kind: 'user',
    userId,
    platformRole,
    permissions: new Set(),
  };
  if (!activeTenantId) return actor;

  const m = schema.memberships;
  const [member] = await db
    .select({ role: m.role })
    .from(m)
    .where(and(eq(m.tenantId, activeTenantId), eq(m.userId, userId)));
  if (member) {
    return {
      ...actor,
      tenantId: activeTenantId,
      storeRole: member.role,
      permissions: permissionsOf(member.role),
    };
  }
  const g = schema.supportGrants;
  const [grant] = await db
    .select({ id: g.id, role: g.role })
    .from(g)
    .where(
      and(
        eq(g.tenantId, activeTenantId),
        eq(g.userId, userId),
        gt(g.expiresAt, now),
        isNull(g.revokedAt),
      ),
    )
    .orderBy(g.expiresAt)
    .limit(1);
  if (grant && actor.platformRole) {
    return {
      ...actor,
      tenantId: activeTenantId,
      storeRole: grant.role,
      supportGrantId: grant.id,
      permissions: permissionsOf(grant.role),
    };
  }
  return actor;
}

/** The actor's active store, or forbidden. */
export function requireStore(actor: Actor): string {
  if (!actor.tenantId) throw new AppError('forbidden');
  return actor.tenantId;
}

export const systemActor: Actor = {
  kind: 'system',
  userId: null,
  platformRole: null,
  permissions: new Set(),
};

/** Throws forbidden unless the actor holds the store permission. */
export function authorize(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AppError('forbidden');
}

/**
 * Throws forbidden unless the actor has the platform role. A super admin
 * also passes `support`; the system actor (the CLI) passes both.
 */
export function requirePlatformRole(actor: Actor, role: PlatformRole): void {
  if (actor.kind === 'system') return;
  if (actor.platformRole === 'super_admin') return;
  if (actor.platformRole !== role) throw new AppError('forbidden');
}

/** How the actor appears in audit logs: the CLI and jobs as `system`. */
export function auditActor<T extends 'staff' | 'platform'>(
  actor: Actor,
  as: T,
): { actorType: T | 'system' | 'platform'; actorId?: string } {
  return {
    // Support staff in a store appear as the platform, never as store staff (§5.4).
    actorType: actor.kind === 'system' ? 'system' : actor.supportGrantId ? 'platform' : as,
    ...(actor.userId ? { actorId: actor.userId } : {}),
  };
}
