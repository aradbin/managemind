// Store staff (phase-1-plan §5.2): listing members, changing roles and
// removing people. Memberships are platform rows without RLS, so every
// query here filters by the transaction's tenant (§6.2); the API isolation
// suite proves it. The rules: no escalation, a store keeps at least one
// Owner, and nobody changes their own role.
import { schema } from '@managemind/db';
import { AppError, canManageRole, type StoreRole } from '@managemind/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

const m = schema.memberships;
const u = schema.users;

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: StoreRole;
  createdAt: Date;
}

/** Members by join order, `limit` at a time; pass the last id as `after`. */
export async function listMembers(
  tx: TenantTx,
  actor: Actor,
  page: { after?: string; limit?: number } = {},
): Promise<Member[]> {
  authorize(actor, 'staff.read');
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 100);
  return tx.db
    .select({
      id: m.id,
      userId: m.userId,
      name: u.name,
      email: u.email,
      role: m.role,
      createdAt: m.createdAt,
    })
    .from(m)
    .innerJoin(u, eq(u.id, m.userId))
    .where(and(eq(m.tenantId, tx.tenantId), page.after ? gt(m.id, page.after) : undefined))
    .orderBy(asc(m.id))
    .limit(limit);
}

async function lockMember(tx: TenantTx, memberId: string) {
  const [row] = await tx.db
    .select({ id: m.id, userId: m.userId, role: m.role })
    .from(m)
    .where(and(eq(m.id, memberId), eq(m.tenantId, tx.tenantId)))
    .for('update');
  if (!row) throw new AppError('not_found');
  return row;
}

/** Fails with last_owner if `member` is this store's only Owner. Locks the Owner rows. */
async function keepAnOwner(tx: TenantTx, member: { role: StoreRole }) {
  if (member.role !== 'owner') return;
  const owners = await tx.db
    .select({ id: m.id })
    .from(m)
    .where(and(eq(m.tenantId, tx.tenantId), eq(m.role, 'owner')))
    .for('update');
  if (owners.length <= 1) throw new AppError('last_owner');
}

/** Ends the member's sessions, so their next request starts from their new access. */
const signOut = (tx: TenantTx, userId: string) =>
  tx.db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));

export async function changeRole(
  tx: TenantTx,
  actor: Actor,
  memberId: string,
  role: StoreRole,
): Promise<void> {
  authorize(actor, 'staff.write');
  const member = await lockMember(tx, memberId);
  if (member.userId === actor.userId)
    throw new AppError('forbidden', { detail: 'you cannot change your own role' });
  if (!canManageRole(actor.permissions, member.role) || !canManageRole(actor.permissions, role)) {
    throw new AppError('role_not_allowed');
  }
  if (member.role === role) return;
  if (role !== 'owner') await keepAnOwner(tx, member);
  await tx.db.update(m).set({ role }).where(eq(m.id, memberId));
  await signOut(tx, member.userId);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'staff.role_changed',
    entityType: 'membership',
    entityId: memberId,
    before: { role: member.role },
    after: { role },
  });
  await emit(tx, 'staff.role_changed', {
    aggregateType: 'membership',
    aggregateId: memberId,
    payload: { userId: member.userId, from: member.role, to: role },
  });
}

async function remove(
  tx: TenantTx,
  actor: Actor,
  member: { id: string; userId: string; role: StoreRole },
  left: boolean,
) {
  await keepAnOwner(tx, member);
  await tx.db.delete(m).where(eq(m.id, member.id));
  // Someone who leaves stays signed in; their active store simply stops counting.
  if (!left) await signOut(tx, member.userId);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: left ? 'staff.left' : 'staff.removed',
    entityType: 'membership',
    entityId: member.id,
    before: { userId: member.userId, role: member.role },
  });
  await emit(tx, 'staff.removed', {
    aggregateType: 'membership',
    aggregateId: member.id,
    payload: { userId: member.userId, role: member.role, left },
  });
}

/** Removes another member (`staff.write`, and only roles the actor may manage). */
export async function removeMember(tx: TenantTx, actor: Actor, memberId: string): Promise<void> {
  authorize(actor, 'staff.write');
  const member = await lockMember(tx, memberId);
  if (member.userId === actor.userId) return leaveStore(tx, actor);
  if (!canManageRole(actor.permissions, member.role)) throw new AppError('role_not_allowed');
  await remove(tx, actor, member, false);
}

/** Leaves the store; the last Owner can't. */
export async function leaveStore(tx: TenantTx, actor: Actor): Promise<void> {
  if (!actor.userId) throw new AppError('forbidden');
  const [member] = await tx.db
    .select({ id: m.id, userId: m.userId, role: m.role })
    .from(m)
    .where(and(eq(m.tenantId, tx.tenantId), eq(m.userId, actor.userId)))
    .for('update');
  if (!member) throw new AppError('not_found');
  await remove(tx, actor, member, true);
}
