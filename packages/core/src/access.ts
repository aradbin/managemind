// Who is acting (phase-1-plan §6.2). Services check their own permissions
// with these helpers, on top of the route's check (PLAN.md: checked twice).
// The identity module (PR 8) builds a user's Actor from their session,
// membership or support grant.
import { AppError, type Permission, type PlatformRole } from '@managemind/shared';

export interface Actor {
  /** `system` is the platform CLI and background jobs. */
  kind: 'user' | 'system';
  userId: string | null;
  platformRole: PlatformRole | null;
  /** What the actor may do in its active store; empty outside a store. */
  permissions: ReadonlySet<Permission>;
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
): { actorType: T | 'system'; actorId?: string } {
  return {
    actorType: actor.kind === 'system' ? 'system' : as,
    ...(actor.userId ? { actorId: actor.userId } : {}),
  };
}
